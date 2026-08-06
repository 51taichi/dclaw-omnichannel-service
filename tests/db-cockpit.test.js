import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omnichannel-cockpit-db-"));
const db = await import("../src/db.js");

function seedBot(botId) {
  db.upsertAgent({
    agentId: `${botId}-agent`,
    agentName: `${botId} Agent`,
    dclawBaseUrl: "https://agent.example.com",
    dclawPublicId: `${botId}-public`,
    agentApiKey: "secret",
    enabled: true
  });
  return db.upsertBotBinding({
    botId,
    botName: botId,
    agentId: `${botId}-agent`,
    enabled: true
  });
}

test("cockpit events are idempotent and isolated by Bot", () => {
  const event = {
    eventKey: "bot-a:incoming:m-1",
    botId: "bot-a",
    conversationKey: "bot-a:private:alice",
    customerKey: "alice",
    eventType: "customer_message",
    occurredAt: "2026-07-30T10:00:00.000Z",
    receivedAt: "2026-07-30T10:00:01.000Z",
    payload: { textType: 1 },
    sourceRef: { type: "incoming_message", id: "m-1" }
  };

  assert.equal(db.appendCockpitEvent(event).inserted, true);
  assert.equal(db.appendCockpitEvent(event).inserted, false);
  assert.equal(db.listCockpitEvents({ botId: "bot-a", afterId: 0, limit: 100 }).length, 1);
  assert.deepEqual(db.listCockpitEvents({ botId: "bot-b", afterId: 0, limit: 100 }), []);
});

test("cockpit config defaults and daily counters stay Bot scoped", () => {
  assert.equal(db.getCockpitConfig("bot-a").timezone, "Asia/Shanghai");
  assert.equal(db.getCockpitConfig("bot-a").defaultNoReplyHours, 24);
  assert.equal(db.getCockpitConfig("bot-a").schedules.daily.sendAt, "09:00");

  const normalized = db.upsertCockpitConfig({
    botId: "bot-a",
    config: { timezone: "UTC", defaultNoReplyHours: 12 }
  });
  assert.equal(normalized.timezone, "Asia/Shanghai");
  assert.equal(normalized.defaultNoReplyHours, 12);

  assert.equal(db.incrementCockpitDailyCounter({
    botId: "bot-a",
    localDate: "2026-07-30",
    metricKey: "new_customer",
    amount: 1
  }), 1);
  assert.equal(db.incrementCockpitDailyCounter({
    botId: "bot-a",
    localDate: "2026-07-30",
    metricKey: "new_customer",
    amount: 1
  }), 2);
  assert.deepEqual(
    db.getCockpitDailyCounters({ botId: "bot-b", localDate: "2026-07-30" }),
    {}
  );
});

test("snapshots and immutable report revisions preserve frozen documents", () => {
  const snapshot = db.saveCockpitSnapshot({
    botId: "bot-a",
    periodType: "daily",
    periodStart: "2026-07-30T00:00:00.000Z",
    periodEnd: "2026-07-31T00:00:00.000Z",
    status: "ready",
    sourceThroughEventId: 1,
    metrics: { newCustomers: 1 },
    charts: { funnels: [] },
    definitions: { flow: [], tags: [] },
    generatedAt: "2026-07-31T03:00:00.000Z"
  });
  const first = db.createCockpitReport({
    botId: "bot-a",
    snapshotId: snapshot.id,
    reportType: "daily",
    periodStart: snapshot.periodStart,
    periodEnd: snapshot.periodEnd,
    summary: { title: "第一版" },
    document: { metrics: { newCustomers: 1 } },
    generatedAt: "2026-07-31T03:10:00.000Z"
  });
  const second = db.createCockpitReportRevision({
    reportId: first.id,
    summary: { title: "修订版" },
    document: { metrics: { newCustomers: 2 } },
    generatedAt: "2026-07-31T04:10:00.000Z"
  });

  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.deepEqual(first.document, { metrics: { newCustomers: 1 } });
  assert.equal(db.listCockpitReports({ botId: "bot-a", page: 1, pageSize: 20 }).total, 2);
});

test("deleteBotData removes only that Bot cockpit records", () => {
  seedBot("delete-a");
  seedBot("keep-b");
  for (const botId of ["delete-a", "keep-b"]) {
    db.appendCockpitEvent({
      eventKey: `${botId}:friend:f-1`,
      botId,
      conversationKey: `${botId}:private:alice`,
      customerKey: "alice",
      eventType: "first_contact",
      occurredAt: "2026-07-30T00:00:00.000Z",
      receivedAt: "2026-07-30T00:00:00.000Z",
      payload: {},
      sourceRef: { type: "first_contact", id: "f-1" }
    });
  }

  db.deleteBotData("delete-a");

  assert.deepEqual(db.listCockpitEvents({ botId: "delete-a", afterId: 0, limit: 100 }), []);
  assert.equal(db.listCockpitEvents({ botId: "keep-b", afterId: 0, limit: 100 }).length, 1);
});

