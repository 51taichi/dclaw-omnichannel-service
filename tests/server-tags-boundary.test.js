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
  const body = functionBody("processCoalescedIncomingBatch");
  assert.match(body, /const tagContext = buildTagContext\(\{ binding, conversationKey \}\);/);
  assert.match(body, /const request = buildDclawRequest\(\{[\s\S]*\n\s+tagContext,\n[\s\S]*\}\);/);
});

test("server applies tag decisions only after valid agent replies", () => {
  const body = functionBody("processCoalescedIncomingBatch");
  const applyIndex = body.indexOf("applyAgentTagDecision({");
  const validIndex = body.indexOf("if (!strictInvocation.agentReply.valid)");
  assert.ok(applyIndex > validIndex);
  assert.match(body.slice(validIndex, applyIndex), /return;/);
  assert.match(functionBody("applyAgentTagDecision"), /agentReply\?\.tagDecision/);
});

test("private inbound messages persist their session before coalesced agent work", () => {
  const incomingBody = functionBody("processIncomingMessage");
  const coalescedBody = functionBody("processCoalescedIncomingBatch");
  assert.match(source, /function persistInboundConversation\(\{ botId, binding, conversationKey, message \}\)/);
  assert.match(incomingBody, /persistInboundConversation\(\{[\s\S]*message\n\s+\}\);/);
  assert.ok(
    incomingBody.indexOf("persistInboundConversation") < incomingBody.indexOf("inboundCoalescer.push"),
    "conversation persistence must happen before the coalescer waits or invokes the Agent"
  );
  assert.match(coalescedBody, /const conversation = getConversation\(conversationKey\);/);
  assert.doesNotMatch(coalescedBody, /const conversation = upsertConversation\(/);
});

test("tag decisions cancel activation work for tags made inactive", () => {
  const cancelBody = functionBody("cancelTagTasksForAcceptedChanges");
  const applyBody = functionBody("applyAgentTagDecision");
  assert.match(applyBody, /cancelTagTasksForAcceptedChanges\(\{/);
  assert.match(cancelBody, /for \(const oldTagId of change\.oldTagIds \|\| \[\]\)/);
  assert.match(cancelBody, /tagId: oldTagId/);
  assert.match(cancelBody, /reason: "tag_changed"/);
  assert.match(cancelBody, /if \(change\.action === "remove"\)/);
  assert.match(cancelBody, /tagId: change\.tagId/);
  assert.match(cancelBody, /reason: "tag_removed"/);
});

test("friend-added event can create date tags", () => {
  assert.match(source, /applySystemDateTag/);
  assert.match(source, /friend_added\.date_tag\.applied/);
});

test("service startup backfills enabled first-seen date tags", () => {
  const backfillIndex = source.indexOf("backfillEnabledConversationFirstSeenDateTags();");
  const listenIndex = source.indexOf("app.listen(port, host");
  assert.ok(backfillIndex >= 0);
  assert.ok(backfillIndex < listenIndex);
});

test("conversation reset and handoff cancel tag activation work", () => {
  assert.match(source, /cancelTagActivationTasks\(\{[\s\S]*reason: "human_handoff"/);
  assert.match(source, /cancelTagActivationTasks\(\{[\s\S]*reason: "conversation_reset"/);
});
