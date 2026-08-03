import assert from "node:assert/strict";
import test from "node:test";

import { createGroupAutomationWorker } from "../src/group-automation-worker.js";

function createLedgerHarness({ tasks, agentReply, agentError = null } = {}) {
  const jobs = [];
  const applied = [];
  const failed = [];
  const invocations = [];
  const published = [];
  const db = {
    enqueueGroupLedgerJob(input) {
      const existing = jobs.find((job) => job.status === "pending");
      if (existing) {
        existing.throughMessageId = Math.max(existing.throughMessageId, input.throughMessageId);
        return existing;
      }
      const job = {
        id: `job-${jobs.length + 1}`,
        ...input,
        mode: input.mode || "live",
        taskId: input.taskId || "",
        fromMessageId: 0,
        throughMessageId: input.throughMessageId,
        attempts: 0,
        status: "pending"
      };
      jobs.push(job);
      return job;
    },
    claimGroupLedgerJobs() {
      const pending = jobs.filter((job) => job.status === "pending");
      for (const job of pending) {
        job.status = "processing";
        job.attempts += 1;
      }
      return pending;
    },
    getGroupById() {
      return {
        id: "group-1",
        currentName: "学习群",
        conversationKey: "bot-1:group-id:group-1",
        background: "课程服务群"
      };
    },
    listGroupRoles() {
      return [{ id: "role-1", currentName: "家长", replyPolicy: "never" }];
    },
    listGroupAutomationTasks() {
      return tasks || [{
        id: "task-condition",
        enabled: true,
        taskType: "conditional_push",
        cadence: "daily",
        conditionText: "今天完成作业",
        content: "请提交作业"
      }];
    },
    listGroupLedgerProjection() {
      return { facts: [] };
    },
    listInboundGroupMessagesForLedger({ throughMessageId }) {
      return [
        {
          id: throughMessageId - 1,
          direction: "inbound",
          senderName: "家长",
          content: "作业完成了",
          createdAt: "2026-08-04T10:00:00.000Z"
        },
        {
          id: throughMessageId,
          direction: "inbound",
          senderName: "家长",
          content: "请老师查收",
          createdAt: "2026-08-04T10:01:00.000Z"
        }
      ];
    },
    applyGroupLedgerEvaluation(input) {
      applied.push(input);
      const job = jobs.find((item) => item.id === input.jobId);
      job.status = "completed";
    },
    failGroupLedgerJob(input) {
      failed.push(input);
      const job = jobs.find((item) => item.id === input.jobId);
      job.status = "failed";
    }
  };
  const worker = createGroupAutomationWorker({
    db,
    getBinding: () => ({ botId: "bot-1", agentId: "agent-1", enabled: true }),
    invokeAgent: async (input) => {
      invocations.push(input);
      if (agentError) throw agentError;
      return agentReply || JSON.stringify({
        facts: [],
        conditionStates: [{
          taskId: "task-condition",
          cycleKey: "2026-08-04",
          achieved: true,
          reason: "家长明确完成",
          supportingFactKeys: [],
          contradictingFactKeys: []
        }]
      });
    },
    publish: (event) => published.push(event),
    now: () => new Date("2026-08-04T12:00:00.000Z"),
    logger: { info() {}, warn() {}, error() {} }
  });
  return { worker, db, jobs, applied, failed, invocations, published };
}

test("coalesced live messages invoke one background ledger analysis through the latest ID", async () => {
  const harness = createLedgerHarness();
  await harness.worker.enqueueLive({ botId: "bot-1", groupId: "group-1", throughMessageId: 52 });
  await harness.worker.enqueueLive({ botId: "bot-1", groupId: "group-1", throughMessageId: 55 });
  await harness.worker.runLedgerTick();

  assert.equal(harness.invocations.length, 1);
  assert.equal(harness.invocations[0].priority, "background");
  assert.equal(harness.applied[0].throughMessageId, 55);
  assert.doesNotMatch(harness.invocations[0].request.message, /outbound/);
  assert.deepEqual(harness.published, [{
    botId: "bot-1",
    groupId: "group-1",
    ledgerUpdated: true
  }]);
});

test("one ledger pass can update multiple condition tasks", async () => {
  const tasks = ["task-a", "task-b"].map((id) => ({
    id,
    enabled: true,
    taskType: "conditional_push",
    cadence: "daily",
    conditionText: `${id} 条件`,
    content: "固定内容"
  }));
  const harness = createLedgerHarness({
    tasks,
    agentReply: JSON.stringify({
      facts: [],
      conditionStates: tasks.map((task) => ({
        taskId: task.id,
        cycleKey: "2026-08-04",
        achieved: false,
        reason: "尚无明确证据",
        supportingFactKeys: [],
        contradictingFactKeys: []
      }))
    })
  });
  await harness.worker.enqueueLive({ botId: "bot-1", groupId: "group-1", throughMessageId: 55 });
  await harness.worker.runLedgerTick();
  assert.deepEqual(
    harness.applied[0].conditionStates.map((state) => state.taskId),
    ["task-a", "task-b"]
  );
});

