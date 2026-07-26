import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("conversation reset sync clears workspace history before customer session memory", () => {
  const start = source.indexOf("export async function syncConversationResetToAgent");
  const end = source.indexOf("\nfunction invalidSendabilityAgentReply", start);
  const sync = source.slice(start, end);

  assert.ok(start >= 0);
  assert.match(sync, /buildDclawConversationResetRequest/);
  assert.match(sync, /buildDclawConversationMemoryClearRequest/);
  assert.match(sync, /runConversationResetRequests/);
  assert.match(sync, /markConversationResetHandledForEpoch/);
  assert.match(sync, /agent\.conversation_reset\.failed/);
  assert.doesNotMatch(sync, /enqueueAgentInvocation\(runReset\)/);
});

test("agent replies are discarded when their conversation epoch became stale", () => {
  const start = source.indexOf("async function processCoalescedIncomingBatch");
  const end = source.indexOf("\nfunction commandCallbackLogFields", start);
  const handler = source.slice(start, end);
  const staleCheck = handler.indexOf("isConversationEpochCurrent");
  const send = handler.indexOf("sendTextReplyParts");

  assert.ok(staleCheck >= 0);
  assert.ok(send >= 0);
  assert.ok(staleCheck < send);
  assert.match(handler, /agent\.reply\.stale_skipped/);
});

test("reset route stays local-first and wakes background cleanup without awaiting DClaw", () => {
  const routeStart = source.indexOf('"/api/flow-sessions/:conversationKey/reset"');
  const route = source.slice(routeStart, routeStart + 1800);
  assert.equal(routeStart >= 0, true);
  assert.match(route, /clearConversationForReset/);
  assert.match(route, /conversationResetWorker\.wake\(\)/);
  assert.doesNotMatch(route, /await syncConversationResetToAgent/);
  assert.doesNotMatch(route, /agentSync/);
  assert.match(route, /reason: "conversation_reset"/);
});

test("private new activity rotates epoch without waiting for an old reset attempt", () => {
  const start = source.indexOf("async function processIncomingMessage");
  const end = source.indexOf("async function processCoalescedIncomingBatch", start);
  const handler = source.slice(start, end);
  const prepare = handler.indexOf("prepareConversationResetForNewActivity");
  const persist = handler.indexOf("persistInboundConversation");

  assert.doesNotMatch(handler, /waitForConversation/);
  assert.ok(prepare >= 0 && prepare < persist);
  assert.match(handler, /resetPending: resetState\.resetPending/);
});
