import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("both accepted Agent response paths persist attention alerts", () => {
  assert.equal(source.split("applyAgentAttentionAlert({").length - 1, 2);
  assert.match(source, /conversationEpoch: conversation\.conversationEpoch/);
  assert.match(source, /evidenceCandidates: tagEvidenceCandidates/);
});

test("normal attention persistence happens before every external reply send", () => {
  const start = source.indexOf("async function processCoalescedIncomingBatch");
  const end = source.indexOf("function manualTagGroupIdsForConversation", start);
  const body = source.slice(start, end);
  assert.ok(body.indexOf("if (!strictInvocation.agentReply.valid)") < body.indexOf("applyAgentAttentionAlert({"));
  assert.ok(body.indexOf("applyAgentAttentionAlert({") < body.indexOf("sendTextReplyParts({"));
  assert.ok(body.indexOf("applyAgentAttentionAlert({") < body.indexOf("sendAgentAttachments({"));
});

test("attention persistence does not change human handoff state", () => {
  const attentionStart = source.indexOf("const attentionResult = applyAgentAttentionAlert({");
  const attentionEnd = source.indexOf("if (attentionResult)", attentionStart);
  const block = source.slice(attentionStart, attentionEnd);
  assert.doesNotMatch(block, /updateFlowSessionHandoff|handoffStatus/);
});
