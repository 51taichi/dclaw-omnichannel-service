import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("friend-added callback is handled before empty inbound messages are skipped", () => {
  assert.equal(source.includes("handleFriendAddedEvent"), true);
  assert.equal(source.includes("isFriendAddedEvent(message)"), true);
  assert.equal(
    source.indexOf("isFriendAddedEvent(message)") < source.indexOf("shouldProcessInboundForAgent(message)"),
    true
  );
});

test("friend-added activation never invokes DClaw or sends a welcome message", () => {
  const start = source.indexOf("async function handleFriendAddedEvent");
  const end = source.indexOf("\nfunction commandCallbackLogFields", start);
  const handler = source.slice(start, end);
  assert.equal(handler.includes("scheduleCurrentActivation"), false);
  assert.equal(handler.includes("activationDueAtForAttempt"), true);
  assert.equal(handler.includes("invokeDclaw"), false);
  assert.equal(handler.includes("sendTextMessage"), false);
});

test("normal reply activation does not depend on a trigger field", () => {
  const start = source.indexOf("function scheduleActivationAfterFlowReply");
  const end = source.indexOf("function isValidFlowNode", start);
  const scheduler = source.slice(start, end);
  assert.equal(scheduler.includes("activation.trigger"), false);
  assert.equal(scheduler.includes("scheduleCurrentActivation"), true);
});

test("friend-added activation reads only the flow entry node", () => {
  const start = source.indexOf("async function handleFriendAddedEvent");
  const end = source.indexOf("\nfunction commandCallbackLogFields", start);
  const handler = source.slice(start, end);
  assert.equal(handler.includes("getFlowNode(machine, machine.entryNodeId)"), true);
  assert.equal(handler.includes("activation.trigger"), false);
});

test("friend-added activation uses durable re-entry and reports cooldown skips", () => {
  const start = source.indexOf("async function handleFriendAddedEvent");
  const end = source.indexOf("\nfunction commandCallbackLogFields", start);
  const handler = source.slice(start, end);

  assert.equal(handler.includes("beginFriendAddedFlowEntry"), true);
  assert.equal(handler.includes('reason: "friend_added_cooldown"'), true);
  assert.equal(handler.includes("existing_entry_session"), false);
});

test("friend-added re-entry cooldown defaults to immediate retriggering", () => {
  assert.match(source, /FRIEND_ADDED_REENTRY_COOLDOWN_MINUTES \|\| 0/);
});

test("friend-added re-entry happens even when the entry node has no activation script", () => {
  const start = source.indexOf("async function handleFriendAddedEvent");
  const end = source.indexOf("\nfunction commandCallbackLogFields", start);
  const handler = source.slice(start, end);

  assert.equal(
    handler.indexOf("beginFriendAddedFlowEntry") < handler.indexOf('reason: "entry_activation_not_configured"'),
    true
  );
});

test("friend-added activation uses the task atomically created by durable re-entry", () => {
  const start = source.indexOf("async function handleFriendAddedEvent");
  const end = source.indexOf("\nfunction commandCallbackLogFields", start);
  const handler = source.slice(start, end);

  assert.equal(handler.includes("entryResult.session"), true);
  assert.equal(handler.includes("const task = entryResult.task"), true);
  assert.equal(handler.includes("messageIndex: 0"), false);
});

test("friend-added callback delegates existing session handling to the durable re-entry helper", () => {
  const start = source.indexOf("async function handleFriendAddedEvent");
  const end = source.indexOf("\nfunction commandCallbackLogFields", start);
  const handler = source.slice(start, end);
  assert.equal(handler.includes("existing_session_not_at_entry"), false);
  assert.equal(handler.includes("getFlowSession(conversationKey)"), false);
});
