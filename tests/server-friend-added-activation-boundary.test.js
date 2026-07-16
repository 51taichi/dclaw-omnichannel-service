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
  assert.equal(handler.includes("scheduleCurrentActivation"), true);
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

test("friend-added activation schedules only index zero for a new entry session", () => {
  const start = source.indexOf("async function handleFriendAddedEvent");
  const end = source.indexOf("\nfunction commandCallbackLogFields", start);
  const handler = source.slice(start, end);

  assert.equal(handler.includes("!existingSession"), true);
  assert.equal(handler.includes("scheduleCurrentActivation({"), true);
  assert.equal(handler.includes("messageIndex: 0"), false);
});

test("friend-added callback does not reset an existing non-entry flow session", () => {
  const start = source.indexOf("async function handleFriendAddedEvent");
  const end = source.indexOf("\nfunction commandCallbackLogFields", start);
  const handler = source.slice(start, end);
  assert.equal(handler.includes("existing_session_not_at_entry"), true);
  assert.equal(handler.includes("existingSession.currentNodeId !== machine.entryNodeId"), true);
});
