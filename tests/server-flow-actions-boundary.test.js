import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const dbSource = fs.readFileSync(new URL("../src/db.js", import.meta.url), "utf8");

test("server persists flow actions and adds the current contact through the channel adapter", () => {
  assert.equal(source.includes("reserveFlowActionExecution"), true);
  assert.equal(source.includes("markFlowActionExecutionSucceeded"), true);
  assert.equal(source.includes("markFlowActionExecutionFailed"), true);
  assert.equal(source.includes("addGroupParticipants"), true);
  assert.equal(source.includes("sendGroupInviteCommand"), false);
  assert.equal(dbSource.includes("CREATE TABLE IF NOT EXISTS flow_action_executions"), true);
});

test("flow actions execute only for private conversations and current contact", () => {
  const helperStart = source.indexOf("async function executeFlowActions");
  const helperEnd = source.indexOf("\nasync function applyFlowDecision", helperStart);
  const helper = source.slice(helperStart, helperEnd);

  assert.equal(helperStart > -1, true);
  assert.equal(helper.includes("isPrivateConversationKey(conversationKey)"), true);
  assert.equal(helper.includes("privateTargetNameFromConversationKey(conversationKey)"), true);
  assert.equal(helper.includes('action.target !== "current_contact"'), true);
  assert.equal(helper.includes("addGroupParticipants("), true);
  assert.equal(helper.includes("insertOutgoingMessage({"), true);
  assert.equal(helper.includes('source: "flow_action"'), true);
});

test("node completion actions run after a valid node transition", () => {
  const start = source.indexOf("async function applyFlowDecision");
  const end = source.indexOf("\nfunction looksLikeInternalNonReplyAnalysis", start);
  const helper = source.slice(start, end);

  assert.equal(helper.includes("const completedNode = getFlowNode(flow.machine, flow.session.currentNodeId)"), true);
  assert.equal(helper.includes("updateFlowSessionNode({"), true);
  assert.equal(helper.includes('invalidateFlowActivation({ conversationKey, reason: "node_transition" })'), true);
  assert.equal(helper.includes('source: "node_complete"'), true);
  assert.equal(
    helper.indexOf("updateFlowSessionNode({") < helper.indexOf("executeFlowActions({"),
    true
  );
});

test("node completion uses the configured completion target instead of the Agent suggestion", () => {
  const start = source.indexOf("async function applyFlowDecision");
  const end = source.indexOf("\nfunction looksLikeInternalNonReplyAnalysis", start);
  const helper = source.slice(start, end);

  assert.match(
    helper,
    /const configuredNextNodeId = String\(completedNode\?\.nextNodeId \|\| ""\)\.trim\(\)/
  );
  assert.doesNotMatch(helper, /String\(decision\.nextNodeId \|\| ""\)/);
  assert.match(
    helper,
    /updateFlowSessionNode\(\{[\s\S]*nextNodeId: configuredNextNodeId/
  );
});

test("activation actions run only after delivery is finalized", () => {
  const start = source.indexOf("async function processFlowActivationTask");
  const end = source.indexOf("\nasync function processFlowActivationBatch", start);
  const helper = source.slice(start, end);

  assert.equal(helper.includes("finalizeFlowActivationTaskDelivery"), true);
  assert.equal(helper.includes('source: "activation_sent"'), true);
  assert.equal(helper.includes("mergedActivationActions"), true);
  assert.equal(
    helper.indexOf("finalizeFlowActivationTaskDelivery") < helper.indexOf("executeFlowActions({"),
    true
  );
});
