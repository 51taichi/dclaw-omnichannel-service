import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const envExample = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("both normalized friend signals enter the same handler before ordinary message filtering", () => {
  assert.equal(source.includes("handleFriendAddedEvent"), true);
  assert.equal(source.includes("resolveFriendAddedSignal(message)"), true);
  assert.equal(source.includes("friendAddedSignal.message"), true);
  assert.equal(source.includes("friendAddedSignal.trigger"), true);
  assert.equal(
    source.indexOf("resolveFriendAddedSignal(message)") < source.indexOf("shouldProcessInboundForAgent(message)"),
    true
  );
});

test("friend-added activation never sends a welcome message", () => {
  const start = source.indexOf("async function handleFriendAddedEvent");
  const end = source.indexOf("\nfunction commandCallbackLogFields", start);
  const handler = source.slice(start, end);
  assert.equal(handler.includes("scheduleCurrentActivation"), false);
  assert.equal(handler.includes("activationDueAtForAttempt"), true);
  assert.equal(handler.includes("sendTextMessage"), false);
});

test("normal reply activation does not depend on a trigger field", () => {
  const start = source.indexOf("function scheduleActivationAfterFlowReply");
  const end = source.indexOf("function isValidFlowNode", start);
  const scheduler = source.slice(start, end);
  assert.equal(scheduler.includes("activation.trigger"), false);
  assert.equal(scheduler.includes("scheduleCurrentActivation"), true);
});

test("friend-added activation reads only the flow entry node", () => {
  const start = source.indexOf("async function handleFriendAddedEvent");
  const end = source.indexOf("\nfunction commandCallbackLogFields", start);
  const handler = source.slice(start, end);
  assert.equal(handler.includes("getFlowNode(machine, machine.entryNodeId)"), true);
  assert.equal(handler.includes("activation.trigger"), false);
});

test("friend-added activation uses durable re-entry and reports cooldown skips", () => {
  const start = source.indexOf("async function handleFriendAddedEvent");
  const end = source.indexOf("\nfunction commandCallbackLogFields", start);
  const handler = source.slice(start, end);

  assert.equal(handler.includes("beginFriendAddedFlowEntry"), true);
  assert.equal(handler.includes('reason: "friend_added_cooldown"'), true);
  assert.equal(handler.includes('reason: "friend_added_duplicate"'), true);
  assert.equal(handler.includes("existing_entry_session"), false);
});

test("friend-added re-entry cooldown defaults to immediate retriggering", () => {
  assert.match(source, /FRIEND_ADDED_REENTRY_COOLDOWN_MINUTES \|\| 0/);
});

test("friend-added signal dedupe is independent from business reentry cooldown", () => {
  assert.match(source, /FRIEND_ADDED_SIGNAL_DEDUPE_SECONDS \|\| 30/);
  assert.equal(source.includes("isFriendAddedSignalDuplicate"), true);
  assert.match(source, /reason: "friend_added_signal_duplicate"/);
  assert.match(source, /reason: "friend_added_cooldown"/);
});

test("friend-added signal time persists after successful handling without a flow machine", () => {
  const start = source.indexOf("async function handleFriendAddedEvent");
  const end = source.indexOf("\nfunction commandCallbackLogFields", start);
  const handler = source.slice(start, end);
  const resetIndex = handler.indexOf("resetConversationForFriendGreeting");
  const noMachineIndex = handler.indexOf("if (!machine?.enabled)");
  const noMachineMarkIndex = handler.indexOf(
    "markConversationFriendAddedSignal",
    noMachineIndex
  );
  const flowEntryIndex = handler.indexOf("beginFriendAddedFlowEntry");
  const flowEntryMarkIndex = handler.indexOf(
    "markConversationFriendAddedSignal",
    flowEntryIndex
  );

  assert.equal(handler.includes("existingConversation?.lastFriendAddedSignalAt"), true);
  assert.equal(resetIndex < noMachineMarkIndex, true);
  assert.equal(noMachineIndex < noMachineMarkIndex, true);
  assert.equal(flowEntryIndex < flowEntryMarkIndex, true);
});

test("friend-added signal dedupe configuration is documented separately", () => {
  assert.match(envExample, /^FRIEND_ADDED_SIGNAL_DEDUPE_SECONDS=30$/m);
  assert.match(readme, /FRIEND_ADDED_SIGNAL_DEDUPE_SECONDS/);
  assert.match(readme, /30 秒/);
});

