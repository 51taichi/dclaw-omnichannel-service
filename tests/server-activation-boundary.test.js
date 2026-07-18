import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const dbSource = fs.readFileSync(new URL("../src/db.js", import.meta.url), "utf8");

test("server schedules activation after successful private flow replies", () => {
  assert.equal(source.includes("scheduleActivationAfterFlowReply"), true);
  assert.equal(source.includes("scheduleCurrentActivation"), true);
  assert.equal(source.includes("scheduleFlowActivationTask"), true);
  assert.equal(source.includes("getFlowActivationProgress"), true);
  assert.equal(source.includes('reason: "flow_reply_sent"'), true);
  assert.equal(dbSource.includes("advanceFlowActivationProgress"), true);
  assert.equal(source.includes("activationSourceNode"), false);
  assert.equal(
    source.slice(source.indexOf("worktool.send.success")).includes("scheduleActivationAfterFlowReply({"),
    true
  );
});

test("server cancels activation on inbound messages, handoff, reset, and node transition", () => {
  assert.equal(source.includes('reason: "customer_replied"'), true);
  assert.equal(source.includes('reason: "human_handoff"'), true);
  assert.equal(source.includes('reason: "conversation_reset"'), true);
  assert.equal(source.includes('reason: "node_transition"'), true);
  assert.equal(dbSource.includes("incrementFlowActivationGeneration"), true);
});

test("manual console node changes immediately invalidate prior activation work", () => {
  const start = source.indexOf('app.put(\n  "/api/flow-sessions/:conversationKey/node"');
  const end = source.indexOf('\napp.post(\n  "/api/flow-sessions/:conversationKey/reset"', start);
  const handler = source.slice(start, end);

  assert.equal(handler.includes("updateFlowSessionNode({"), true);
  assert.equal(
    handler.includes('invalidateFlowActivation({ conversationKey, reason: "console_node_change" })'),
    true
  );
  assert.equal(
    handler.indexOf("updateFlowSessionNode({") <
      handler.indexOf('invalidateFlowActivation({ conversationKey, reason: "console_node_change" })'),
    true
  );
});

test("private non-text customer interactions cancel activation before agent filtering", () => {
  const start = source.indexOf("async function processIncomingMessage");
  const handler = source.slice(start);
  assert.equal(
    handler.indexOf('invalidateFlowActivation({ conversationKey, reason: "customer_replied" })') <
      handler.indexOf("if (!shouldProcessInboundForAgent(message))"),
    true
  );
});

test("entry activation schedules after both new friends and AI replies", () => {
  assert.equal(source.includes("handleFriendAddedEvent"), true);
  assert.equal(source.includes("scheduleActivationAfterFlowReply({"), true);
  assert.equal(source.includes('reason: "customer_replied"'), true);
});

test("activation worker rechecks cancellation immediately before send", () => {
  assert.equal(source.includes("isFlowActivationTaskProcessing"), true);
  assert.equal(source.includes("function assertActivationTaskStillSendable(task)"), true);
  assert.equal(source.includes("assertActivationTaskStillSendable(task);"), true);
  assert.equal(source.includes('reason: "task_no_longer_processing_after_send"'), true);
});

test("activation schedules the unfinished message with its own timing", () => {
  const start = source.indexOf("function scheduleCurrentActivation");
  const end = source.indexOf("function scheduleActivationAfterFlowReply", start);
  const scheduler = source.slice(start, end);

  assert.equal(scheduler.includes("getFlowActivationProgress"), true);
  assert.equal(scheduler.includes("activation.messages[progress.messageIndex]"), true);
  assert.equal(scheduler.includes("attemptNumber = progress.sentCount + 1"), true);
  assert.equal(scheduler.includes("messageIndex: progress.messageIndex"), true);
  assert.equal(scheduler.includes("activationMessage.intervalMinutes"), true);
});

test("activation sends its immutable message snapshot then advances before scheduling", () => {
  const rawStart = source.indexOf("async function sendActivationRawMessages");
  const polishedStart = source.indexOf("async function sendActivationPolishedMessage");
  const processStart = source.indexOf("async function processFlowActivationTask");
  const batchStart = source.indexOf("async function processFlowActivationBatch", processStart);
  const rawSender = source.slice(rawStart, polishedStart);
  const polishedSender = source.slice(polishedStart, processStart);
  const processor = source.slice(processStart, batchStart);

  assert.equal(rawSender.includes("task.messageContent"), true);
  assert.equal(rawSender.includes("activationMessageForAttempt"), false);
  assert.equal(polishedSender.includes("task.messageContent"), true);
  assert.equal(processor.includes("finalizeFlowActivationTaskDelivery"), true);
  assert.equal(processor.indexOf("finalizeFlowActivationTaskDelivery") < processor.indexOf("scheduleCurrentActivation"), true);
  assert.equal(processor.includes("anchorAt: sentTask.sentAt"), true);
});

test("canceled in-flight delivery records send outcome without touching activation progress", () => {
  const processStart = source.indexOf("async function processFlowActivationTask");
  const batchStart = source.indexOf("async function processFlowActivationBatch", processStart);
  const processor = source.slice(processStart, batchStart);

  assert.equal(processor.includes("finalizeFlowActivationTaskDelivery"), true);
  assert.equal(processor.includes("allowStaleGeneration"), false);
  assert.equal(processor.includes("!sentTask.wasCanceled"), true);
  assert.equal(processor.includes('reason: "canceled_task_delivered"'), false);
});

test("friend-added re-entry never lets a canceled old task advance new activation state", () => {
  const processStart = source.indexOf("async function processFlowActivationTask");
  const batchStart = source.indexOf("async function processFlowActivationBatch", processStart);
  const processor = source.slice(processStart, batchStart);

  assert.equal(processor.includes("finalizeFlowActivationTaskDelivery"), true);
  assert.equal(dbSource.includes("finalizeFlowActivationTaskDelivery"), true);
});

test("saving a flow machine invalidates pending activation work without clearing progress", () => {
  assert.equal(dbSource.includes("resetAgentFlowActivationState"), true);
  assert.equal(dbSource.includes("flow_machine_saved"), true);
  const helperStart = dbSource.indexOf("function resetAgentFlowActivationState");
  const helperEnd = dbSource.indexOf("\nexport function getFlowMachine", helperStart);
  const helperSource = dbSource.slice(helperStart, helperEnd);
  assert.equal(helperSource.includes("activation_generation = COALESCE(activation_generation, 0) + 1"), true);
  assert.equal(helperSource.includes("activation_state_json = NULL"), false);
});
