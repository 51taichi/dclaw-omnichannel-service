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

test("every private Agent call builds tag context while group calls do not", () => {
  const body = functionBody("processCoalescedIncomingBatch");
  assert.match(body, /const tagContext = isPrivateMessage\(message\)/);
  assert.match(body, /buildTagContext\(\{ binding, conversationKey \}\)/);
  assert.match(body, /tagContext,/);
  assert.doesNotMatch(body, /const tagContext = legacyHistoryAnalysis\?\.text/);
});

test("validated Agent replies apply tag decisions before empty reply or WorkTool send handling", () => {
  const body = functionBody("processCoalescedIncomingBatch");
  const validIndex = body.indexOf("if (!strictInvocation.agentReply.valid)");
  const decisionIndex = body.indexOf("applyAgentTagDecision");
  const emptyIndex = body.indexOf('logWarn("agent.reply.empty"');
  const sendIndex = body.indexOf("sendTextReplyParts");
  assert.ok(validIndex >= 0);
  assert.ok(decisionIndex > validIndex);
  assert.ok(decisionIndex < emptyIndex);
  assert.ok(decisionIndex < sendIndex);
  assert.match(body, /evidenceCandidates:/);
});

test("flow asset patches are constrained by current task configuration", () => {
  const applyBody = functionBody("applyFlowDecision");
  const coalescedBody = functionBody("processCoalescedIncomingBatch");

  assert.match(source, /filterConfiguredCollectedDataPatch/);
  assert.match(
    applyBody,
    /filterConfiguredCollectedDataPatch\(\{[\s\S]*flow,[\s\S]*patch:[\s\S]*fillOnlyMissing/
  );
  assert.match(applyBody, /if \(Object\.keys\(patch\)\.length\)/);
  assert.match(
    coalescedBody,
    /applyFlowDecision\(\{[\s\S]*fillOnlyMissing: shouldAnalyzeLegacyHistory/
  );
});

test("private inbound messages persist their session before coalesced agent work", () => {
  const incomingBody = functionBody("processIncomingMessage");
  const coalescedBody = functionBody("processCoalescedIncomingBatch");
  const persistBody = functionBody("persistInboundConversation");
  assert.match(source, /function persistInboundConversation\(\{/);
  assert.match(persistBody, /skipFirstSeenDateTag/);
  assert.match(incomingBody, /const persisted =[\s\S]*persistInboundConversation\(\{[\s\S]*message,[\s\S]*\}/);
  assert.ok(
    incomingBody.indexOf("persistInboundConversation") < incomingBody.indexOf("inboundCoalescer.push"),
    "conversation persistence must happen before the coalescer waits or invokes the Agent"
  );
  assert.match(incomingBody, /conversationMessageId: persisted\.messageRecord\?\.id/);
  assert.match(persistBody, /const messageRecord = shouldRecordConversationHistory\(message\)/);
  assert.match(persistBody, /return \{ conversation, messageRecord \}/);
  assert.match(coalescedBody, /const conversation = getConversation\(conversationKey\);/);
  assert.doesNotMatch(coalescedBody, /const conversation = upsertConversation\(/);
});

test("manual tag changes cancel activation work for tags made inactive", () => {
  const cancelBody = functionBody("cancelTagTasksForAcceptedChanges");
  const applyBody = functionBody("applyManualConversationTagChange");
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
  assert.match(
    functionBody("applySystemDateTag"),
    /ensureConversationDateTag\(\{[\s\S]*firstSeenAt:/
  );
  assert.doesNotMatch(
    functionBody("applySystemDateTag"),
    /dateTagId:\s*dateTagIdFor\(firstSeenAt/
  );
});

test("service startup initializes legacy date tag rule times without historical backfill", () => {
  const backfillIndex = source.indexOf("initializeLegacyDateTagRuleEffectiveTimes();");
  const listenIndex = source.indexOf("app.listen(port, host");
  assert.ok(backfillIndex >= 0);
  assert.ok(backfillIndex < listenIndex);
  assert.doesNotMatch(source, /backfillEnabledConversationFirstSeenDateTags\(\)/);
});

test("conversation reset and handoff cancel tag activation work", () => {
  assert.match(source, /cancelTagActivationTasks\(\{[\s\S]*reason: "human_handoff"/);
  assert.match(source, /cancelTagActivationTasks\(\{[\s\S]*reason: "conversation_reset"/);
});