test("no analyzable task completes the ledger cursor without invoking the Agent", async () => {
  const harness = createLedgerHarness({
    tasks: [{
      id: "fixed-push",
      enabled: true,
      taskType: "conditional_push",
      cadence: "daily",
      conditionText: "",
      content: "每天固定通知"
    }]
  });
  await harness.worker.enqueueLive({ botId: "bot-1", groupId: "group-1", throughMessageId: 55 });
  await harness.worker.runLedgerTick();
  assert.equal(harness.invocations.length, 0);
  assert.deepEqual(harness.applied[0].facts, []);
  assert.deepEqual(harness.applied[0].conditionStates, []);
});

test("Agent failures leave a bounded retryable durable job", async () => {
  const harness = createLedgerHarness({ agentError: new Error("temporary Agent failure") });
  await harness.worker.enqueueLive({ botId: "bot-1", groupId: "group-1", throughMessageId: 55 });
  await harness.worker.runLedgerTick();
  assert.equal(harness.applied.length, 0);
  assert.equal(harness.failed.length, 1);
  assert.equal(harness.failed[0].terminal, false);
  assert.equal(harness.failed[0].nextRetryAt, "2026-08-04T12:01:00.000Z");
});

function createOccurrenceHarness({
  taskType = "conditional_push",
  conditionText = "今天已经完成作业",
  content = "请提交作业",
  summaryTemplate = "本周上课 {{上课次数（明确完成才计数；无记录填0）}} 次",
  agentReply,
  agentError = null,
  mentionNames = ["家长", "授课老师"],
  groupName = "最新群名"
} = {}) {
  const sendCalls = [];
  const invocationCalls = [];
  const outboundMessages = [];
  const occurrence = {
    id: "occurrence-1",
    taskId: "task-1",
    botId: "bot-1",
    groupId: "group-1",
    scheduledFor: "2026-08-04T12:00:00.000Z",
    cycleKey: "2026-08-04",
    cycleStartAt: "2026-08-03T16:00:00.000Z",
    cycleEndAt: "2026-08-04T16:00:00.000Z",
    status: "pending",
    attempts: 0,
    mentionRoleIds: ["role-parent", "role-teacher"]
  };
  const task = {
    id: "task-1",
    botId: "bot-1",
    groupId: "group-1",
    enabled: true,
    taskType,
    cadence: taskType === "periodic_summary" ? "weekly" : "daily",
    conditionText,
    content,
    summaryTemplate,
    mentionRoleIds: occurrence.mentionRoleIds
  };
  let claimed = false;
  const db = {
    claimDueGroupAutomationOccurrences() {
      if (claimed || !["pending", "retry_wait"].includes(occurrence.status)) return [];
      claimed = true;
      occurrence.status = "evaluating";
      occurrence.attempts += 1;
      return [{ ...occurrence }];
    },
    getGroupAutomationTask() {
      return { ...task };
    },
    getGroupById() {
      return {
        id: "group-1",
        currentName: groupName,
        conversationKey: "bot-1:group-id:group-1",
        background: "小明购买了课程"
      };
    },
    listGroupRoles() {
      return [
        { id: "role-parent", currentName: mentionNames[0] || "", identityType: "customer" },
        { id: "role-teacher", currentName: mentionNames[1] || "", identityType: "colleague" }
      ].filter((role) => role.currentName);
    },
    listGroupLedgerProjection() {
      return {
        facts: [{
          id: "fact-id-1",
          semanticKey: "lesson:1",
          category: "lesson",
          statement: "本周完成一节课",
          value: { count: 1 },
          happenedAt: "2026-08-04T10:00:00.000Z",
          evidenceMessageIds: [41],
          active: true
        }]
      };
    },
    getLatestInboundGroupMessageId() {
      return 0;
    },
    getGroupLedgerState() {
      return { liveCursorMessageId: 0, backfillCursors: {} };
    },
    resolveGroupAutomationMentionNames() {
      return { names: mentionNames.filter(Boolean), warnings: [] };
    },
    markGroupAutomationOccurrenceSending(input) {
      occurrence.status = "sending";
      occurrence.renderedContent = input.renderedContent;
      occurrence.mentionNames = input.mentionNames;
      return { ...occurrence };
    },
    completeGroupAutomationOccurrence(input) {
      Object.assign(occurrence, input, { status: input.status });
      return { ...occurrence };
    },
    scheduleGroupAutomationOccurrenceRetry(input) {
      Object.assign(occurrence, input, { status: "retry_wait" });
      claimed = false;
      return { ...occurrence };
    },
    failGroupAutomationOccurrence(input) {
      Object.assign(occurrence, input, { status: "failed" });
      return { ...occurrence };
    },
    insertConversationMessage(input) {
      outboundMessages.push(input);
      return { id: 99, ...input };
    },
    enqueueGroupLedgerJob() {},
    claimGroupLedgerJobs() { return []; },
    applyGroupLedgerEvaluation() {},
    failGroupLedgerJob() {},
    listGroupAutomationTasks() { return []; },
    listInboundGroupMessagesForLedger() { return []; },
    getLatestInboundGroupMessageId() { return 0; }
  };
  const worker = createGroupAutomationWorker({
    db,
    getBinding: () => ({ botId: "bot-1", agentId: "agent-1", enabled: true }),
    invokeAgent: async (input) => {
      invocationCalls.push(input);
      if (agentError) throw agentError;
      return agentReply || JSON.stringify({
        achieved: true,
        reason: "事实表明已完成",
        supportingFactKeys: ["lesson:1"],
        contradictingFactKeys: []
      });
    },
    sendText: async (input) => {
      sendCalls.push(input);
      return { code: 0, messageId: "worktool-message-1" };
    },
    now: () => new Date("2026-08-04T12:00:00.000Z"),
    logger: { info() {}, warn() {}, error() {} }
  });
  return { worker, db, task, occurrence, sendCalls, invocationCalls, outboundMessages };
}

