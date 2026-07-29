import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const db = fs.readFileSync(new URL("../src/db.js", import.meta.url), "utf8");
const dclaw = fs.readFileSync(new URL("../src/dclaw.js", import.meta.url), "utf8");

test("server keeps tag activation scheduling for accepted local and Agent tag changes", () => {
  assert.match(server, /scheduleTagActivationsForAcceptedChanges/);
  assert.match(server, /scheduledTagActivationTasks/);
  assert.match(server, /applyAgentTagDecision/);
});

test("group tag activations are scheduled and resolve the current group name at send time", () => {
  const scheduler = server.slice(
    server.indexOf("function scheduleTagActivationsForAcceptedChanges"),
    server.indexOf("function buildTagContext")
  );
  assert.doesNotMatch(scheduler, /isPrivateConversationKey\(conversationKey\)/);

  const sendHandler = server.slice(
    server.indexOf("async function processTagActivationTask"),
    server.indexOf("async function processTagActivationBatch")
  );
  assert.match(sendHandler, /getGroupByConversationKey/);
  assert.match(sendHandler, /currentName/);
  assert.match(sendHandler, /privateTargetNameFromConversationKey/);
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

test("tag activation polish records validation failures before rejecting replies", () => {
  const polishHandler = server.slice(
    server.indexOf("async function buildPolishedTagActivationContent"),
    server.indexOf("async function processTagActivationTask")
  );
  assert.match(polishHandler, /tag\.activation\.agent\.validation_failed/);
  assert.match(polishHandler, /recordAgentResponseValidationFailures/);
  assert.match(polishHandler, /invalid_agent_reply_format/);
  assert.ok(
    polishHandler.indexOf("!strictInvocation.agentReply.valid") < polishHandler.lastIndexOf('status: "success"'),
    "invalid replies must fail before successful agent invocation finish"
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

test("tag activation schedules the next task only after a successful send", () => {
  assert.match(server, /function scheduleNextTagActivationTask/);
  const sendHandler = server.slice(
    server.indexOf("async function processTagActivationTask"),
    server.indexOf("async function processTagActivationBatch")
  );
  assert.match(sendHandler, /markTagActivationTaskSent/);
  assert.match(sendHandler, /scheduleNextTagActivationTask/);
  assert.ok(
    sendHandler.indexOf("markTagActivationTaskSent") < sendHandler.indexOf("scheduleNextTagActivationTask"),
    "next tag activation task must be scheduled only after the current task is marked sent"
  );
  assert.match(server, /attemptNumber\s*<\s*task\.maxTimes/);
  assert.match(server, /messageIndex:\s*task\.messageIndex\s*\+\s*1/);
  assert.match(server, /activationDueAtForAttempt\([^)]*sentAt[^)]*attemptNumber/s);
});

test("dclaw has tag activation polish request", () => {
  assert.match(dclaw, /buildDclawTagActivationRequest/);
  assert.match(dclaw, /eventType=tag_activation_due/);
});
