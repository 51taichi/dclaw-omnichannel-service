import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

function functionBody(name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} is defined`);
  const signatureEnd = source.indexOf(") {", start);
  assert.notEqual(signatureEnd, -1, `${name} has a function signature`);
  const open = signatureEnd + 2;
  assert.notEqual(open, -1, `${name} has a body`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  assert.fail(`${name} body is closed`);
}

test("incoming agent calls build and pass tag context", () => {
  const body = functionBody("processIncomingMessage");
  assert.match(body, /const tagContext = buildTagContext\(\{ binding, conversationKey \}\);/);
  assert.match(body, /const request = buildDclawRequest\(\{[\s\S]*\n\s+tagContext,\n[\s\S]*\}\);/);
});

test("server applies tag decisions only after valid agent replies", () => {
  const body = functionBody("processIncomingMessage");
  const applyIndex = body.indexOf("applyAgentTagDecision({");
  const validIndex = body.indexOf("if (!strictInvocation.agentReply.valid)");
  assert.ok(applyIndex > validIndex);
  assert.match(body.slice(validIndex, applyIndex), /return;/);
  assert.match(functionBody("applyAgentTagDecision"), /agentReply\?\.tagDecision/);
});

test("tag decisions cancel activation work for tags made inactive", () => {
  const body = functionBody("applyAgentTagDecision");
  assert.match(body, /acceptedInactiveTags/);
  assert.match(body, /oldTagIds/);
  assert.match(body, /cancelTagActivationTasks\(\{[\s\S]*groupId:[\s\S]*tagId:[\s\S]*reason: "tag_inactive"/);
});

test("friend-added event can create date tags", () => {
  assert.match(source, /applySystemDateTag/);
  assert.match(source, /friend_added\.date_tag\.applied/);
});

test("conversation reset and handoff cancel tag activation work", () => {
  assert.match(source, /cancelTagActivationTasks\(\{[\s\S]*reason: "human_handoff"/);
  assert.match(source, /cancelTagActivationTasks\(\{[\s\S]*reason: "conversation_reset"/);
});
