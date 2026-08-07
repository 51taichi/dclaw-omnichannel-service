import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnichannel-bot-isolation-test-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");

function createMachine(botId, nodeId) {
  let binding = db.getBotBinding(botId);
  if (!binding) {
    const agentId = `${botId}_test_agent`;
    db.upsertAgent({
      agentId,
      agentName: `${botId} 测试 Agent`,
      dclawBaseUrl: "https://dclaw.example.com",
      dclawPublicId: agentId,
      enabled: true
    });
    binding = db.upsertBotBinding({ botId, botName: botId, agentId, enabled: true });
  }
  return db.upsertFlowMachine({
    agentId: binding.agentId,
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
  const sharedMessageId = "omnichannel-message-shared";
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

test("agent edits preserve an existing API key unless a new key is supplied", () => {
  db.upsertAgent({
    agentId: "agent_preserve_key",
    agentName: "Original",
    dclawBaseUrl: "https://api.example.com",
    dclawPublicId: "public_original",
    agentApiKey: "secret-original",
    enabled: true
  });

  for (const agentApiKey of [undefined, "", "*****"]) {
    db.upsertAgent({
      agentId: "agent_preserve_key",
      agentName: "Edited",
      dclawBaseUrl: "https://api-new.example.com",
      dclawPublicId: "public_new",
      agentApiKey,
      enabled: true
    });
    assert.equal(db.getAgent("agent_preserve_key").agentApiKey, "secret-original");
  }

  db.upsertAgent({
    agentId: "agent_preserve_key",
    agentName: "Edited",
    dclawBaseUrl: "https://api-new.example.com",
    dclawPublicId: "public_new",
    agentApiKey: "secret-replacement",
    enabled: true
  });
  assert.equal(db.getAgent("agent_preserve_key").agentApiKey, "secret-replacement");
});

test("bots bound to one agent resolve the same agent-owned flow machine", () => {
  const agentId = "agent_shared_flow";
  db.upsertAgent({
    agentId,
    agentName: "共享状态机 Agent",
    dclawBaseUrl: "https://dclaw.example.com",
    dclawPublicId: "shared_flow",
    enabled: true
  });
  db.upsertBotBinding({ botId: "bot_shared_flow_a", botName: "共享 A", agentId, enabled: true });
  db.upsertBotBinding({ botId: "bot_shared_flow_b", botName: "共享 B", agentId, enabled: true });

  db.upsertFlowMachine({
    agentId,
    enabled: true,
    config: {
      name: "共享招商状态机",
      version: "1.0.0",
      entryNodeId: "shared_node_1",
      nodes: [{
        id: "shared_node_1",
        name: "起始节点",
        goal: "开始咨询",
        completionCriteria: "已开始",
        collectFields: ["手机号"],
        conversationTips: [],
        nextNodeId: ""
      }]
    }
  });

  const machineA = db.getFlowMachineForBot("bot_shared_flow_a");
  const machineB = db.getFlowMachineForBot("bot_shared_flow_b");

  assert.equal(machineA.agentId, agentId);
  assert.equal(machineB.agentId, agentId);
  assert.equal(machineB.config.entryNodeId, "shared_node_1");
});

test("legacy Bot-owned flow machines migrate to the bound Agent", () => {
  const botId = "bot_legacy_flow";
  const conflictBotId = "bot_legacy_flow_conflict";
  const agentId = "agent_legacy_flow";
  db.upsertAgent({
    agentId,
    agentName: "旧状态机迁移 Agent",
    dclawBaseUrl: "https://dclaw.example.com",
    dclawPublicId: "legacy_flow",
    enabled: true
  });
  db.upsertBotBinding({ botId, botName: "旧 Bot", agentId, enabled: true });
  db.upsertBotBinding({ botId: conflictBotId, botName: "冲突旧 Bot", agentId, enabled: true });

  const rawDb = new DatabaseSync(path.join(dataDir, "dclaw-omnichannel-service.sqlite"));
  const timestamp = new Date().toISOString();
  rawDb.prepare(`
    INSERT INTO flow_machines (
      bot_id, name, version, entry_node_id, config_json, enabled, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    botId,
    "旧版状态机",
    "1.0.0",
    "legacy_node_1",
    JSON.stringify({
      name: "旧版状态机",
      version: "1.0.0",
      entryNodeId: "legacy_node_1",
      nodes: [{
        id: "legacy_node_1",
        name: "旧节点",
        goal: "迁移测试",
        completionCriteria: "已迁移",
        collectFields: [],
        conversationTips: [],
        nextNodeId: ""
      }]
    }),
    1,
    timestamp,
    timestamp
  );
  rawDb.prepare(`
    INSERT INTO flow_machines (
      bot_id, name, version, entry_node_id, config_json, enabled, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    conflictBotId,
    "冲突旧版状态机",
    "1.0.0",
    "conflict_node_1",
    JSON.stringify({
      name: "冲突旧版状态机",
      version: "1.0.0",
      entryNodeId: "conflict_node_1",
      nodes: [{
        id: "conflict_node_1",
        name: "冲突旧节点",
        goal: "冲突迁移测试",
        completionCriteria: "已迁移",
        collectFields: [],
        conversationTips: [],
        nextNodeId: ""
      }]
    }),
    1,
    timestamp,
    timestamp
  );
  rawDb.close();

  db.migrateLegacyFlowMachinesToAgents();

  const machine = db.getFlowMachineForBot(botId);
  assert.equal(machine.agentId, agentId);
  assert.equal(machine.config.entryNodeId, "legacy_node_1");
  const conflictDb = new DatabaseSync(path.join(dataDir, "dclaw-omnichannel-service.sqlite"));
  const conflict = conflictDb.prepare(`
    SELECT agent_id, legacy_bot_id, selected_legacy_bot_id
    FROM agent_flow_machine_migration_conflicts
    WHERE agent_id = ?
  `).get(agentId);
  conflictDb.close();
  assert.equal(conflict.agent_id, agentId);
  assert.equal(conflict.legacy_bot_id, conflictBotId);
  assert.equal(conflict.selected_legacy_bot_id, botId);
});

test("unbound Bots cannot create a flow machine through the database API", () => {
  assert.throws(
    () => db.upsertFlowMachine({
      botId: "bot_without_agent_binding",
      config: {
        name: "非法状态机",
        version: "1.0.0",
        entryNodeId: "node_1",
        nodes: []
      }
    }),
    /agent binding is required/
  );
});

test("rebinding one Bot keeps its conversation visible but resets derived flow state", () => {
  const botA = "bot_rebind_a";
  const botB = "bot_rebind_b";
  const agentA = "agent_rebind_a";
  const agentB = "agent_rebind_b";
  const oldAgent = "agent_rebind_old";
  const conversationA = `${botA}:private:客户甲`;
  const conversationB = `${botB}:private:客户乙`;

  for (const [agentId, agentName] of [[oldAgent, "旧 Agent"], [agentA, "新 Agent A"], [agentB, "保留 Agent B"]]) {
    db.upsertAgent({
      agentId,
      agentName,
      dclawBaseUrl: "https://dclaw.example.com",
      dclawPublicId: agentId,
      enabled: true
    });
  }
  db.upsertBotBinding({ botId: botA, botName: "换绑 Bot A", agentId: oldAgent, enabled: true });
  db.upsertBotBinding({ botId: botB, botName: "保留 Bot B", agentId: agentB, enabled: true });

  const machineA = createMachine(botA, "node_a");
  const machineB = createMachine(botB, "node_b");
  const newMachine = db.upsertFlowMachine({
    agentId: agentA,
    enabled: true,
    config: {
      name: "新 Agent 状态机",
      version: "1.0.0",
      entryNodeId: "new_node_1",
      nodes: [{
        id: "new_node_1",
        name: "新起始节点",
        goal: "重新开始",
        completionCriteria: "完成",
        collectFields: [],
        conversationTips: [],
        nextNodeId: ""
      }]
    }
  });
  for (const [botId, conversationKey, name, machine] of [
    [botA, conversationA, "客户甲", machineA],
    [botB, conversationB, "客户乙", machineB]
  ]) {
    db.upsertConversation({
      botId,
      agentId: botId === botA ? oldAgent : agentB,
      conversationKey,
      message: { roomType: 2, receivedName: name, groupName: name }
    });
    db.getOrCreateFlowSession({ botId, conversationKey, machine });
    db.updateFlowSessionNode({
      botId,
      conversationKey,
      nextNodeId: `${machine.entryNodeId}_next`,
      reason: "测试进度"
    });
    if (botId === botA) {
      db.mergeFlowSessionData({ conversationKey, patch: { "手机号": "13800000000" } });
      db.updateFlowSessionHandoff({
        botId,
        conversationKey,
        handoffStatus: "human",
        reason: "测试人工接手"
      });
    }
    db.insertConversationMessage({
      botId,
      conversationKey,
      direction: "inbound",
      senderName: name,
      content: "保留的聊天记录",
      rawPayload: {}
    });
    db.scheduleFlowActivationTask({
      botId,
      agentId: botId === botA ? oldAgent : agentB,
      conversationKey,
      nodeId: machine.entryNodeId,
      activation: { enabled: true, messages: ["激活话术"] }
    });
  }

  db.upsertBotBinding({ botId: botA, botName: "换绑 Bot A", agentId: agentA, enabled: true });

  const result = db.resetBotFlowStateForAgentRebind({
    botId: botA,
    oldAgentId: oldAgent,
    newAgentId: agentA
  });

  assert.deepEqual(result, {
    canceledActivationTasks: 1,
    resetFlowSessions: 1,
    deletedFlowStateEvents: 1
  });
  const resetSession = db.getFlowSessionForBot({ botId: botA, conversationKey: conversationA });
  assert.equal(resetSession.currentNodeId, newMachine.entryNodeId);
  assert.deepEqual(resetSession.collectedData, {});
  assert.equal(resetSession.handoffStatus, "ai");
  assert.equal(db.listConversationMessages({ botId: botA, conversationKey: conversationA }).length, 1);
  assert.equal(db.listFlowActivationTasks({ conversationKey: conversationA })[0].status, "canceled");
  assert.equal(db.listFlowActivationTasks({ conversationKey: conversationA })[0].cancelReason, "agent_rebound");

  assert.ok(db.getFlowSessionForBot({ botId: botB, conversationKey: conversationB }));
  assert.equal(db.listConversationMessages({ botId: botB, conversationKey: conversationB }).length, 1);
  assert.equal(db.listFlowActivationTasks({ conversationKey: conversationB })[0].status, "pending");
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
  db.upsertFlowMachine({
    agentId: "agent_unbound_delete",
    enabled: true,
    config: {
      name: "待删除状态机",
      version: "1.0.0",
      entryNodeId: "node_1",
      nodes: [{
        id: "node_1",
        name: "起始节点",
        goal: "测试",
        completionCriteria: "完成",
        collectFields: [],
        conversationTips: [],
        nextNodeId: ""
      }]
    }
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
  assert.equal(db.getFlowMachine("agent_unbound_delete"), null);
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
  const resetConversationKey = `${botId}:private:待重置客户`;

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
  db.upsertConversation({
    botId,
    agentId: "agent_delete",
    conversationKey: resetConversationKey,
    message: {
      roomType: 2,
      receivedName: "待重置客户",
      groupName: "待重置客户"
    }
  });
  db.clearConversationForReset({
    botId,
    conversationKey: resetConversationKey
  });
  assert.equal(db.listConversationResetTasks({ botId }).length, 1);
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
    channelResponse: {}
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
  assert.equal(db.listConversationResetTasks({ botId }).length, 0);
  assert.ok(db.getBotBinding(otherBotId));
  assert.ok(db.listFlowSessions({ botId: otherBotId }).length > 0);
});
