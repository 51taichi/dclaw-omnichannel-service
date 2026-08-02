import assert from "node:assert/strict";
import test from "node:test";
import { getTagSyncWindowState } from "../src/tag-sync.js";
import { createTagSyncWorker } from "../src/tag-sync-worker.js";

const batchOne = {
  targetName: "客户甲",
  tagNames: ["A类", "VIP"],
  rows: [{ id: 1, runAttemptCount: 1 }, { id: 2, runAttemptCount: 1 }]
};
const batchTwo = {
  targetName: "客户乙",
  tagNames: ["B类"],
  rows: [{ id: 3, runAttemptCount: 1 }]
};

function createHarness({
  nightlyEnabled = true,
  activeRun = null,
  realtimeActive = false,
  batches = [batchOne],
  sendError = null,
  leaseMs,
  skipScheduledRun = false,
  now = new Date("2026-08-01T19:00:00.000Z")
} = {}) {
  const config = {
    botId: "bot_sync",
    nightlyEnabled,
    windowStart: "03:00",
    windowEnd: "06:00"
  };
  const startedRuns = [];
  const statuses = [];
  const sent = [];
  const submitted = [];
  const submitFailures = [];
  const resolved = [];
  const recovered = [];
  const claims = [];
  const logs = [];
  const queue = [...batches];
  let currentRun = activeRun;
  let hasInFlight = false;
  let isRealtimeActive = realtimeActive;

  const deps = {
    getConfig: () => config,
    listConfigs: () => [config],
    getActiveRun: () => currentRun,
    startRun(input) {
      startedRuns.push(input);
      if (skipScheduledRun && input.triggerType === "scheduled") return null;
      currentRun = {
        id: 9,
        botId: input.botId,
        triggerType: input.triggerType,
        windowKey: input.windowKey || "",
        status: "running"
      };
      return currentRun;
    },
    setRunStatus(input) {
      statuses.push(input);
      if (currentRun?.id === input.runId) {
        currentRun = { ...currentRun, status: input.status };
      }
      return currentRun;
    },
    hasRealtimeActivity: () => isRealtimeActive,
    claimBatch(input) {
      claims.push(input);
      if (hasInFlight) return null;
      return queue.shift() || null;
    },
    markSubmitted(input) {
      submitted.push(input);
      hasInFlight = true;
    },
    markSubmitFailed(input) {
      submitFailures.push(input);
      hasInFlight = false;
    },
    resolveCallback(input) {
      resolved.push(input);
      if (input.worktoolMessageId !== "wt-1") {
        return { succeededCount: 0, failedCount: 0, rows: [] };
      }
      hasInFlight = false;
      return input.succeeded
        ? { succeededCount: 2, failedCount: 0, rows: batchOne.rows }
        : { succeededCount: 0, failedCount: 2, rows: batchOne.rows };
    },
    finishRunIfDrained: () => ({ status: queue.length || hasInFlight ? "waiting" : "completed" }),
    recoverLeases(input) {
      recovered.push(input);
      return 1;
    },
    async sendTags(input) {
      sent.push(input);
      if (sendError) throw sendError;
      return { code: 200, data: `wt-${sent.length}` };
    },
    getWindowState: getTagSyncWindowState,
    leaseMs,
    log(event, fields) {
      logs.push({ event, fields });
    }
  };

  return {
    worker: createTagSyncWorker(deps),
    config,
    startedRuns,
    statuses,
    sent,
    submitted,
    submitFailures,
    resolved,
    recovered,
    claims,
    logs,
    now,
    setRealtimeActive(value) {
      isRealtimeActive = value;
    }
  };
}

test("disabled nightly config never starts a scheduled run", async () => {
  const harness = createHarness({ nightlyEnabled: false });
  await harness.worker.tick(harness.now);
  assert.equal(harness.startedRuns.length, 0);
  assert.equal(harness.sent.length, 0);
});

test("a completed scheduled window does not start or process another run", async () => {
  const harness = createHarness({ skipScheduledRun: true });
  const result = await harness.worker.runBot("bot_sync", harness.now);
  assert.equal(result.status, "already_completed");
  assert.equal(harness.startedRuns.length, 1);
  assert.equal(harness.sent.length, 0);
});

test("manual run works while nightly automation is disabled", async () => {
  const harness = createHarness({
    nightlyEnabled: false,
    activeRun: { id: 9, triggerType: "manual", status: "running" }
  });
  const result = await harness.worker.runBot("bot_sync", harness.now);
  assert.equal(result.status, "submitted");
  assert.equal(harness.sent.length, 1);
});

