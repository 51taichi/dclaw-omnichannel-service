import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-group-automation-direct-worker-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");
const { createGroupAutomationWorker } = await import(
  "../src/group-automation-worker.js"
);

const targetAt = "2026-08-06T01:00:00.000Z";

function createContext({
  botId,
  taskType = "conditional_push",
  mention = true,
  withConversation = true
}) {
  const group = db.createOrGetGroup({
    botId,
    currentName: `${botId}服务群`,
    source: "callback",
    discoveredAt: "2026-08-01T00:00:00.000Z"
  });
  if (withConversation) {
    db.upsertConversation({
      botId,
      agentId: `${botId}-agent`,
      conversationKey: group.conversationKey,
      message: { roomType: 1, groupName: group.currentName },
      skipFirstSeenDateTag: true
    });
  }
  const saved = db.saveGroupRoles({
    botId,
    groupId: group.id,
    expectedVersion: group.version,
    roles: [{
      currentName: "王女士",
      identityType: "customer",
      description: "学生家长",
      replyPolicy: "always"
    }]
  });
  const task = db.createGroupAutomationTask({
    botId,
    groupId: group.id,
    name: taskType === "conditional_push" ? "作业完成提醒" : "每周学习总结",
    taskType,
    cadence: "daily",
    scheduleDays: [],
    timeOfDay: "09:00",
    conditionText: taskType === "conditional_push" ? "今天客户已经完成作业" : "",
    content: taskType === "conditional_push" ? "今天的作业已经完成，辛苦啦！" : "",
    summaryTemplate: taskType === "periodic_summary"
      ? "本周期上课 {{明确完成的课程次数}} 次"
      : "",
    mentionRoleIds: mention ? [saved.roles[0].id] : [],
    enabled: true,
    nextRunAt: targetAt
  });
  const evidence = db.insertConversationMessage({
    botId,
    conversationKey: group.conversationKey,
    direction: "inbound",
    senderName: "王女士",
    content: "今天的作业已经提交了"
  });
  return { group, task, role: saved.roles[0], evidence };
}

function workerFor({ executeAgentTask, sendGroupMessage, now = targetAt }) {
  return createGroupAutomationWorker({
    db: {
      prepareGroupAutomationOccurrences: db.prepareGroupAutomationOccurrences,
      recoverLegacyGroupAutomationOccurrences: db.recoverLegacyGroupAutomationOccurrences,
      claimDueGroupAutomationOccurrences: db.claimDueGroupAutomationOccurrences,
      getGroupAutomationOccurrence: db.getGroupAutomationOccurrence,
      getGroupById: db.getGroupById,
      getConversation: db.getConversation,
      upsertConversation: db.upsertConversation,
      validateGroupAutomationEvidenceMessageIds: db.validateGroupAutomationEvidenceMessageIds,
      transitionGroupAutomationOccurrence: db.transitionGroupAutomationOccurrence,
      markGroupAutomationSendUnknown: db.markGroupAutomationSendUnknown
    },
    getBinding: (botId) => ({
      botId,
      agentId: `${botId}-agent`,
      enabled: true,
      agentApiUrl: "https://dclaw.example.test/api/open/v1/targets/demo/messages",
      agentApiKey: "test-key"
    }),
    executeAgentTask,
    sendGroupMessage,
    now: () => new Date(now),
    logger: { info() {}, warn() {}, error() {} },
    leaseMs: 60_000
  });
}

test("condition true validates evidence, freezes fixed content, and safely queues one send", async () => {
  const context = createContext({ botId: "direct_worker_true" });
  const agentInputs = [];
  const sends = [];
  const worker = workerFor({
    executeAgentTask: async (input) => {
      agentInputs.push(input);
      return {
        taskType: "conditional_push",
        achieved: true,
        decisionNote: "客户已明确提交作业",
        evidenceMessageIds: [context.evidence.id]
      };
    },
    sendGroupMessage: async (input) => {
      sends.push(input);
      return { code: 0, data: { messageId: "wt-true-1" } };
    }
  });

  const [result] = await worker.runOccurrenceTick({ owner: "worker-true", limit: 10 });

  assert.equal(agentInputs.length, 1);
  assert.equal(agentInputs[0].conversation.conversationKey, context.group.conversationKey);
  assert.equal(agentInputs[0].occurrence.cycleStartAt, result.cycleStartAt);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].content, context.task.content);
  assert.deepEqual(sends[0].targets, [context.group.currentName]);
  assert.deepEqual(sends[0].atList, ["王女士"]);
  assert.equal(result.stage, "awaiting_confirmation");
  assert.equal(result.channelMessageId, "wt-true-1");
  assert.deepEqual(result.evidenceMessageIds, [context.evidence.id]);
});

