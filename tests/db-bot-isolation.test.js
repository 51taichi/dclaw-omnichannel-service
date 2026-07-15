import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-bot-isolation-test-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");

function createMachine(botId, nodeId) {
  return db.upsertFlowMachine({
    botId,
    enabled: true,
    config: {
      name: `${botId} 状态机`,
      version: "1.0.0",
      entryNodeId: nodeId,
      nodes: [{
        id: nodeId,
        name: "起始节点",
        goal: "测试隔离",
        completionCriteria: "完成",
        collectFields: [],
        conversationTips: [],
        nextNodeId: ""
      }]
    }
  });
}

function createSession(botId, name, nodeId) {
  const conversationKey = `${botId}:private:${name}`;
  const machine = createMachine(botId, nodeId);
  db.upsertConversation({
    botId,
    agentId: `${botId}_agent`,
    conversationKey,
    message: { roomType: 2, receivedName: name, groupName: name }
  });
  db.getOrCreateFlowSession({ botId, conversationKey, machine });
  db.insertConversationMessage({
    botId,
    conversationKey,
    direction: "inbound",
    senderName: name,
    content: "测试消息",
    rawPayload: {}
  });
  return conversationKey;
}

test("Bot A cannot read or mutate Bot B conversation by supplying Bot B conversation key", () => {
  const botA = "bot_isolation_a";
  const botB = "bot_isolation_b";
  const conversationKeyB = createSession(botB, "客户乙", "node_b");
  createMachine(botA, "node_a");

  assert.equal(
    db.getFlowSessionForBot({ botId: botA, conversationKey: conversationKeyB }),
    null
  );
  assert.deepEqual(
    db.listConversationMessages({ botId: botA, conversationKey: conversationKeyB }),
    []
  );
  assert.deepEqual(
    db.listFlowStateEvents({ botId: botA, conversationKey: conversationKeyB }),
    []
  );

  assert.throws(
    () => db.updateFlowSessionNode({
      botId: botA,
      conversationKey: conversationKeyB,
      nextNodeId: "node_a",
      reason: "cross bot mutation"
    }),
    /flow session not found/
  );
  assert.throws(
    () => db.clearConversationForReset({
      botId: botA,
      conversationKey: conversationKeyB
    }),
    /flow session not found/
  );

  const botBSession = db.getFlowSessionForBot({ botId: botB, conversationKey: conversationKeyB });
  assert.equal(botBSession.currentNodeId, "node_b");
  assert.equal(db.listConversationMessages({ botId: botB, conversationKey: conversationKeyB }).length, 1);
});

test("command callbacks only update delivery rows owned by the callback Bot", () => {
  const sharedMessageId = "worktool-message-shared";
  db.insertOutgoingMessage({
    botId: "bot_callback_a",
    agentId: "agent_a",
    conversationKey: "bot_callback_a:private:甲",
    messageId: sharedMessageId,
    targetName: "甲",
    content: "A"
  });
  db.insertOutgoingMessage({
    botId: "bot_callback_b",
    agentId: "agent_b",
    conversationKey: "bot_callback_b:private:乙",
    messageId: sharedMessageId,
    targetName: "乙",
    content: "B"
  });

  db.updateOutgoingMessageFromCommandCallback({
    botId: "bot_callback_a",
    messageId: sharedMessageId,
    payload: { errorCode: 0 }
  });

  const botARow = db.listRecords("outgoing-messages", { botId: "bot_callback_a" }).find(
    (row) => row.message_id === sharedMessageId
  );
  const botBRow = db.listRecords("outgoing-messages", { botId: "bot_callback_b" }).find(
    (row) => row.message_id === sharedMessageId
  );
  assert.equal(botARow.callback_error_code, 0);
  assert.equal(botBRow.callback_error_code, null);
});

test("multiple bots can reuse an independently saved agent config", () => {
  db.upsertAgent({
    agentId: "agent_shared",
    agentName: "共享 Agent",
    dclawBaseUrl: "https://dclaw.example.com",
    dclawPublicId: "shared_public",
    agentApiKey: "secret-v1",
    enabled: true
  });
  db.upsertBotBinding({
    botId: "bot_shared_a",
    botName: "测试 Bot A",
    agentId: "agent_shared",
    enabled: true
  });
  db.upsertBotBinding({
    botId: "bot_shared_b",
    botName: "测试 Bot B",
    agentId: "agent_shared",
    enabled: true
  });

  db.upsertAgent({
    agentId: "agent_shared",
    agentName: "共享 Agent 更新",
    dclawBaseUrl: "https://dclaw-new.example.com/",
    dclawPublicId: "shared_public_v2",
    agentApiKey: "secret-v2",
    enabled: true
  });

  const agent = db.getAgent("agent_shared");
  const botA = db.getBotBinding("bot_shared_a");
  const botB = db.getBotBinding("bot_shared_b");

  assert.equal(db.listAgents().some((item) => item.agentId === "agent_shared"), true);
  assert.equal(agent.agentName, "共享 Agent 更新");
  assert.equal(botA.agentName, "共享 Agent 更新");
  assert.equal(botB.agentName, "共享 Agent 更新");
  assert.equal(botA.dclawBaseUrl, "https://dclaw-new.example.com");
  assert.equal(botB.dclawPublicId, "shared_public_v2");
  assert.equal(botA.agentApiKey, "secret-v2");
});