test("definition revisions cursors jobs and deliveries are claimable by scope", () => {
  const definition = db.saveCockpitDefinitionVersion({
    botId: "bot-a",
    definitionType: "flow",
    semanticHash: "hash-1",
    versionNumber: 1,
    revisionNumber: 1,
    config: { nodes: [{ id: "node-1", name: "开始" }] },
    effectiveAt: "2026-07-30T00:00:00.000Z"
  });
  assert.equal(definition.versionNumber, 1);
  assert.equal(definition.config.nodes[0].id, "node-1");

  assert.equal(db.getCockpitAggregationCursor("bot-a").lastEventId, 0);
  assert.equal(db.saveCockpitAggregationCursor({
    botId: "bot-a",
    lastEventId: 9,
    lastSuccessAt: "2026-07-31T01:00:00.000Z",
    lastError: ""
  }).lastEventId, 9);

  db.createCockpitJob({
    botId: "bot-a",
    stage: "aggregate",
    payload: { periodType: "daily" },
    dueAt: "2026-07-31T01:00:00.000Z"
  });
  assert.equal(db.claimDueCockpitJobs({
    stage: "aggregate",
    now: "2026-07-31T01:00:01.000Z",
    limit: 10
  }).length, 1);

  const delivery = db.createCockpitDelivery({
    reportId: 99,
    botId: "bot-a",
    recipient: "负责人",
    dueAt: "2026-07-31T09:00:00.000Z"
  });
  assert.equal(delivery.status, "pending");
  assert.equal(db.claimDueCockpitDeliveries({
    now: "2026-07-31T09:00:01.000Z",
    limit: 10
  }).length, 1);
});

test("scheduled cockpit stage completion survives restarts and stays idempotent", () => {
  assert.equal(db.isCockpitStageCompleted({
    localDate: "2026-07-31",
    stage: "generate"
  }), false);

  db.markCockpitStageCompleted({
    localDate: "2026-07-31",
    stage: "generate",
    completedAt: "2026-07-31T03:05:00.000Z"
  });
  db.markCockpitStageCompleted({
    localDate: "2026-07-31",
    stage: "generate",
    completedAt: "2026-07-31T03:06:00.000Z"
  });

  assert.equal(db.isCockpitStageCompleted({
    localDate: "2026-07-31",
    stage: "generate"
  }), true);
});

test("definition saves revise display changes and version semantic changes", () => {
  const first = db.ensureCockpitDefinitionVersion({
    botId: "version-bot",
    definitionType: "flow",
    config: {
      nodes: [{ id: "node-1", name: "开始", goal: "建立联系" }]
    },
    effectiveAt: "2026-07-30T00:00:00.000Z"
  });
  const renamed = db.ensureCockpitDefinitionVersion({
    botId: "version-bot",
    definitionType: "flow",
    config: {
      nodes: [{ id: "node-1", name: "首次沟通", goal: "建立联系" }]
    },
    effectiveAt: "2026-07-30T01:00:00.000Z"
  });
  const changed = db.ensureCockpitDefinitionVersion({
    botId: "version-bot",
    definitionType: "flow",
    config: {
      nodes: [{ id: "node-1", name: "首次沟通", goal: "确认预算" }]
    },
    effectiveAt: "2026-07-30T02:00:00.000Z"
  });

  assert.deepEqual(
    [first.versionNumber, first.revisionNumber, first.semanticChanged],
    [1, 1, true]
  );
  assert.deepEqual(
    [renamed.versionNumber, renamed.revisionNumber, renamed.semanticChanged],
    [1, 2, false]
  );
  assert.deepEqual(
    [changed.versionNumber, changed.revisionNumber, changed.semanticChanged],
    [2, 1, true]
  );
});

test("aggregation state is replaced atomically per Bot", () => {
  assert.deepEqual(db.getCockpitAggregationState("bot-a"), { events: [] });
  db.saveCockpitAggregationState({
    botId: "bot-a",
    state: { events: [{ id: 1, eventType: "first_contact" }] },
    lastEventId: 1
  });
  assert.deepEqual(db.getCockpitAggregationState("bot-a"), {
    events: [{ id: 1, eventType: "first_contact" }]
  });
  assert.deepEqual(db.getCockpitAggregationState("bot-b"), { events: [] });
});

