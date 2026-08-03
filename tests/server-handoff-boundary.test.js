import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

function processIncomingBody() {
  const start = serverSource.indexOf("async function processIncomingMessage");
  const end = serverSource.indexOf("async function processCoalescedIncomingBatch", start);
  assert.ok(start >= 0 && end > start);
  return serverSource.slice(start, end);
}

function functionBody(name) {
  const start = serverSource.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} is defined`);
  const signatureEnd = serverSource.indexOf(") {", start);
  assert.notEqual(signatureEnd, -1, `${name} has a function signature`);
  const open = signatureEnd + 2;
  let depth = 0;
  for (let index = open; index < serverSource.length; index += 1) {
    if (serverSource[index] === "{") depth += 1;
    if (serverSource[index] === "}") depth -= 1;
    if (depth === 0) return serverSource.slice(open + 1, index);
  }
  assert.fail(`${name} body is closed`);
}

test("server exposes a bot-scoped handoff route", () => {
  assert.equal(serverSource.includes('"/api/flow-sessions/:conversationKey/handoff"'), true);
  assert.equal(serverSource.includes("updateFlowSessionHandoff"), true);
});

test("server branches human handoff before sending WorkTool replies", () => {
  const body = processIncomingBody();
  const handoffStart = body.indexOf("if (isHumanHandoff)");
  const handoffEnd = body.indexOf("finishMessageProcessing({ messageKey, status: \"human_handoff\" })");
  const handoffBlock = body.slice(handoffStart, handoffEnd);

  assert.equal(serverSource.includes("buildDclawHandoffTranscriptRequest"), true);
  assert.equal(serverSource.includes('status: "human_handoff"'), true);
  assert.equal(serverSource.includes("if (isHumanHandoff)"), true);
  assert.match(handoffBlock, /buildTagContext\(\{ binding, conversationKey, group \}\)/);
  assert.match(handoffBlock, /invokeStrictAgentReply\(\{/);
  assert.match(handoffBlock, /persistAgentTagAudit\(\{/);
  assert.match(handoffBlock, /applyAgentTagDecision\(\{/);
  assert.ok(
    handoffBlock.indexOf("persistAgentTagAudit({")
      < handoffBlock.indexOf("applyAgentTagDecision({")
  );
  assert.doesNotMatch(handoffBlock, /sendTextReplyParts\(/);
  assert.doesNotMatch(handoffBlock, /sendAgentAttachments\(/);
});

test("group human handoff bypasses visible reply policy and uses the silent sync branch", () => {
  const incomingBody = functionBody("processIncomingMessage");
  const coalescedBody = functionBody("processCoalescedIncomingBatch");
  const handoffIndex = incomingBody.indexOf("const isHumanHandoff");
  const policyIndex = incomingBody.indexOf("if (!isHumanHandoff && !groupPolicy.invokeAgent");

  assert.ok(handoffIndex >= 0);
  assert.ok(policyIndex > handoffIndex);
  assert.match(incomingBody, /if \(isHumanHandoff\)/);
  assert.doesNotMatch(incomingBody, /flow\?\.session\?\.handoffStatus === "human"/);
  assert.match(coalescedBody, /const coalescedHandoffSession = getFlowSession\(conversationKey\)/);
  assert.match(coalescedBody, /if \(coalescedHandoffSession\?\.handoffStatus === "human"\)/);
  assert.doesNotMatch(coalescedBody, /flow\?\.session\?\.handoffStatus === "human"/);
});

test("visible Agent sends recheck handoff after DClaw and before every WorkTool command", () => {
  const coalescedBody = functionBody("processCoalescedIncomingBatch");
  const failureFallbackBody = functionBody("sendAgentFailureFallback");
  const textSendBody = functionBody("sendTextReplyParts");
  const attachmentSendBody = functionBody("sendAgentAttachments");
  const callbackText = "beforeSend: () => assertConversationAiControlled({ botId, conversationKey })";

  assert.equal(coalescedBody.split(callbackText).length - 1, 2);
  assert.ok(textSendBody.indexOf("beforeSend?.()") < textSendBody.indexOf("sendTextMessage({"));
  assert.ok(attachmentSendBody.indexOf("beforeSend?.()") < attachmentSendBody.indexOf("sendMediaMessage({"));
  assert.match(
    coalescedBody,
    /sentAttachments = await sendAgentAttachments\([\s\S]*assertConversationAiControlled\(\{ botId, conversationKey \}\);[\s\S]*if \(flow\)/
  );
  assert.match(coalescedBody, /if \(error\?\.code === "HUMAN_HANDOFF_BEFORE_SEND"\)/);
  assert.ok(
    coalescedBody.indexOf('error?.code === "HUMAN_HANDOFF_BEFORE_SEND"')
      < coalescedBody.indexOf("sendAgentFailureFallback({")
  );
  assert.match(failureFallbackBody, /beforeSend: \(\) => assertConversationAiControlled\(\{ botId, conversationKey \}\)/);
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

test("server exposes manual reply route for private and group human handoff", () => {
  assert.equal(serverSource.includes('"/api/flow-sessions/:conversationKey/manual-reply"'), true);
  assert.equal(serverSource.includes('handoffStatus !== "human"'), true);
  assert.equal(serverSource.includes('source: "manual_reply"'), true);
  assert.equal(serverSource.includes("sendTextMessage({"), true);
  assert.equal(serverSource.includes("insertConversationMessage({"), true);
  assert.equal(serverSource.includes("insertOutgoingMessage({"), true);
  assert.doesNotMatch(serverSource, /manual reply only supports private conversations/);
  const targetBody = functionBody("manualReplyTargetForConversation");
  assert.match(targetBody, /getGroupByConversationKey\(\{ botId, conversationKey \}\)/);
  assert.match(targetBody, /managedGroup\?\.currentName/);
  assert.match(targetBody, /privateTargetNameFromConversationKey\(conversationKey\)/);
});
