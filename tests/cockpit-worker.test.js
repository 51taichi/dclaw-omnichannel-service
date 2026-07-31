import assert from "node:assert/strict";
import test from "node:test";
import {
  createCockpitWorker,
  scheduledCockpitStage,
  scheduledCockpitStages
} from "../src/cockpit-worker.js";

test("night schedule runs aggregate, reconcile, generate and deliver in order", () => {
  assert.equal(scheduledCockpitStage(new Date("2026-07-30T01:05:00+08:00")), "aggregate");
  assert.equal(scheduledCockpitStage(new Date("2026-07-30T02:05:00+08:00")), "reconcile");
  assert.equal(scheduledCockpitStage(new Date("2026-07-30T03:05:00+08:00")), "generate");
  assert.equal(scheduledCockpitStage(new Date("2026-07-30T09:05:00+08:00")), "deliver");
});

test("schedule catches up every due stage after a restart", () => {
  assert.deepEqual(
    scheduledCockpitStages(new Date("2026-07-30T04:05:00+08:00")),
    ["aggregate", "reconcile", "generate"]
  );
  assert.deepEqual(
    scheduledCockpitStages(new Date("2026-07-30T10:05:00+08:00")),
    ["aggregate", "reconcile", "generate", "deliver"]
  );
});

test("worker prevents overlapping ticks", async () => {
  let release;
  let calls = 0;
  const blocker = new Promise((resolve) => { release = resolve; });
  const worker = createCockpitWorker({
    now: () => new Date("2026-07-30T01:05:00+08:00"),
    handlers: { aggregate: async () => { calls += 1; await blocker; } }
  });
  const first = worker.tick();
  const second = await worker.tick();
  assert.deepEqual(second, { skipped: "busy" });
  release();
  await first;
  assert.equal(calls, 1);
});

test("the same scheduled stage only runs once per local date", async () => {
  let calls = 0;
  const worker = createCockpitWorker({
    now: () => new Date("2026-07-30T03:05:00+08:00"),
    handlers: { generate: async () => { calls += 1; } }
  });
  await worker.tick();
  const result = await worker.tick();
  assert.deepEqual(result, { skipped: "already_run" });
  assert.equal(calls, 1);
});

test("persisted completion prevents a restarted worker from rerunning a stage", async () => {
  const completed = new Set();
  let calls = 0;
  const options = {
    now: () => new Date("2026-07-30T03:05:00+08:00"),
    handlers: { generate: async () => { calls += 1; } },
    isStageCompleted: async ({ key }) => completed.has(key),
    markStageCompleted: async ({ key }) => { completed.add(key); }
  };

  await createCockpitWorker(options).tick();
  const result = await createCockpitWorker(options).tick();

  assert.deepEqual(result, { skipped: "already_run" });
  assert.equal(calls, 1);
});

test("catch-up executes the earliest incomplete stage first", async () => {
  const calls = [];
  const completed = new Set(["2026-07-30:aggregate"]);
  const worker = createCockpitWorker({
    now: () => new Date("2026-07-30T04:05:00+08:00"),
    handlers: {
      aggregate: async () => calls.push("aggregate"),
      reconcile: async () => calls.push("reconcile"),
      generate: async () => calls.push("generate")
    },
    isStageCompleted: async ({ key }) => completed.has(key),
    markStageCompleted: async ({ key }) => { completed.add(key); }
  });

  await worker.tick();

  assert.deepEqual(calls, ["reconcile"]);
  assert.equal(completed.has("2026-07-30:reconcile"), true);
});