test("cockpit baseline charts use real flow nodes and current customer tags", () => {
  const binding = seedBot("baseline-bot");
  const machine = db.upsertFlowMachine({
    agentId: binding.agentId,
    config: {
      name: "销售流程",
      version: "1",
      entryNodeId: "discover",
      nodes: [
        { id: "discover", name: "需求沟通" },
        { id: "invite", name: "邀约到店" }
      ]
    }
  });
  db.getOrCreateFlowSession({
    botId: binding.botId,
    conversationKey: "baseline-bot:private:a",
    machine: machine.config
  });
  db.getOrCreateFlowSession({
    botId: binding.botId,
    conversationKey: "baseline-bot:private:b",
    machine: machine.config
  });
  db.updateFlowSessionNode({
    botId: binding.botId,
    conversationKey: "baseline-bot:private:b",
    nextNodeId: "invite",
    reason: "test"
  });
  db.applyConversationTagChanges({
    botId: binding.botId,
    agentId: binding.agentId,
    conversationKey: "baseline-bot:private:a",
    nextTags: [{
      groupId: "intent",
      groupName: "意向",
      tagId: "hot",
      tagName: "高意向"
    }]
  });
  db.upsertAgentTagSchema({
    agentId: binding.agentId,
    schema: {
      dateTag: { enabled: true },
      groups: [
        {
          id: "stage",
          name: "客户阶段",
          tags: [{ id: "c", name: "C类" }]
        },
        {
          id: "intent",
          name: "客户意向",
          tags: [
            { id: "warm", name: "有意向" },
            { id: "hot", name: "高意向" }
          ]
        }
      ]
    }
  });

  const charts = db.getCockpitBaselineCharts(binding.botId);
  assert.deepEqual(charts.nodeDistribution, [
    { nodeId: "discover", nodeName: "需求沟通", reached: 1, share: 0.5, basis: "current_state" },
    { nodeId: "invite", nodeName: "邀约到店", reached: 1, share: 0.5, basis: "current_state" }
  ]);
  assert.deepEqual(charts.tags.map((tag) => [
    tag.groupName,
    tag.tagName,
    tag.current
  ]), [
    ["客户阶段", "C类", 0],
    ["客户意向", "有意向", 0],
    ["客户意向", "高意向", 1]
  ]);
});

test("cockpit backfill projects committed replies nodes and tag changes", () => {
  const binding = seedBot("backfill-bot");
  const conversationKey = "backfill-bot:private:alice";
  const machine = db.upsertFlowMachine({
    agentId: binding.agentId,
    config: {
      name: "回填流程",
      version: "1",
      entryNodeId: "start",
      nodes: [
        { id: "start", name: "开始" },
        { id: "qualified", name: "已沟通" }
      ]
    }
  });
  db.getOrCreateFlowSession({
    botId: binding.botId,
    conversationKey,
    machine: machine.config
  });
  db.upsertConversation({
    botId: binding.botId,
    agentId: binding.agentId,
    conversationKey,
    message: { roomType: 2, receivedName: "alice", groupName: "alice" }
  });
  db.insertIncomingMessage({
    botId: binding.botId,
    conversationKey,
    payload: {
      messageId: "incoming-1",
      spoken: "你好",
      receivedName: "alice",
      roomType: 2,
      textType: 1
    }
  });
  db.updateFlowSessionNode({
    botId: binding.botId,
    conversationKey,
    nextNodeId: "qualified",
    reason: "test"
  });
  db.insertOutgoingMessage({
    botId: binding.botId,
    agentId: binding.agentId,
    conversationKey,
    messageId: "reply-1",
    targetName: "alice",
    content: "您好",
    channelResponse: { code: 0 }
  });
  db.applyConversationTagChanges({
    botId: binding.botId,
    agentId: binding.agentId,
    conversationKey,
    accepted: [{
      action: "add",
      groupId: "intent",
      tagId: "hot",
      reason: "test"
    }],
    nextTags: [{
      groupId: "intent",
      groupName: "意向",
      tagId: "hot",
      tagName: "高意向"
    }]
  });

  const result = db.backfillCockpitEventsFromBusiness({
    botId: binding.botId,
    throughAt: "2999-12-31T23:59:59.999Z"
  });
  const events = db.listCockpitEvents({
    botId: binding.botId,
    afterId: 0,
    throughAt: "2999-12-31T23:59:59.999Z",
    limit: 100
  });

  assert.equal(result.inserted >= 3, true);
  assert.deepEqual(
    events.map((event) => event.eventType).sort(),
    ["bot_message", "customer_message", "first_contact", "node_reached", "tag_added"]
  );
  assert.equal(events.find((event) => event.eventType === "node_reached").nodeId, "qualified");
  assert.equal(events.find((event) => event.eventType === "tag_added").tagId, "hot");
  assert.equal(
    db.backfillCockpitEventsFromBusiness({
      botId: binding.botId,
      throughAt: "2999-12-31T23:59:59.999Z"
    }).inserted,
    0
  );
});
