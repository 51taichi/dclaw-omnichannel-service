import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const envExample = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf8");

test("server configures an inbound coalescer with approved defaults", () => {
  assert.match(source, /createInboundMessageCoalescer/);
  assert.match(source, /INBOUND_COALESCE_QUIET_MS \|\| 10_000/);
  assert.match(source, /INBOUND_COALESCE_MAX_MS \|\| 15_000/);
});

test("multiple inbound texts are presented to the Agent as one ordered customer turn", () => {
  assert.match(source, /function buildCoalescedAgentMessage\(messages\)/);
  assert.match(source, /客户连续发送了以下消息，请结合上下文统一回答/);
  assert.match(source, /const agentMessage = normalizeMessageForAgent\(coalescedMessage, binding\)/);
  assert.match(source, /coalescedMessages/);
  assert.match(source, /atMe: mentioned \? "true" : last\.atMe/);
});

test("callbacks persist and cancel old activation before entering the buffer", () => {
  const handlerStart = source.indexOf("async function processIncomingMessage");
  const push = source.indexOf("inboundCoalescer.push", handlerStart);
  assert.ok(handlerStart >= 0 && push > handlerStart);
  assert.ok(source.indexOf("insertIncomingMessage", handlerStart) < push);
  assert.ok(source.indexOf("insertConversationMessage", handlerStart) < push);
  assert.ok(source.indexOf("invalidateFlowActivation", handlerStart) < push);
});

test("friend-added, unsupported, human handoff, and debug replies finish before buffering", () => {
  const handlerStart = source.indexOf("async function processIncomingMessage");
  const push = source.indexOf("inboundCoalescer.push", handlerStart);
  assert.ok(source.indexOf("handleFriendAddedEvent", handlerStart) < push);
  assert.ok(source.indexOf("non_text_or_empty_message", handlerStart) < push);
  assert.ok(source.indexOf('status: "human_handoff"', handlerStart) < push);
  assert.ok(source.indexOf("handleDebugPing", handlerStart) < push);
});

test("automatic friend greetings are recorded but cannot cancel activation or invoke the Agent", () => {
  const handlerStart = source.indexOf("async function processIncomingMessage");
  const handlerEnd = source.indexOf("async function processCoalescedIncomingBatch", handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);
  const greeting = handler.indexOf("isSystemFriendGreeting(message)");
  const invalidation = handler.indexOf("invalidateFlowActivation");
  const push = handler.indexOf("inboundCoalescer.push");
  assert.ok(greeting >= 0 && greeting < invalidation && greeting < push);
  assert.match(handler, /recordSystemFriendGreeting\(\{ botId, binding, conversationKey, message \}\)/);
  assert.match(handler, /reason: "system_friend_greeting"/);
});

test("an unmentioned group continuation may only join an existing mentioned batch", () => {
  assert.match(source, /joinsMentionedGroupBatch/);
  assert.match(source, /isGroupMessage\(message\) && inboundCoalescer\.has\(coalesceKey\)/);
  assert.match(source, /!shouldInvokeAgent\(message, binding\) && !joinsMentionedGroupBatch/);
});

test("flushed processing performs one Agent and business-decision cycle", () => {
  const start = source.indexOf("async function processCoalescedIncomingBatch");
  const end = source.indexOf("\nfunction applyAgentTagDecision", start);
  const processor = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.equal((processor.match(/invokeStrictAgentReply\(/g) || []).length, 1);
  assert.equal((processor.match(/applyAgentTagDecision\(/g) || []).length, 1);
  assert.equal((processor.match(/applyFlowDecision\(/g) || []).length, 1);
  assert.equal((processor.match(/scheduleActivationAfterFlowReply\(/g) || []).length, 1);
});

test("coalescer lifecycle events have structured log names", () => {
  assert.match(source, /incoming\.coalesce\.started/);
  assert.match(source, /incoming\.coalesce\.appended/);
  assert.match(source, /incoming\.coalesce\.flushed/);
  assert.match(source, /incoming\.coalesce\.canceled/);
});

test("coalescing environment variables are documented", () => {
  assert.match(envExample, /^INBOUND_COALESCE_QUIET_MS=10000$/m);
  assert.match(envExample, /^INBOUND_COALESCE_MAX_MS=15000$/m);
});

test("pending batches are canceled when their lifecycle context becomes stale", () => {
  assert.match(source, /cancelInboundBatch\(inboundCoalesceKey\(botId, conversationKey\), "conversation_reset"\)/);
  assert.match(source, /cancelInboundBatch\(inboundCoalesceKey\(botId, conversationKey\), "human_handoff"\)/);
  assert.match(source, /cancelInboundBatchesForBot\(binding\.botId, "agent_rebound"\)/);
  assert.match(source, /cancelInboundBatchesForBot\(req\.params\.botId, "bot_deleted"\)/);
});
