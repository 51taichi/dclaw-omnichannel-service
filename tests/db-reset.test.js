import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-reset-test-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");

function ensureBotAgent(botId, agentId) {
  db.upsertAgent({
    agentId,
    agentName: `${agentId} 测试 Agent`,
    dclawBaseUrl: "https://dclaw.example.com",
    dclawPublicId: agentId,
    enabled: true
  });
  db.upsertBotBinding({ botId, botName: botId, agentId, enabled: true });
}

test("clearConversationForReset deletes one flow conversation for a fresh agent run", () => {
  const botId = "bot_test";
  const agentId = "agent_test";
  const conversationKey = `${botId}:private:张三`;
  ensureBotAgent(botId, agentId);
  const machine = db.upsertFlowMachine({
    agentId,
    enabled: true,
    config: {
      name: "测试状态机",
      version: "1.0.0",
      entryNodeId: "node_1",
      nodes: [
        {
          id: "node_1",
          name: "发资料",
          goal: "发送资料",
          completionCriteria: "资料已发送",
          collectFields: [],
          conversationTips: [],
          nextNodeId: "node_2"
        },
        {
          id: "node_2",
          name: "邀约",
          goal: "邀约",
          completionCriteria: "客户同意",
          collectFields: ["phone"],
          conversationTips: [],
          nextNodeId: ""
        }
      ]
    }
  });

  db.upsertConversation({
    botId,
    agentId,
    conversationKey,
    message: {
      roomType: 2,
      receivedName: "张三",
      groupName: "张三"
    }
  });
  db.updateConversationSession(conversationKey, "dclaw-session-old");
  db.getOrCreateFlowSession({ botId, conversationKey, machine });
  db.mergeFlowSessionData({ conversationKey, patch: { phone: "13800000000" } });
  db.updateFlowSessionNode({
    botId,
    conversationKey,
    nextNodeId: "node_2",
    reason: "测试推进"
  });
  db.insertConversationMessage({
    botId,
    conversationKey,
    direction: "inbound",
    senderName: "张三",
    content: "我要资料",
    rawPayload: { spoken: "我要资料" }
  });

  const result = db.clearConversationForReset({
    botId,
    conversationKey,
    reason: "测试清空"
  });

  assert.equal(result.conversationKey, conversationKey);
  assert.equal(result.deleted, true);
  assert.equal(db.getFlowSessionForBot({ botId, conversationKey }), null);
  assert.equal(db.listConversationMessages({ conversationKey }).length, 0);
  assert.equal(db.listFlowStateEvents({ conversationKey }).length, 0);
  assert.equal(db.getConversation(conversationKey), null);
  assert.equal(db.getConversationResetPending(conversationKey), false);
});

test("clearConversationForReset removes the conversation from visible session lists and clears tags", () => {
  const botId = "bot_clear_visible";
  const agentId = "agent_clear_visible";
  const conversationKey = `${botId}:private:赵六`;
  ensureBotAgent(botId, agentId);
  const machine = db.upsertFlowMachine({
    agentId,
    enabled: true,
    config: {
      name: "清空可见列表状态机",
      version: "1.0.0",
      entryNodeId: "node_1",
      nodes: [{ id: "node_1", name: "入口", goal: "", completionCriteria: "", collectFields: [], conversationTips: [], nextNodeId: "" }]
    }
  });
  db.upsertAgentTagSchema({ agentId, schema: { dateTag: { enabled: true }, groups: [] } });
  db.upsertConversation({
    botId,
    agentId,
    conversationKey,
    message: { roomType: 2, receivedName: "赵六", groupName: "赵六" }
  });
  db.getOrCreateFlowSession({ botId, conversationKey, machine });
  db.upsertSystemDateTag({ botId, agentId, conversationKey, dateTagId: "20260718" });

  assert.equal(db.listFlowSessionsPage({ botId }).items.length, 1);
  assert.equal(db.listConversationTags({ botId, agentId, conversationKey }).length, 1);

  const result = db.clearConversationForReset({ botId, conversationKey });

  assert.equal(result.conversationKey, conversationKey);
  assert.equal(result.deleted, true);
  assert.equal(db.getConversation(conversationKey), null);
  assert.equal(db.getFlowSessionForBot({ botId, conversationKey }), null);
  assert.equal(db.listFlowSessionsPage({ botId }).items.length, 0);
  assert.deepEqual(db.listConversationTags({ botId, agentId, conversationKey }), []);
});

test("getConversationAssets only exposes configured collect fields", () => {
  const botId = "bot_assets";
  const agentId = "agent_assets";
  const conversationKey = `${botId}:private:李四`;
  ensureBotAgent(botId, agentId);
  const machine = db.upsertFlowMachine({
    agentId,
    enabled: true,
    config: {
      name: "资产状态机",
      version: "1.0.0",
      entryNodeId: "node_1",
      nodes: [
        {
          id: "node_1",
          name: "基础信息",
          goal: "收集基础信息",
          completionCriteria: "完成基础信息",
          collectFields: ["手机号", "所在城市"],
          conversationTips: [],
          nextNodeId: "node_2"
        },
        {
          id: "node_2",
          name: "预算",
          goal: "收集预算",
          completionCriteria: "完成预算",
          collectFields: ["预算", "手机号"],
          conversationTips: [],
          nextNodeId: ""
        }
      ]
    }
  });

  db.upsertConversation({
    botId,
    agentId,
    conversationKey,
    message: {
      roomType: 2,
      receivedName: "李四",
      groupName: "李四"
    }
  });
  db.getOrCreateFlowSession({ botId, conversationKey, machine });
  db.mergeFlowSessionData({
    conversationKey,
    patch: {
      "手机号": "13800001111",
      "预算": "",
      interest: "了解品牌",
      summary: "这是临时摘要"
    }
  });

  const assets = db.getConversationAssets({ botId, conversationKey });

  assert.deepEqual(assets.fields, [
    { key: "手机号", label: "手机号", value: "13800001111", collected: true },
    { key: "所在城市", label: "所在城市", value: "", collected: false },
    { key: "预算", label: "预算", value: "", collected: false }
  ]);
  assert.equal(assets.totalCount, 3);
  assert.equal(assets.collectedCount, 1);
});

test("clearConversationForReset deletes a normal conversation without a flow machine", () => {
  const botId = "bot_without_flow";
  const conversationKey = `${botId}:private:王五`;

  db.upsertConversation({
    botId,
    agentId: "agent_without_flow",
    conversationKey,
    message: {
      roomType: 2,
      receivedName: "王五",
      groupName: "王五"
    }
  });
  db.updateConversationSession(conversationKey, "dclaw-session-old");
  db.insertConversationMessage({
    botId,
    conversationKey,
    direction: "inbound",
    senderName: "王五",
    content: "你好",
    rawPayload: { spoken: "你好" }
  });

  const result = db.clearConversationForReset({ botId, conversationKey });

  assert.equal(result.conversationKey, conversationKey);
  assert.equal(result.deleted, true);
  assert.equal(db.listConversationMessages({ botId, conversationKey }).length, 0);
  assert.equal(db.getConversation(conversationKey), null);
  assert.equal(db.getConversationResetPending(conversationKey), false);
});
