import assert from "node:assert/strict";
import test from "node:test";

import { createGroupAutomationWorker } from "../src/group-automation-worker.js";

function createLedgerHarness({ tasks, agentReply, agentError = null, messageIds = null } = {}) {
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
    listInboundGroupMessagesForLedger({ afterMessageId = 0, throughMessageId, limit = 120 }) {
      if (messageIds) {
        return messageIds
          .filter((id) => id > afterMessageId && id <= throughMessageId)
          .slice(0, limit)
          .map((id) => ({
            id,
            direction: "inbound",
            senderName: "家长",
            content: `第 ${id} 条群消息`,
            createdAt: "2026-08-04T10:00:00.000Z"
          }));
      }
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
      job.fromMessageId = input.throughMessageId;
      job.status = input.throughMessageId < job.throughMessageId ? "pending" : "completed";
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
          achieved: false,
          reason: "尚无明确证据",
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

test("ledger analysis advances by the last message in each bounded batch without skipping messages", async () => {
  const harness = createLedgerHarness({
    messageIds: Array.from({ length: 250 }, (_, index) => index + 1)
  });
  await harness.worker.enqueueLive({ botId: "bot-1", groupId: "group-1", throughMessageId: 250 });

  for (let index = 0; index < 20; index += 1) {
    await harness.worker.runLedgerTick();
  }

  assert.deepEqual(harness.failed, []);
  const cursors = harness.applied.map((item) => item.throughMessageId);
  assert.equal(cursors.at(-1), 250);
  assert.ok(cursors.length > 2);
  assert.ok(cursors.every((cursor, index) => index === 0 || cursor > cursors[index - 1]));
  assert.match(harness.invocations.at(-1).request.message, /第 250 条群消息/);
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
  groupName = "最新群名",
  ledgerBacklogSize = 0,
  initialLedgerCursor = 0,
  reindexPending = false,
  sendResponse = { code: 0, messageId: "worktool-message-1" },
  sendError = null,
  projectionFacts = null,
  projectionAggregates = {}
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
  let ledgerCursor = initialLedgerCursor;
  const ledgerJob = {
    id: "ledger-job-1",
    botId: "bot-1",
    groupId: "group-1",
    mode: "live",
    taskId: "",
    fromMessageId: reindexPending ? 0 : initialLedgerCursor,
    throughMessageId: ledgerBacklogSize,
    attempts: 0,
    status: reindexPending || ledgerBacklogSize > initialLedgerCursor ? "pending" : "completed"
  };
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
        facts: projectionFacts || [{
          id: "fact-id-1",
          semanticKey: "lesson:1",
          category: "lesson",
          statement: "本周完成一节课",
          value: { count: 1 },
          happenedAt: "2026-08-04T10:00:00.000Z",
          evidenceMessageIds: [41],
          active: true
        }],
        aggregates: projectionAggregates
      };
    },
    getGroupLedgerState() {
      return { liveCursorMessageId: ledgerCursor, backfillCursors: {} };
    },
    hasUnfinishedGroupLedgerReindex() {
      return reindexPending && ledgerJob.status !== "completed";
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
    enqueueGroupLedgerJob() {
      ledgerJob.status = "pending";
      ledgerJob.fromMessageId = ledgerCursor;
      ledgerJob.throughMessageId = ledgerBacklogSize;
      return { ...ledgerJob };
    },
    claimGroupLedgerJobs() {
      if (!ledgerBacklogSize || ledgerJob.status !== "pending") return [];
      ledgerJob.status = "processing";
      ledgerJob.attempts += 1;
      return [{ ...ledgerJob }];
    },
    applyGroupLedgerEvaluation(input) {
      ledgerCursor = input.throughMessageId;
      ledgerJob.fromMessageId = ledgerCursor;
      ledgerJob.status = ledgerCursor < ledgerJob.throughMessageId ? "pending" : "completed";
      return { liveCursorMessageId: ledgerCursor, backfillCursors: {} };
    },
    failGroupLedgerJob() {},
    listGroupAutomationTasks() { return [{ ...task }]; },
    listInboundGroupMessagesForLedger({ afterMessageId, throughMessageId, limit }) {
      return Array.from({ length: Math.min(limit, throughMessageId - afterMessageId) }, (_, index) => ({
        id: afterMessageId + index + 1,
        direction: "inbound",
        senderName: "家长",
        content: "已完成作业",
        createdAt: "2026-08-04T10:00:00.000Z"
      }));
    },
    getLatestInboundGroupMessageId() { return ledgerBacklogSize; }
  };
  const worker = createGroupAutomationWorker({
    db,
    getBinding: () => ({ botId: "bot-1", agentId: "agent-1", enabled: true }),
    invokeAgent: async (input) => {
      invocationCalls.push(input);
      if (agentError) throw agentError;
      if (input.purpose === "group-ledger") {
        return JSON.stringify({ facts: [], conditionStates: [] });
      }
      return agentReply || JSON.stringify({
        achieved: true,
        reason: "事实表明已完成",
        supportingFactKeys: ["lesson:1"],
        contradictingFactKeys: []
      });
    },
    sendText: async (input) => {
      sendCalls.push(input);
      if (sendError) throw sendError;
      return sendResponse;
    },
    now: () => new Date("2026-08-04T12:00:00.000Z"),
    logger: { info() {}, warn() {}, error() {} }
  });
  return {
    worker,
    db,
    task,
    occurrence,
    sendCalls,
    invocationCalls,
    outboundMessages,
    getLedgerCursor: () => ledgerCursor
  };
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

test("occurrence waits until every bounded ledger batch is current before evaluating and sending", async () => {
  const harness = createOccurrenceHarness({ ledgerBacklogSize: 250 });
  await harness.worker.runOccurrenceTick();

  assert.equal(harness.getLedgerCursor(), 250);
  assert.ok(
    harness.invocationCalls.filter((call) => call.purpose === "group-ledger").length > 1
  );
  assert.equal(harness.invocationCalls.at(-1).purpose, "group-automation-occurrence");
  assert.equal(harness.sendCalls.length, 1);
});

test("occurrence waits for a pending reindex even when the shared live cursor is already current", async () => {
  const harness = createOccurrenceHarness({
    ledgerBacklogSize: 10,
    initialLedgerCursor: 10,
    reindexPending: true
  });
  await harness.worker.runOccurrenceTick();
  assert.ok(harness.invocationCalls.some((call) => call.purpose === "group-ledger"));
  assert.equal(harness.sendCalls.length, 1);
});

test("scalar WorkTool response data is retained as the provider message ID", async () => {
  const harness = createOccurrenceHarness({
    sendResponse: { code: 0, data: "worktool-command-42" }
  });
  await harness.worker.runOccurrenceTick();
  assert.equal(harness.occurrence.worktoolMessageId, "worktool-command-42");
});

test("explicit WorkTool rejection is safely retried while an ambiguous transport error is not", async () => {
  const rejected = createOccurrenceHarness({
    sendResponse: { code: 1001, message: "command rejected" }
  });
  await rejected.worker.runOccurrenceTick();
  assert.equal(rejected.occurrence.status, "retry_wait");

  const ambiguous = createOccurrenceHarness({ sendError: new Error("socket closed") });
  await ambiguous.worker.runOccurrenceTick();
  assert.equal(ambiguous.occurrence.status, "delivery_unknown");
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

test("cumulative summary can cite bounded historical aggregate evidence outside the current cycle", async () => {
  const historicalFact = {
    id: "fact-old",
    semanticKey: "lesson:2026-07:1",
    category: "lesson_completed",
    statement: "7月完成一节课",
    value: { count: 1 },
    happenedAt: "2026-07-10T10:00:00.000Z",
    evidenceMessageIds: [31],
    active: true
  };
  const harness = createOccurrenceHarness({
    taskType: "periodic_summary",
    summaryTemplate: "累计上课 {{累计上课次数（从建群至今明确完成的课程总次数；只输出数字）}} 次",
    projectionFacts: [historicalFact],
    projectionAggregates: {
      lesson_completed: {
        factCount: 1,
        numericSums: { count: 1 },
        firstHappenedAt: historicalFact.happenedAt,
        lastHappenedAt: historicalFact.happenedAt,
        evidenceFactKeys: [historicalFact.semanticKey],
        evidenceMessageIds: [31]
      }
    },
    agentReply: JSON.stringify({
      variables: [{
        name: "累计上课次数",
        value: "1",
        factKeys: [historicalFact.semanticKey],
        fallbackUsed: false,
        reason: "累计聚合有一节已完成课程"
      }]
    })
  });

  await harness.worker.runOccurrenceTick();

  assert.equal(harness.sendCalls[0].content, "累计上课 1 次");
  assert.match(harness.invocationCalls[0].request.message, /"factCount": 1/);
  assert.doesNotMatch(harness.invocationCalls[0].request.message, /7月完成一节课/);
  assert.deepEqual(harness.occurrence.evidenceMessageIds, [31]);
});

test("ordinary cycle summary cannot consume historical cumulative aggregates", async () => {
  const harness = createOccurrenceHarness({
    taskType: "periodic_summary",
    summaryTemplate: "本周上课 {{本周上课次数（本周明确完成的课程；只输出数字）}} 次",
    projectionAggregates: {
      lesson_completed: {
        factCount: 99,
        numericSums: { count: 99 },
        evidenceFactKeys: ["lesson:old"],
        evidenceMessageIds: [1]
      }
    },
    agentReply: JSON.stringify({
      variables: [{
        name: "本周上课次数",
        value: "1",
        factKeys: ["lesson:1"],
        fallbackUsed: false,
        reason: "本周有一次完成记录"
      }]
    })
  });

  await harness.worker.runOccurrenceTick();

  assert.equal(harness.sendCalls.length, 1);
  assert.doesNotMatch(harness.invocationCalls[0].request.message, /"factCount": 99/);
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

test("summary rejects language that reveals internal role, system-record or prompt sources", async () => {
  for (const value of [
    "根据角色配置，该成员已完成1次课程",
    "根据角色的配置，该成员已完成1次课程",
    "根据系统记录，本周已完成1次课程",
    "按照系统里的记录，本周已完成1次课程",
    "按照提示词要求，本周已完成1次课程",
    "依照提示中的内容，本周已完成1次课程"
  ]) {
    const harness = createOccurrenceHarness({
      taskType: "periodic_summary",
      agentReply: JSON.stringify({
        variables: [{
          name: "上课次数",
          value,
          factKeys: ["lesson:1"],
          fallbackUsed: false,
          reason: "来自事实"
        }]
      })
    });
    await harness.worker.runOccurrenceTick();
    assert.equal(harness.sendCalls.length, 0, value);
    assert.equal(harness.occurrence.status, "retry_wait", value);
  }
});

test("summary cannot repeat private background text even without a disclosure marker", async () => {
  const harness = createOccurrenceHarness({
    taskType: "periodic_summary",
    agentReply: JSON.stringify({
      variables: [{
        name: "上课次数",
        value: "小明购买了课程",
        factKeys: ["lesson:1"],
        fallbackUsed: false,
        reason: "来自事实"
      }]
    })
  });
  await harness.worker.runOccurrenceTick();
  assert.equal(harness.sendCalls.length, 0);
  assert.equal(harness.occurrence.status, "retry_wait");
});
