import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("server exposes a bot-scoped handoff route", () => {
  assert.equal(serverSource.includes('"/api/flow-sessions/:conversationKey/handoff"'), true);
  assert.equal(serverSource.includes("updateFlowSessionHandoff"), true);
});

test("server branches human handoff before sending WorkTool replies", () => {
  assert.equal(serverSource.includes("buildDclawHandoffTranscriptRequest"), true);
  assert.equal(serverSource.includes('status: "human_handoff"'), true);
  assert.equal(serverSource.includes("flow?.session?.handoffStatus === \"human\""), true);
});

test("human handoff is evaluated before debug auto-reply", () => {
  assert.equal(
    serverSource.indexOf('status: "human_handoff"') < serverSource.indexOf("incoming.debug_reply"),
    true
  );
});

test("debug auto-reply is scoped to the incoming bot", () => {
  assert.equal(serverSource.includes("function getDebugReplySettingKey(botId)"), true);
  assert.equal(serverSource.includes("function getDebugReplyConfig(botId)"), true);
  assert.equal(serverSource.includes("getDebugReplyConfig(botId)"), true);
  assert.equal(
    serverSource.includes('"/api/bots/:botId/settings/debug-reply"'),
    true
  );
  assert.equal(serverSource.includes("assertAdminForBot(req, req.params.botId)"), true);
});

test("server exposes manual reply route only for human handoff", () => {
  assert.equal(serverSource.includes('"/api/flow-sessions/:conversationKey/manual-reply"'), true);
  assert.equal(serverSource.includes('handoffStatus !== "human"'), true);
  assert.equal(serverSource.includes('source: "manual_reply"'), true);
  assert.equal(serverSource.includes("sendTextMessage({"), true);
  assert.equal(serverSource.includes("insertConversationMessage({"), true);
  assert.equal(serverSource.includes("insertOutgoingMessage({"), true);
});