test("a new managed group starts the same normal conversation before its first task", async () => {
  const context = createContext({
    botId: "direct_worker_new_conversation",
    withConversation: false
  });
  let receivedConversation = null;
  const worker = workerFor({
    executeAgentTask: async ({ conversation }) => {
      receivedConversation = conversation;
      return {
        taskType: "conditional_push",
        achieved: false,
        decisionNote: "当前普通会话没有明确完成记录",
        evidenceMessageIds: []
      };
    },
    sendGroupMessage: async () => ({ code: 0 })
  });

  const results = await worker.runOccurrenceTick({ owner: "worker-new-conversation", limit: 10 });
  const result = results.find((item) => item.botId === "direct_worker_new_conversation");

  assert.equal(result.stage, "skipped");
  assert.equal(receivedConversation.conversationKey, context.group.conversationKey);
  assert.equal(db.getConversation(context.group.conversationKey).conversationEpoch,
    receivedConversation.conversationEpoch);
});

test("condition false records the decision and never sends", async () => {
  createContext({ botId: "direct_worker_false" });
  let sends = 0;
  const worker = workerFor({
    executeAgentTask: async () => ({
      taskType: "conditional_push",
      achieved: false,
      decisionNote: "本周期没有明确的完成记录",
      evidenceMessageIds: []
    }),
    sendGroupMessage: async () => {
      sends += 1;
      return { code: 0 };
    }
  });

  const results = await worker.runOccurrenceTick({ owner: "worker-false", limit: 10 });
  const result = results.find((item) => item.botId === "direct_worker_false");

  assert.equal(result.stage, "skipped");
  assert.equal(result.conditionAchieved, false);
  assert.match(result.decisionNote, /没有明确/u);
  assert.equal(sends, 0);
});

test("periodic summary sends only Agent-generated customer content", async () => {
  const context = createContext({
    botId: "direct_worker_summary",
    taskType: "periodic_summary",
    mention: false
  });
  const sends = [];
  const worker = workerFor({
    executeAgentTask: async () => ({
      taskType: "periodic_summary",
      content: "本周期明确完成课程 2 次，作业完成 1 次。",
      decisionNote: "依据课程结束和作业提交记录汇总",
      evidenceMessageIds: [context.evidence.id]
    }),
    sendGroupMessage: async (input) => {
      sends.push(input);
      return { code: 200, messageId: "wt-summary-1" };
    }
  });

  const results = await worker.runOccurrenceTick({ owner: "worker-summary", limit: 10 });
  const result = results.find((item) => item.botId === "direct_worker_summary");

  assert.equal(result.stage, "awaiting_confirmation");
  assert.equal(result.renderedContent, "本周期明确完成课程 2 次，作业完成 1 次。");
  assert.equal(sends[0].content, result.renderedContent);
  assert.deepEqual(sends[0].atList, []);
});

test("foreign evidence fails closed before delivery", async () => {
  createContext({ botId: "direct_worker_invalid_evidence" });
  const otherGroup = db.createOrGetGroup({
    botId: "direct_worker_other_group",
    currentName: "其他 Bot 群",
    source: "callback",
    discoveredAt: "2026-08-01T00:00:00.000Z"
  });
  const otherEvidence = db.insertConversationMessage({
    botId: "direct_worker_other_group",
    conversationKey: otherGroup.conversationKey,
    direction: "inbound",
    senderName: "其他客户",
    content: "其他群的记录"
  });
  let sends = 0;
  const worker = workerFor({
    executeAgentTask: async ({ occurrence }) => ({
      taskType: occurrence.taskSnapshot.taskType,
      achieved: true,
      decisionNote: "错误引用了其他 Bot 的消息",
      evidenceMessageIds: [otherEvidence.id]
    }),
    sendGroupMessage: async () => {
      sends += 1;
      return { code: 0 };
    }
  });

  const results = await worker.runOccurrenceTick({ owner: "worker-invalid", limit: 10 });
  const result = results.find((item) => item.botId === "direct_worker_invalid_evidence");

  assert.equal(result.stage, "failed");
  assert.match(result.errorMessage, /evidence/iu);
  assert.equal(sends, 0);
});

test("ambiguous upstream delivery becomes delivery_unknown and is not retried", async () => {
  const context = createContext({ botId: "direct_worker_unknown" });
  let sends = 0;
  const worker = workerFor({
    executeAgentTask: async () => ({
      taskType: "conditional_push",
      achieved: true,
      decisionNote: "客户已提交",
      evidenceMessageIds: [context.evidence.id]
    }),
    sendGroupMessage: async () => {
      sends += 1;
      throw new Error("socket closed after command write");
    }
  });

  const results = await worker.runOccurrenceTick({ owner: "worker-unknown", limit: 10 });
  const result = results.find((item) => item.botId === "direct_worker_unknown");

  assert.equal(result.stage, "delivery_unknown");
  assert.equal(sends, 1);
});
