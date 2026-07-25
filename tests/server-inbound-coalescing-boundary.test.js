import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const envExample = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf8");

test("server configures an inbound coalescer with approved defaults", () => {
  assert.match(source, /createInboundMessageCoalescer/);
  assert.match(source, /baseQuietMs: inboundCoalesceDefaults\.baseQuietMs/);
  assert.match(source, /incrementMs: inboundCoalesceDefaults\.incrementMs/);
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
  assert.match(source, /function ingestIncomingMessage\([\s\S]*insertIncomingMessage\([\s\S]*beginMessageProcessing\(/);
  assert.ok(source.indexOf("ingestIncomingMessage", handlerStart) < push);
  assert.ok(source.indexOf("persistInboundConversation", handlerStart) < push);
  assert.match(source, /function persistInboundConversation\([\s\S]*insertConversationMessage\(/);
  assert.ok(source.indexOf("invalidateFlowActivation", handlerStart) < push);
});

test("message callback persists before acknowledging WorkTool", () => {
  assert.match(source, /function ingestIncomingMessage\(\{ botId, message \}\)/);
  assert.match(source, /function ingestIncomingMessage\([\s\S]*insertIncomingMessage\([\s\S]*beginMessageProcessing\(/);
  for (const route of [
    'app.post("/worktool/:botId/message-callback"',
    'app.post("/worktool/message-callback"'
  ]) {
    const start = source.indexOf(route);
    const end = source.indexOf("\n});", start);
    const handler = source.slice(start, end);
    assert.ok(start >= 0 && end > start);
    assert.ok(handler.indexOf("ingestIncomingMessage") < handler.indexOf("res.json"));
  }
});

test("system friend greeting, unsupported, human handoff, and debug replies finish before buffering", () => {
  const handlerStart = source.indexOf("async function processIncomingMessage");
  const push = source.indexOf("inboundCoalescer.push", handlerStart);
  assert.ok(source.indexOf("isSystemFriendGreeting(message)", handlerStart) < push);
  assert.equal(source.includes("isFriendAddedEvent(message)"), false);
  assert.ok(source.indexOf("non_text_or_empty_message", handlerStart) < push);
  assert.ok(source.indexOf('status: "human_handoff"', handlerStart) < push);
  assert.ok(source.indexOf("handleDebugPing", handlerStart) < push);
});

test("automatic friend greetings trigger friend-added handling without canceling activation or invoking the Agent", () => {
  const handlerStart = source.indexOf("async function processIncomingMessage");
  const handlerEnd = source.indexOf("async function processCoalescedIncomingBatch", handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);
  const greeting = handler.indexOf("isSystemFriendGreeting(message)");
  const invalidation = handler.indexOf("invalidateFlowActivation");
  const push = handler.indexOf("inboundCoalescer.push");
  assert.ok(greeting >= 0 && greeting < invalidation && greeting < push);
  assert.match(handler, /handleFriendAddedEvent\(\{ botId, binding, message, logContext, conversationKey \}\)/);
  assert.match(handler, /reason: "system_friend_greeting"/);
});

test("an unmentioned group continuation may only join an existing mentioned batch", () => {
  assert.match(source, /joinsMentionedGroupBatch/);
  assert.match(source, /isGroupMessage\(message\) && inboundCoalescer\.has\(coalesceKey\)/);
  assert.match(source, /!shouldInvokeAgent\(message, binding\) && !joinsMentionedGroupBatch/);
});

test("flushed processing performs one Agent and business-decision cycle", () => {
  const start = source.indexOf("async function processCoalescedIncomingBatch");
  const end = source.indexOf("\nfunction applyManualConversationTagChange", start);
  const processor = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.equal((processor.match(/invokeStrictAgentReply\(/g) || []).length, 1);
  assert.equal((processor.match(/applyAgentTagDecision\(/g) || []).length, 0);
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
  assert.doesNotMatch(envExample, /^INBOUND_COALESCE_MAX_MS=/m);
});

test("pending batches are canceled when their lifecycle context becomes stale", () => {
  assert.match(source, /cancelInboundBatch\(inboundCoalesceKey\(botId, conversationKey\), "conversation_reset"\)/);
  assert.match(source, /cancelInboundBatch\(inboundCoalesceKey\(botId, conversationKey\), "human_handoff"\)/);
  assert.match(source, /cancelInboundBatchesForBot\(binding\.botId, "agent_rebound"\)/);
  assert.match(source, /cancelInboundBatchesForBot\(req\.params\.botId, "bot_deleted"\)/);
});
