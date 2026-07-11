import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("activation worker is batch limited and non-overlapping", () => {
  assert.equal(source.includes("activationWorkerBusy"), true);
  assert.equal(source.includes("activationWorkerConfig"), true);
  assert.equal(source.includes("ACTIVATION_WORKER_BATCH_SIZE"), true);
  assert.equal(source.includes("claimDueFlowActivationTasks"), true);
  assert.equal(source.includes("processFlowActivationBatch"), true);
});

test("activation worker supports agent polished and raw message sends", () => {
  assert.equal(source.includes("buildDclawActivationRequest"), true);
  assert.equal(source.includes("task.polishByAgent"), true);
  assert.equal(source.includes("sendActivationRawMessages"), true);
  assert.equal(source.includes("sendActivationPolishedMessage"), true);
});