test("true conditional push sends fixed content once to the latest group name with latest mentions", async () => {
  const harness = createOccurrenceHarness({
    mentionNames: ["家长-王女士", "直播授课老师"],
    groupName: "课程交付群（新）"
  });
  await harness.worker.runOccurrenceTick();
  await harness.worker.runOccurrenceTick();

  assert.equal(harness.invocationCalls.length, 1);
  assert.equal(harness.invocationCalls[0].priority, "background");
  assert.deepEqual(harness.sendCalls, [{
    robotId: "bot-1",
    targets: ["课程交付群（新）"],
    content: "请提交作业",
    atList: ["家长-王女士", "直播授课老师"]
  }]);
  assert.equal(harness.occurrence.status, "sent");
  assert.equal(harness.outboundMessages[0].rawPayload.source, "group_automation");
});

test("fixed push without a condition bypasses Agent while false condition skips delivery", async () => {
  const fixed = createOccurrenceHarness({ conditionText: "" });
  await fixed.worker.runOccurrenceTick();
  assert.equal(fixed.invocationCalls.length, 0);
  assert.equal(fixed.sendCalls.length, 1);

  const conditional = createOccurrenceHarness({
    agentReply: JSON.stringify({
      achieved: false,
      reason: "尚未发现完成证据",
      supportingFactKeys: [],
      contradictingFactKeys: []
    })
  });
  await conditional.worker.runOccurrenceTick();
  assert.equal(conditional.sendCalls.length, 0);
  assert.equal(conditional.occurrence.status, "skipped");
  assert.equal(conditional.occurrence.conditionAchieved, false);
});

test("periodic summary renders exact validated variables and permits explicit fallback", async () => {
  const summary = createOccurrenceHarness({
    taskType: "periodic_summary",
    agentReply: JSON.stringify({
      variables: [{
        name: "上课次数",
        value: "1",
        factKeys: ["lesson:1"],
        fallbackUsed: false,
        reason: "有一次明确完成记录"
      }]
    })
  });
  await summary.worker.runOccurrenceTick();
  assert.equal(summary.sendCalls[0].content, "本周上课 1 次");
  assert.deepEqual(summary.occurrence.variableValues, { 上课次数: "1" });

  const fallback = createOccurrenceHarness({
    taskType: "periodic_summary",
    agentReply: JSON.stringify({
      variables: [{
        name: "上课次数",
        value: "0",
        factKeys: [],
        fallbackUsed: true,
        reason: "模板明确要求无记录填0"
      }]
    })
  });
  await fallback.worker.runOccurrenceTick();
  assert.equal(fallback.sendCalls[0].content, "本周上课 0 次");
});

test("Agent failure never sends and remains safely retryable", async () => {
  const harness = createOccurrenceHarness({
    agentError: new Error("Agent timeout")
  });
  await harness.worker.runOccurrenceTick();
  assert.equal(harness.sendCalls.length, 0);
  assert.equal(harness.occurrence.status, "retry_wait");
  assert.equal(harness.occurrence.nextRetryAt, "2026-08-04T12:01:00.000Z");
});

test("summary disclosure or unsupported value is rejected before delivery", async () => {
  const disclosure = createOccurrenceHarness({
    taskType: "periodic_summary",
    agentReply: JSON.stringify({
      variables: [{
        name: "上课次数",
        value: "群背景里写着1",
        factKeys: ["lesson:1"],
        fallbackUsed: false,
        reason: "来自事实"
      }]
    })
  });
  await disclosure.worker.runOccurrenceTick();
  assert.equal(disclosure.sendCalls.length, 0);
  assert.equal(disclosure.occurrence.status, "retry_wait");
});
