import assert from "node:assert/strict";
import test from "node:test";
import { createCockpitWorker, scheduledCockpitStage } from "../src/cockpit-worker.js";

test("night schedule runs aggregate, reconcile, generate and deliver in order", () => {
  assert.equal(scheduledCockpitStage(new Date("2026-07-30T01:05:00+08:00")), "aggregate");
  assert.equal(scheduledCockpitStage(new Date("2026-07-30T02:05:00+08:00")), "reconcile");
  assert.equal(scheduledCockpitStage(new Date("2026-07-30T03:05:00+08:00")), "generate");
  assert.equal(scheduledCockpitStage(new Date("2026-07-30T09:05:00+08:00")), "deliver");
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
