import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const dclaw = fs.readFileSync(new URL("../src/dclaw.js", import.meta.url), "utf8");

test("server schedules tag activation after accepted tag changes", () => {
  assert.match(server, /scheduleTagActivationsForAcceptedChanges/);
  assert.match(server, /tag\.activation\.scheduled/);
});

test("tag activation worker has independent non-overlapping loop", () => {
  assert.match(server, /tagActivationWorkerBusy/);
  assert.match(server, /processTagActivationBatch/);
  assert.match(server, /claimDueTagActivationTasks/);
});

test("tag activation checks tag is still active before sending", () => {
  assert.match(server, /isTagStillActiveForTask/);
  assert.match(server, /tag\.activation\.stale_skipped/);
});

test("dclaw has tag activation polish request", () => {
  assert.match(dclaw, /buildDclawTagActivationRequest/);
  assert.match(dclaw, /eventType=tag_activation_due/);
});
