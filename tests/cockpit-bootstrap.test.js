import assert from "node:assert/strict";
import test from "node:test";
import { createCockpitBootstrap } from "../src/cockpit-bootstrap.js";

test("bootstrap aggregates only enabled Bots without a daily snapshot", async () => {
  const aggregated = [];
  const bootstrap = createCockpitBootstrap({
    listBots: () => [
      { botId: "missing", enabled: true },
      { botId: "ready", enabled: true },
      { botId: "disabled", enabled: false }
    ],
    getLatestSnapshot: ({ botId }) => botId === "ready"
      ? {
          id: 1,
          metrics: { customerMessages: 2, replyMessages: 2 },
          charts: { nodeDistribution: [{ nodeId: "real" }], tags: [] }
        }
      : null,
    aggregateBot: async (input) => aggregated.push(input)
  });
  const result = await bootstrap.run({ throughAt: "2026-07-30T06:00:00.000Z" });
  assert.deepEqual(aggregated, [{
    botId: "missing",
    throughAt: "2026-07-30T06:00:00.000Z",
    periodTypes: ["daily", "weekly", "monthly"]
  }]);
  assert.deepEqual(result, { initialized: 1, skipped: 1, failed: 0 });
});

test("bootstrap refreshes an old snapshot whose charts are completely empty", async () => {
  const aggregated = [];
  const bootstrap = createCockpitBootstrap({
    listBots: () => [{ botId: "empty-chart", enabled: true }],
    getLatestSnapshot: () => ({
      id: 1,
      charts: { nodeDistribution: [], tags: [] }
    }),
    aggregateBot: async (input) => aggregated.push(input)
  });
  const result = await bootstrap.run({ throughAt: "2026-07-30T06:00:00.000Z" });
  assert.equal(aggregated.length, 1);
  assert.deepEqual(result, { initialized: 1, skipped: 0, failed: 0 });
});

test("bootstrap refreshes snapshots created before universal message metrics", async () => {
  const calls = [];
  const bootstrap = createCockpitBootstrap({
    listBots: () => [{ botId: "legacy", enabled: true }],
    getLatestSnapshot: () => ({
      metrics: { newCustomers: 3, successfulInvitations: 1 },
      charts: { nodeDistribution: [{ nodeId: "one" }], tags: [] }
    }),
    aggregateBot: async (input) => calls.push(input),
    onError: () => {}
  });

  const result = await bootstrap.run({ throughAt: "2026-07-30T20:00:00.000Z" });

  assert.equal(result.initialized, 1);
  assert.equal(calls.length, 1);
});

test("bootstrap isolates one Bot failure and continues", async () => {
  const attempted = [];
  const bootstrap = createCockpitBootstrap({
    listBots: () => [
      { botId: "bad", enabled: true },
      { botId: "good", enabled: true }
    ],
    getLatestSnapshot: () => null,
    aggregateBot: async ({ botId }) => {
      attempted.push(botId);
      if (botId === "bad") throw new Error("broken");
    }
  });
  const result = await bootstrap.run({ throughAt: "2026-07-30T06:00:00.000Z" });
  assert.deepEqual(attempted, ["bad", "good"]);
  assert.deepEqual(result, { initialized: 1, skipped: 0, failed: 1 });
});
