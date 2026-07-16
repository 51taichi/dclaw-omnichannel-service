import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-activation-test-"));
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

test("normalizeActivationConfig defaults and filters messages", () => {
  assert.deepEqual(db.normalizeActivationConfig({}), {
    enabled: false,
    polishByAgent: true,
    messages: []
  });

  assert.deepEqual(db.normalizeActivationConfig({
    enabled: true,
    intervalMinutes: "15",
    maxTimes: "2",
    polishByAgent: false,
    messages: ["  第一条  ", "", "第二条"]
  }), {
    enabled: true,
    polishByAgent: false,
    messages: [
      { content: "第一条", intervalMinutes: 15, maxTimes: 2 },
      { content: "第二条", intervalMinutes: 15, maxTimes: 2 }
    ]
  });

  assert.deepEqual(db.normalizeActivationConfig({
    intervalMinutes: 30,
    maxTimes: 2,
    messages: ["第一条"]
  }).messages, [{ content: "第一条", intervalMinutes: 30, maxTimes: 2 }]);
});

test("activation normalization ignores legacy trigger values", () => {
  const normalized = db.normalizeActivationConfig({
    enabled: true,
    trigger: "friend_added",
    messages: ["提醒"]
  });
  assert.equal("trigger" in normalized, false);
});

test("activation tasks can be scheduled, claimed, sent, failed, and canceled", () => {
  const botId = "bot_activation";
  const agentId = "agent_activation";
  const conversationKey = `${botId}:private:张三`;
  ensureBotAgent(botId, agentId);
  const machine = db.upsertFlowMachine({
    agentId,
    enabled: true,
    config: {
      name: "激活状态机",
      version: "1.0.0",
      entryNodeId: "node_1",
      nodes: [{ id: "node_1", name: "邀约", goal: "", completionCriteria: "", collectFields: [], conversationTips: [], nextNodeId: "" }]
    }
  });
  const session = db.getOrCreateFlowSession({ botId, conversationKey, machine });
  assert.equal(session.activationGeneration, 0);

  const task = db.scheduleFlowActivationTask({
    botId,
    agentId,
    conversationKey,
    nodeId: "node_1",
    generation: session.activationGeneration,
    anchorAt: "2026-07-11T09:59:00.000Z",
    activation: {
      enabled: true,
      intervalMinutes: 30,
      maxTimes: 2,
      polishByAgent: false,
      messages: ["提醒一", "提醒二"]
    },
    dueAt: "2026-07-11T10:00:00.000Z"
  });
  assert.equal(task.status, "pending");
  assert.equal(task.attemptNumber, 1);
  assert.equal(task.anchorAt, "2026-07-11T09:59:00.000Z");

  const claimed = db.claimDueFlowActivationTasks({
    limit: 20,
    nowIso: "2026-07-11T10:00:01.000Z",
    staleBeforeIso: "2026-07-11T09:50:00.000Z"
  });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].status, "processing");
  assert.equal(claimed[0].messageIndex, 0);
  assert.equal(claimed[0].messageContent, "提醒一");
  assert.deepEqual(claimed[0].messages, [
    { content: "提醒一", intervalMinutes: 30, maxTimes: 2 },
    { content: "提醒二", intervalMinutes: 30, maxTimes: 2 }
  ]);

  const sent = db.markFlowActivationTaskSent({
    id: claimed[0].id,
    worktoolMessageIds: ["wt_1", "wt_2"]
  });
  assert.equal(sent.status, "sent");
  assert.deepEqual(sent.worktoolMessageIds, ["wt_1", "wt_2"]);

  db.scheduleFlowActivationTask({
    botId,
    agentId,
    conversationKey,
    nodeId: "node_1",
    generation: session.activationGeneration,
    activation: { enabled: true, intervalMinutes: 30, maxTimes: 2, polishByAgent: true, messages: ["继续提醒"] },
    dueAt: "2026-07-11T10:30:00.000Z",
    attemptNumber: 2
  });
  const canceled = db.cancelFlowActivationTasks({ conversationKey, reason: "customer_replied" });
  assert.equal(canceled >= 1, true);
  assert.equal(db.listFlowActivationTasks({ conversationKey }).at(-1).status, "canceled");
});