test("deleteAgent removes only unbound agents", () => {
  db.upsertAgent({
    agentId: "agent_unbound_delete",
    agentName: "可删除 Agent",
    dclawBaseUrl: "https://dclaw.example.com",
    dclawPublicId: "delete_public",
    agentApiKey: "secret",
    enabled: true
  });
  db.upsertAgent({
    agentId: "agent_bound_delete",
    agentName: "已绑定 Agent",
    dclawBaseUrl: "https://dclaw.example.com",
    dclawPublicId: "bound_public",
    agentApiKey: "secret",
    enabled: true
  });
  db.upsertBotBinding({
    botId: "bot_bound_agent_delete",
    botName: "绑定删除测试 Bot",
    agentId: "agent_bound_delete",
    enabled: true
  });

  const deleted = db.deleteAgent("agent_unbound_delete");

  assert.equal(deleted.agentId, "agent_unbound_delete");
  assert.equal(db.getAgent("agent_unbound_delete"), null);
  assert.throws(
    () => db.deleteAgent("agent_bound_delete"),
    /agent is bound by 1 bot/
  );
  assert.ok(db.getAgent("agent_bound_delete"));
});

test("deleteBotData removes the bot binding and bot scoped records", () => {
  const botId = "bot_delete_me";
  const otherBotId = "bot_keep_me";
  const conversationKey = `${botId}:private:待删除客户`;

  db.upsertBotBinding({
    botId,
    botName: "待删除 Bot",
    agentId: "agent_delete",
    agentName: "待删除 Agent",
    dclawBaseUrl: "https://dclaw.example.com",
    dclawPublicId: "delete_public",
    agentApiKey: "secret",
    enabled: true
  });
  db.upsertBotBinding({
    botId: otherBotId,
    botName: "保留 Bot",
    agentId: "agent_keep",
    agentName: "保留 Agent",
    dclawBaseUrl: "https://dclaw.example.com",
    dclawPublicId: "keep_public",
    agentApiKey: "secret",
    enabled: true
  });
  createSession(botId, "待删除客户", "node_delete");
  createSession(otherBotId, "保留客户", "node_keep");
  db.createProactiveTask({
    botId,
    agentId: "agent_delete",
    title: "删除任务",
    content: "删除内容",
    targets: [{ targetType: "private", targetName: "待删除客户" }],
    createdBy: "test"
  });
  db.upsertProactiveAddressBookTarget({
    botId,
    targetType: "private",
    targetName: "待删除客户",
    displayName: "待删除客户",
    source: "test"
  });
  db.insertIncomingMessage({
    botId,
    conversationKey,
    payload: { messageId: "delete-msg", spoken: "hello", receivedName: "待删除客户" }
  });
  db.insertOutgoingMessage({
    botId,
    agentId: "agent_delete",
    conversationKey,
    targetName: "待删除客户",
    content: "reply",
    messageId: "delete-out",
    worktoolResponse: {}
  });
  db.insertCommandCallback({
    botId,
    payload: { messageId: "delete-out", errorCode: 0, errorReason: "" }
  });
  db.insertAgentInvocationStart({
    botId,
    agentId: "agent_delete",
    conversationKey,
    incomingMessageId: "delete-msg",
    request: {}
  });

  const deleted = db.deleteBotData(botId);

  assert.equal(deleted.botId, botId);
  assert.equal(db.getBotBinding(botId), null);
  assert.equal(db.getFlowSessionForBot({ botId, conversationKey }), null);
  assert.deepEqual(db.listConversationMessages({ botId, conversationKey }), []);
  assert.equal(db.listProactiveTasks({ botId }).length, 0);
  assert.equal(db.listProactiveAddressBookTargets({ botId }).length, 0);
  assert.ok(db.getBotBinding(otherBotId));
  assert.ok(db.listFlowSessions({ botId: otherBotId }).length > 0);
});
