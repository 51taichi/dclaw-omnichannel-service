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
