import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
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

test("private conversation sessions enter the configured flow without overwriting normal nodes", () => {
  const botId = "bot_private_session_upgrade";
  const conversationKey = `${botId}:private:魔兮`;
  const machine = { entryNodeId: "node_1" };

  db.upsertConversation({
    botId,
    agentId: "agent_private",
    conversationKey,
    message: {
      roomType: 2,
      receivedName: "魔兮",
      groupName: "魔兮"
    }
  });

  const conversationSession = db.getOrCreateConversationSession({ botId, conversationKey });
  db.mergeFlowSessionData({
    conversationKey,
    patch: { customerName: "魔兮" }
  });
  db.updateFlowSessionHandoff({
    botId,
    conversationKey,
    handoffStatus: "human",
    handoffBy: "admin",
    reason: "manual review"
  });
  db.insertConversationMessage({
    botId,
    conversationKey,
    direction: "inbound",
    senderName: "魔兮",
    content: "历史消息",
    rawPayload: {}
  });
  const rawDb = new DatabaseSync(path.join(dataDir, "worktool-bot-service.sqlite"));
  rawDb.prepare(`
    UPDATE flow_sessions
    SET activation_state_json = ?
    WHERE conversation_key = ?
  `).run(JSON.stringify({ nodeId: "__conversation__", sentCount: 1 }), conversationKey);
  rawDb.close();

  const upgradedSession = db.getOrCreateFlowSession({ botId, conversationKey, machine });

  assert.equal(conversationSession.currentNodeId, "__conversation__");
  assert.equal(upgradedSession.currentNodeId, "node_1");
  assert.equal(upgradedSession.createdAt, conversationSession.createdAt);
  assert.deepEqual(upgradedSession.collectedData, { customerName: "魔兮" });
  assert.equal(upgradedSession.handoffStatus, "human");
  assert.equal(upgradedSession.handoffBy, "admin");
  assert.equal(upgradedSession.handoffReason, "manual review");
  assert.deepEqual(upgradedSession.activationState, {
    nodeId: "__conversation__",
    sentCount: 1
  });
  assert.equal(db.listConversationMessages({ botId, conversationKey }).length, 1);

  db.updateFlowSessionNode({
    botId,
    conversationKey,
    nextNodeId: "node_2",
    reason: "test transition"
  });

  const existingFlowSession = db.getOrCreateFlowSession({ botId, conversationKey, machine });
  assert.equal(existingFlowSession.currentNodeId, "node_2");
});
