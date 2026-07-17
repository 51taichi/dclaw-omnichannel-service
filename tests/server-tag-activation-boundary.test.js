import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const db = fs.readFileSync(new URL("../src/db.js", import.meta.url), "utf8");
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

test("tag activation polish rejects degraded fallback replies", () => {
  const polishHandler = server.slice(
    server.indexOf("async function buildPolishedTagActivationContent"),
    server.indexOf("async function processTagActivationTask")
  );
  assert.match(polishHandler, /agentReply\.degraded/);
  assert.match(polishHandler, /degraded_tag_activation_reply/);
  assert.ok(
    polishHandler.indexOf("agentReply.degraded") < polishHandler.lastIndexOf('status: "success"'),
    "degraded replies must fail before successful agent invocation finish"
  );
});

test("tag activation send path uses db guard for processing task and active tag", () => {
  assert.match(server, /reserveTagActivationTaskForSend/);
  assert.match(server, /tag\.activation\.canceled_skipped/);
  assert.match(db, /export function reserveTagActivationTaskForSend/);
  assert.match(db, /status = 'sending'/);
  assert.match(db, /status = 'processing'/);
  assert.match(db, /EXISTS\s*\(\s*SELECT 1\s+FROM conversation_tags/s);
});

test("dclaw has tag activation polish request", () => {
  assert.match(dclaw, /buildDclawTagActivationRequest/);
  assert.match(dclaw, /eventType=tag_activation_due/);
});
