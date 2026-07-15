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
  assert.equal(handler.includes("scheduleFlowActivationTask"), true);
  assert.equal(handler.includes("invokeDclaw"), false);
  assert.equal(handler.includes("sendTextMessage"), false);
});

test("normal reply activation only accepts after_ai_reply triggers", () => {
  const start = source.indexOf("function scheduleActivationAfterFlowReply");
  const end = source.indexOf("function isValidFlowNode", start);
  assert.match(source.slice(start, end), /trigger !== "after_ai_reply"/);
});
