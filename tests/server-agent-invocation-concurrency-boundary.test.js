import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const envExample = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf8");

function functionBody(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing source boundary: ${startMarker}`);
  return source.slice(start, end);
}

test("Agent invocation queue defaults to three configured workers", () => {
  assert.match(envExample, /^DCLAW_AGENT_CONCURRENCY=3$/m);
  assert.match(
    source,
    /createAgentInvocationQueue\(\{\s*concurrency:\s*process\.env\.DCLAW_AGENT_CONCURRENCY\s*\|\|\s*3\s*\}\)/
  );
});

test("strict Agent invocation keeps one conversation key through every retry", () => {
  const body = functionBody(
    "async function invokeStrictAgentReply",
    "function getDebugReplySettingKey"
  );
  assert.match(body, /queueKey\s*=\s*""/);
  assert.match(
    body,
    /\{\s*priority:\s*queuePriority,\s*key:\s*queueKey\s*\}/
  );
  assert.equal(
    body.match(/\{\s*priority:\s*queuePriority,\s*key:\s*queueKey\s*\}/g)?.length,
    2
  );
});

test("realtime and activation Agent paths pass their conversation key", () => {
  const activation = functionBody(
    "async function sendActivationPolishedMessage",
    "async function processFlowActivationTask"
  );
  const tagActivation = functionBody(
    "async function buildPolishedTagActivationContent",
    "async function processTagActivationTask"
  );
  const callback = functionBody(
    "async function processIncomingMessage",
    "async function processCoalescedIncomingBatch"
  );
  const coalesced = functionBody(
    "async function processCoalescedIncomingBatch",
    "function applyManualConversationTagChange"
  );

  assert.match(activation, /queueKey:\s*task\.conversationKey/);
  assert.match(tagActivation, /queueKey:\s*task\.conversationKey/);
  assert.match(callback, /queueKey:\s*conversationKey/);
  assert.match(
    callback,
    /enqueueAgentInvocation\([\s\S]*?\{\s*key:\s*conversationKey\s*\}/
  );
  assert.match(coalesced, /queueKey:\s*conversationKey/);
});
