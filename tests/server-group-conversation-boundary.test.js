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

test("server still skips unmentioned group messages before conversation history is recorded", () => {
  assert.equal(
    processIncomingSource.indexOf("group_message_without_mention") <
      processIncomingSource.indexOf("shouldRecordConversationHistory(message)"),
    true
  );
});