test("customer processing pauses claim and finished processing resumes it", async () => {
  const harness = createHarness({
    activeRun: { id: 9, triggerType: "manual", status: "running" },
    realtimeActive: true
  });
  const paused = await harness.worker.runBot("bot_sync", harness.now);
  assert.equal(paused.status, "paused");
  assert.equal(harness.sent.length, 0);
  assert.equal(harness.statuses.at(-1).status, "paused");

  harness.setRealtimeActive(false);
  const resumed = await harness.worker.runBot("bot_sync", harness.now);
  assert.equal(resumed.status, "submitted");
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.statuses.at(-1).status, "running");
});

test("worker waits for callback before submitting a second command", async () => {
  const harness = createHarness({
    activeRun: { id: 9, triggerType: "manual", status: "running" },
    batches: [batchOne, batchTwo]
  });
  await harness.worker.runBot("bot_sync", harness.now);
  await harness.worker.runBot("bot_sync", harness.now);
  assert.equal(harness.sent.length, 1);

  const callback = await harness.worker.handleCommandCallback({
    botId: "bot_sync",
    messageId: "wt-1",
    payload: { errorCode: 0, successList: ["客户甲"], failList: [] }
  });
  assert.equal(callback.matched, true);
  await harness.worker.runBot("bot_sync", harness.now);
  assert.equal(harness.sent.length, 2);
});

test("worker applies the configured claim lease duration", async () => {
  const harness = createHarness({
    activeRun: { id: 9, triggerType: "manual", status: "running" },
    leaseMs: 180_000
  });
  await harness.worker.runBot("bot_sync", harness.now);
  assert.equal(harness.claims[0].leaseExpiresAt, "2026-08-01T19:03:00.000Z");
});

test("a type 213 callback is terminal when its success list omits the target", async () => {
  const harness = createHarness({
    activeRun: { id: 9, triggerType: "manual", status: "running" }
  });
  await harness.worker.runBot("bot_sync", harness.now);
  await harness.worker.handleCommandCallback({
    botId: "bot_sync",
    messageId: "wt-1",
    payload: { errorCode: 0, successList: ["其他客户"], failList: [] }
  });

  assert.equal(harness.resolved.length, 1);
  assert.equal(harness.resolved[0].succeeded, true);
  assert.match(harness.resolved[0].error, /其他原因/);
});

test("business error callbacks finish synchronization and preserve WorkTool reasons", async () => {
  const harness = createHarness({
    activeRun: { id: 9, triggerType: "manual", status: "running" }
  });
  await harness.worker.runBot("bot_sync", harness.now);
  const callback = await harness.worker.handleCommandCallback({
    botId: "bot_sync",
    messageId: "wt-1",
    payload: {
      type: 213,
      errorCode: 201103,
      errorReason: "Enterprise WeChat customers cannot be tagged",
      successList: [],
      failList: ["客户甲"]
    }
  });

  assert.equal(callback.matched, true);
  assert.equal(callback.succeeded, true);
  assert.equal(harness.resolved[0].succeeded, true);
  assert.equal(
    harness.resolved[0].error,
    "Enterprise WeChat customers cannot be tagged"
  );
  assert.equal(harness.resolved[0].nextRetryAt, undefined);
});

test("business errors without text use a generic terminal reason", async () => {
  const harness = createHarness({
    activeRun: { id: 9, triggerType: "manual", status: "running" }
  });
  await harness.worker.runBot("bot_sync", harness.now);
  await harness.worker.handleCommandCallback({
    botId: "bot_sync",
    messageId: "wt-1",
    payload: { type: 213, errorCode: 299999, successList: [], failList: [] }
  });

  assert.equal(harness.resolved[0].succeeded, true);
  assert.equal(harness.resolved[0].error, "其他原因（错误码 299999）");
});

test("send failures keep rows retryable with bounded backoff", async () => {
  const harness = createHarness({
    activeRun: { id: 9, triggerType: "manual", status: "running" },
    sendError: new Error("WorkTool unavailable")
  });
  const result = await harness.worker.runBot("bot_sync", harness.now);
  assert.equal(result.status, "failed");
  assert.equal(harness.submitFailures.length, 1);
  assert.deepEqual(harness.submitFailures[0].outboxIds, [1, 2]);
  assert.equal(harness.submitFailures[0].nextRetryAt, "2026-08-01T19:00:30.000Z");
  assert.match(harness.submitFailures[0].error, /unavailable/);
});

test("recover delegates expired lease recovery and tick does not overlap", async () => {
  const harness = createHarness({ nightlyEnabled: false });
  const recovered = harness.worker.recover(harness.now);
  assert.equal(recovered, 1);
  assert.equal(harness.recovered.length, 1);
  assert.match(harness.recovered[0].nowIso, /^2026-08-01T19:00:00\.000Z$/);

  await Promise.all([harness.worker.tick(harness.now), harness.worker.tick(harness.now)]);
  assert.equal(harness.startedRuns.length, 0);
  assert.equal(harness.recovered.length, 2);
});
