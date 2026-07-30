import assert from "node:assert/strict";
import test from "node:test";
import { createCockpitAggregator } from "../src/cockpit-aggregator.js";

test("aggregation advances cursor only after saving a ready snapshot", async () => {
  const calls = [];
  const aggregator = createCockpitAggregator({
    getConfig: () => ({ timezone: "Asia/Shanghai" }),
    getCursor: () => ({ lastEventId: 4 }),
    listEvents: ({ afterId }) => {
      assert.equal(afterId, 4);
      return [{
        id: 5,
        customerKey: "alice",
        eventType: "friend_added",
        occurredAt: "2026-07-30T01:00:00.000Z"
      }];
    },
    loadState: () => ({ events: [] }),
    saveState: ({ state, lastEventId }) => calls.push(["state", state.events.length, lastEventId]),
    saveSnapshot: (snapshot) => {
      calls.push(["snapshot", snapshot.status, snapshot.sourceThroughEventId]);
      return { id: 1, ...snapshot };
    },
    saveCursor: (cursor) => calls.push(["cursor", cursor.lastEventId])
  });

  await aggregator.aggregateBot({
    botId: "bot-a",
    throughAt: "2026-07-31T01:00:00.000Z",
    periodTypes: ["daily"]
  });

  assert.deepEqual(calls, [
    ["snapshot", "ready", 5],
    ["state", 1, 5],
    ["cursor", 5]
  ]);
});

test("aggregation failure leaves state and cursor unchanged", async () => {
  const calls = [];
  const aggregator = createCockpitAggregator({
    getConfig: () => ({ timezone: "Asia/Shanghai" }),
    getCursor: () => ({ lastEventId: 0 }),
    listEvents: () => [{ id: 1, eventType: "friend_added", customerKey: "a", occurredAt: "2026-07-30T01:00:00.000Z" }],
    loadState: () => ({ events: [] }),
    saveState: () => calls.push("state"),
    saveSnapshot: () => {
      throw new Error("snapshot failed");
    },
    saveCursor: () => calls.push("cursor")
  });

  await assert.rejects(
    aggregator.aggregateBot({
      botId: "bot-a",
      throughAt: "2026-07-31T01:00:00.000Z",
      periodTypes: ["daily"]
    }),
    /snapshot failed/
  );
  assert.deepEqual(calls, []);
});

test("snapshot includes reply risks, conversion rate, node distribution and tag charts", async () => {
  let saved;
  const events = [
    { id: 1, customerKey: "a", eventType: "friend_added", occurredAt: "2026-07-30T01:00:00.000Z" },
    { id: 2, customerKey: "a", eventType: "bot_message", nodeId: "node1", occurredAt: "2026-07-30T02:00:00.000Z" },
    { id: 3, customerKey: "a", eventType: "node_reached", nodeId: "node1", flowVersionId: 1, occurredAt: "2026-07-30T02:00:00.000Z" },
    { id: 4, customerKey: "a", eventType: "tag_added", groupId: "intent", tagId: "hot", occurredAt: "2026-07-30T03:00:00.000Z" }
  ];
  const aggregator = createCockpitAggregator({
    getConfig: () => ({ timezone: "Asia/Shanghai", defaultNoReplyHours: 4, nodeNoReplyHours: {} }),
    getCursor: () => ({ lastEventId: 0 }),
    listEvents: () => events,
    loadState: () => ({ events: [] }),
    saveState: () => {},
    saveSnapshot: (snapshot) => { saved = snapshot; return snapshot; },
    saveCursor: () => {}
  });
  await aggregator.aggregateBot({
    botId: "bot-a",
    throughAt: "2026-07-31T01:00:00.000Z",
    periodTypes: ["daily"]
  });
  assert.equal(saved.metrics.newCustomers, 1);
  assert.equal(saved.metrics.neverReplied, 1);
  assert.equal(saved.metrics.invitationRate, 0);
  assert.equal(saved.charts.nodeDistribution[0].nodeId, "node1");
  assert.equal(saved.charts.tags[0].tagId, "hot");
});

test("aggregation uses the real persisted baseline when the period has no chart events", async () => {
  let saved;
  const aggregator = createCockpitAggregator({
    getConfig: () => ({ timezone: "Asia/Shanghai", defaultNoReplyHours: 24 }),
    getCursor: () => ({ lastEventId: 0 }),
    listEvents: () => [],
    loadState: () => ({ events: [] }),
    getBaselineCharts: () => ({
      nodeDistribution: [{
        nodeId: "discover",
        nodeName: "需求沟通",
        reached: 3,
        share: 0.75,
        basis: "current_state"
      }],
      tags: [{
        groupId: "intent",
        tagId: "hot",
        tagName: "高意向",
        current: 2,
        added: 0,
        removed: 0,
        net: 0,
        basis: "current_state"
      }]
    }),
    saveState: () => {},
    saveSnapshot: (snapshot) => { saved = snapshot; return snapshot; },
    saveCursor: () => {}
  });
  await aggregator.aggregateBot({
    botId: "bot-a",
    throughAt: "2026-07-31T01:00:00.000Z",
    periodTypes: ["daily"]
  });
  assert.equal(saved.charts.nodeDistribution[0].nodeName, "需求沟通");
  assert.equal(saved.charts.tags[0].tagName, "高意向");
});
