import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-cockpit-db-"));
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
  assert.equal(db.getCockpitConfig("bot-a").defaultNoReplyHours, 24);
  assert.equal(db.getCockpitConfig("bot-a").schedules.daily.sendAt, "09:00");

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
      eventType: "friend_added",
      occurredAt: "2026-07-30T00:00:00.000Z",
      receivedAt: "2026-07-30T00:00:00.000Z",
      payload: {},
      sourceRef: { type: "friend_added", id: "f-1" }
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
    state: { events: [{ id: 1, eventType: "friend_added" }] },
    lastEventId: 1
  });
  assert.deepEqual(db.getCockpitAggregationState("bot-a"), {
    events: [{ id: 1, eventType: "friend_added" }]
  });
  assert.deepEqual(db.getCockpitAggregationState("bot-b"), { events: [] });
});