test("friend-added re-entry happens even when the entry node has no activation script", () => {
  const start = source.indexOf("async function handleFriendAddedEvent");
  const end = source.indexOf("\nfunction commandCallbackLogFields", start);
  const handler = source.slice(start, end);

  assert.equal(
    handler.indexOf("beginFriendAddedFlowEntry") < handler.indexOf('reason: "entry_activation_not_configured"'),
    true
  );
});

test("friend-added activation uses the task atomically created by durable re-entry", () => {
  const start = source.indexOf("async function handleFriendAddedEvent");
  const end = source.indexOf("\nfunction commandCallbackLogFields", start);
  const handler = source.slice(start, end);

  assert.equal(handler.includes("entryResult.session"), true);
  assert.equal(handler.includes("const task = entryResult.task"), true);
  assert.equal(handler.includes("messageIndex: 0"), false);
});

test("friend-added callback delegates existing session handling to the durable re-entry helper", () => {
  const start = source.indexOf("async function handleFriendAddedEvent");
  const end = source.indexOf("\nfunction commandCallbackLogFields", start);
  const handler = source.slice(start, end);
  assert.equal(handler.includes("existing_session_not_at_entry"), false);
  assert.equal(handler.includes("getFlowSession(conversationKey)"), false);
});

test("friend-added callback resets an existing conversation instead of skipping it", () => {
  const start = source.indexOf("async function handleFriendAddedEvent");
  const end = source.indexOf("\nfunction commandCallbackLogFields", start);
  const handler = source.slice(start, end);

  assert.equal(handler.includes("resetConversationForFriendGreeting"), true);
  assert.equal(handler.includes("friend_added.conversation_reset"), true);
  assert.equal(handler.includes("system_friend_greeting_existing_conversation"), false);
  assert.equal(handler.includes("forceReentry: Boolean(existingConversation)"), true);
});

test("friend-added callback queues old Agent memory cleanup without blocking local re-entry", () => {
  const start = source.indexOf("async function handleFriendAddedEvent");
  const end = source.indexOf("\nfunction commandCallbackLogFields", start);
  const handler = source.slice(start, end);
  const syncIndex = handler.indexOf("syncConversationResetToAgent");
  const resetIndex = handler.indexOf("resetConversationForFriendGreeting");
  const entryIndex = handler.indexOf("beginFriendAddedFlowEntry");

  assert.ok(syncIndex >= 0);
  assert.ok(resetIndex >= 0);
  assert.ok(entryIndex >= 0);
  assert.ok(syncIndex < resetIndex);
  assert.ok(resetIndex < entryIndex);
  assert.equal(handler.includes("await syncConversationResetToAgent"), false);
  assert.match(
    handler,
    /syncConversationResetToAgent\(\{[\s\S]*conversationEpoch:\s*existingConversation\.conversationEpoch/
  );
});

test("friend-added re-entry cancels any buffered messages from the old conversation epoch", () => {
  const start = source.indexOf("async function handleFriendAddedEvent");
  const end = source.indexOf("\nfunction commandCallbackLogFields", start);
  const handler = source.slice(start, end);
  const cancelIndex = handler.indexOf("cancelInboundBatch");
  const resetIndex = handler.indexOf("resetConversationForFriendGreeting");

  assert.ok(cancelIndex >= 0);
  assert.ok(resetIndex >= 0);
  assert.ok(cancelIndex < resetIndex);
  assert.match(handler, /"friend_added_reentry"/);
});

test("friend-added cooldown is checked before resetting an existing conversation", () => {
  const start = source.indexOf("async function handleFriendAddedEvent");
  const end = source.indexOf("\nfunction commandCallbackLogFields", start);
  const handler = source.slice(start, end);
  const cooldownIndex = handler.indexOf("existingFriendAddedInCooldown");
  const resetIndex = handler.indexOf("resetConversationForFriendGreeting");

  assert.ok(cooldownIndex >= 0);
  assert.ok(resetIndex >= 0);
  assert.ok(cooldownIndex < resetIndex);
  assert.match(source, /function existingFriendAddedInCooldown[\s\S]*getFlowSessionForBot\(\{ botId, conversationKey \}\)/);
});
