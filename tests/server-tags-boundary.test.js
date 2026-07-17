import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("incoming agent calls build and pass tag context", () => {
  assert.match(source, /buildTagContext/);
  assert.match(source, /tagContext/);
  assert.match(source, /buildDclawRequest\(\{[\s\S]*tagContext/);
});

test("server applies tag decisions only after valid agent replies", () => {
  const applyIndex = source.indexOf("applyAgentTagDecision");
  const validIndex = source.indexOf("if (!strictInvocation.agentReply.valid)");
  assert.ok(applyIndex > validIndex);
  assert.match(source, /agentReply\.tagDecision/);
});

test("friend-added event can create date tags", () => {
  assert.match(source, /applySystemDateTag/);
  assert.match(source, /friend_added\.date_tag\.applied/);
});

test("conversation reset and handoff cancel tag activation work", () => {
  assert.match(source, /cancelTagActivationTasks\(\{[\s\S]*reason: "human_handoff"/);
  assert.match(source, /cancelTagActivationTasks\(\{[\s\S]*reason: "conversation_reset"/);
});
