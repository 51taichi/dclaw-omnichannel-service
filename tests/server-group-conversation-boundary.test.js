import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const processIncomingSource = serverSource.slice(serverSource.indexOf("async function processIncomingMessage"));

test("server records invoked group chats as lightweight conversation history", () => {
  assert.equal(serverSource.includes("getOrCreateConversationSession"), true);
  assert.equal(serverSource.includes("shouldRecordConversationHistory(message)"), true);
  assert.equal(serverSource.includes("isPrivateMessage(message) || isGroupMessage(message)"), true);
});

test("server records unmentioned group messages before agent mention filtering", () => {
  assert.equal(
    processIncomingSource.indexOf("persistInboundConversation({") <
      processIncomingSource.indexOf("group_mention_required"),
    true
  );
});

test("server keeps non-triggering group messages local without a DClaw history wake", () => {
  assert.match(serverSource, /const insertConversationMessage = insertConversationMessageDb/);
  assert.doesNotMatch(serverSource, /insertConversationMessageAndWakeGroupHistory|groupHistorySyncWorker/);
  assert.equal(
    processIncomingSource.indexOf("persistInboundConversation({") <
      processIncomingSource.indexOf("group_mention_required"),
    true
  );
});

test("server persists a managed group's creation date tag with its canonical conversation", () => {
  assert.match(
    processIncomingSource,
    /persistInboundConversation\(\{[\s\S]*managedGroup: group/
  );
  assert.match(
    serverSource,
    /function persistInboundConversation\(\{[\s\S]*managedGroup[\s\S]*ensureManagedGroupConversationDateTag\(\{[\s\S]*groupCreatedAt: managedGroup\.groupCreatedAt/
  );
  assert.match(
    serverSource,
    /backfillManagedGroupConversationDateTags\(\)[\s\S]*app\.listen\(port, host/
  );
});

test("proactive group targets keep lightweight conversation sessions", () => {
  const workerSource = serverSource.slice(
    serverSource.indexOf("async function processNextProactiveTarget"),
    serverSource.indexOf("if (proactiveWorkerConfig.enabled)")
  );

  assert.match(
    workerSource,
    /target\.targetType === "group"[\s\S]*getOrCreateConversationSession\(\{\s*botId: target\.botId,\s*conversationKey\s*\}\)/
  );
});
