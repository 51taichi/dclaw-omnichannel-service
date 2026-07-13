import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-group-session-test-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");

test("lightweight group sessions make mentioned group chats visible in conversations", () => {
  const botId = "bot_group_session";
  const conversationKey = `${botId}:group:A招商服务群`;

  db.upsertConversation({
    botId,
    agentId: "agent_group",
    conversationKey,
    message: {
      roomType: 1,
      receivedName: "魔兮",
      groupName: "A招商服务群"
    }
  });

  const session = db.getOrCreateConversationSession({ botId, conversationKey });
  db.insertConversationMessage({
    botId,
    conversationKey,
    direction: "inbound",
    senderName: "魔兮",
    content: "@客服小左 在吗",
    rawPayload: {
      roomType: 1,
      receivedName: "魔兮",
      groupName: "A招商服务群",
      spoken: "在吗"
    }
  });

  const sessions = db.listFlowSessions({ botId });
  const messages = db.listConversationMessages({ conversationKey });

  assert.equal(session.currentNodeId, "__conversation__");
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].conversationKey, conversationKey);
  assert.equal(sessions[0].groupName, "A招商服务群");
  assert.equal(sessions[0].roomType, 1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].senderName, "魔兮");
});