test("canceled processing activation tasks cannot be marked sent or failed", () => {
  const botId = "bot_activation_canceled";
  const agentId = "agent_activation_canceled";
  const conversationKey = `${botId}:private:王五`;
  ensureBotAgent(botId, agentId);
  const machine = db.upsertFlowMachine({
    agentId,
    enabled: true,
    config: {
      name: "取消保护状态机",
      version: "1.0.0",
      entryNodeId: "node_1",
      nodes: [{ id: "node_1", name: "节点", goal: "", completionCriteria: "", collectFields: [], conversationTips: [], nextNodeId: "" }]
    }
  });
  const session = db.getOrCreateFlowSession({ botId, conversationKey, machine });
  const createTask = () => db.scheduleFlowActivationTask({
    botId,
    agentId,
    conversationKey,
    nodeId: "node_1",
    generation: session.activationGeneration,
    activation: { enabled: true, intervalMinutes: 1, maxTimes: 1, polishByAgent: false, messages: ["提醒"] },
    dueAt: "2026-07-11T10:00:00.000Z"
  });

  const sentTask = createTask();
  const failedTask = createTask();
  const claimed = db.claimDueFlowActivationTasks({
    limit: 20,
    nowIso: "2026-07-11T10:00:01.000Z"
  });
  assert.equal(claimed.length, 2);
  assert.equal(db.isFlowActivationTaskProcessing({ id: sentTask.id }), true);
  assert.equal(db.cancelFlowActivationTasks({ conversationKey, reason: "customer_replied" }), 2);

  assert.equal(db.isFlowActivationTaskProcessing({ id: sentTask.id }), false);
  assert.equal(db.markFlowActivationTaskSent({ id: sentTask.id }), null);
  assert.equal(db.markFlowActivationTaskFailed({ id: failedTask.id, error: "late worker" }), null);

  const tasks = db.listFlowActivationTasks({ conversationKey });
  assert.equal(tasks.find((task) => task.id === sentTask.id).status, "canceled");
  assert.equal(tasks.find((task) => task.id === failedTask.id).status, "canceled");
});

test("incrementFlowActivationGeneration invalidates old generations", () => {
  const botId = "bot_generation";
  const agentId = "agent_generation";
  const conversationKey = `${botId}:private:李四`;
  ensureBotAgent(botId, agentId);
  const machine = db.upsertFlowMachine({
    agentId,
    enabled: true,
    config: {
      name: "代际状态机",
      version: "1.0.0",
      entryNodeId: "node_1",
      nodes: [{ id: "node_1", name: "节点", goal: "", completionCriteria: "", collectFields: [], conversationTips: [], nextNodeId: "" }]
    }
  });
  db.getOrCreateFlowSession({ botId, conversationKey, machine });
  const next = db.incrementFlowActivationGeneration({ conversationKey, reason: "customer_replied" });
  assert.equal(next.activationGeneration, 1);
});

test("activation progress advances sequential messages and rejects stale generations", () => {
  const botId = "bot_activation_progress";
  const agentId = "agent_activation_progress";
  const conversationKey = `${botId}:private:赵六`;
  ensureBotAgent(botId, agentId);
  const machine = db.upsertFlowMachine({
    agentId,
    enabled: true,
    config: {
      name: "进度状态机",
      version: "1.0.0",
      entryNodeId: "node_1",
      nodes: [
        { id: "node_1", name: "节点一", goal: "", completionCriteria: "", collectFields: [], conversationTips: [], nextNodeId: "" },
        { id: "node_2", name: "节点二", goal: "", completionCriteria: "", collectFields: [], conversationTips: [], nextNodeId: "" }
      ]
    }
  });
  const session = db.getOrCreateFlowSession({ botId, conversationKey, machine });
  db.upsertConversation({
    botId,
    agentId,
    conversationKey,
    message: { roomType: 2, receivedName: "赵六", groupName: "" }
  });

  assert.deepEqual(db.getFlowActivationProgress({ conversationKey, nodeId: "node_1" }), {
    nodeId: "node_1",
    messageIndex: 0,
    sentCount: 0
  });

  const oneSendMessages = [{ content: "第一条", intervalMinutes: 30, maxTimes: 1 }];
  assert.deepEqual(db.advanceFlowActivationProgress({
    conversationKey,
    nodeId: "node_1",
    generation: session.activationGeneration,
    messageIndex: 0,
    attemptNumber: 1,
    messages: oneSendMessages
  }), {
    nodeId: "node_1",
    messageIndex: 1,
    sentCount: 0
  });

  assert.equal(db.advanceFlowActivationProgress({
    conversationKey,
    nodeId: "node_1",
    generation: session.activationGeneration - 1,
    messageIndex: 1,
    attemptNumber: 1,
    messages: oneSendMessages
  }), null);

  db.updateFlowSessionNode({ botId, conversationKey, nextNodeId: "node_2", reason: "transition" });
  db.updateFlowSessionNode({ botId, conversationKey, nextNodeId: "node_1", reason: "transition back" });
  assert.deepEqual(db.getFlowActivationProgress({ conversationKey, nodeId: "node_1" }), {
    nodeId: "node_1",
    messageIndex: 0,
    sentCount: 0
  });

  const twoSendMessages = [{ content: "第二条", intervalMinutes: 30, maxTimes: 2 }];
  assert.deepEqual(db.advanceFlowActivationProgress({
    conversationKey,
    nodeId: "node_1",
    generation: session.activationGeneration,
    messageIndex: 0,
    attemptNumber: 1,
    messages: twoSendMessages
  }), {
    nodeId: "node_1",
    messageIndex: 0,
    sentCount: 1
  });

  db.clearConversationForReset({ botId, conversationKey });
  assert.deepEqual(db.getFlowActivationProgress({ conversationKey, nodeId: "node_1" }), {
    nodeId: "node_1",
    messageIndex: 0,
    sentCount: 0
  });
});
