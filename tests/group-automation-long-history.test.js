import assert from "node:assert/strict";
import test from "node:test";

import { createGroupAutomationWorker } from "../src/group-automation-worker.js";

function historyMessage(id, occurredAt, content = `消息 ${id}`) {
  return {
    externalMessageId: `wt-message-${id}`,
    occurredAt,
    senderName: "家长",
    participantRoleId: "role-parent",
    direction: "inbound",
    source: "worktool_local",
    messageType: "text",
    content
  };
}

function createPhasedHarness({
  taskType = "conditional_push",
  conditionText = "今天是否完成作业",
  content = "请完成作业",
  summaryTemplate = "本周学习情况总结",
  messages = [],
  transcriptMaxChars = 8_000,
  failChunkOrdinalOnce = null,
  finalDecision = null
} = {}) {
  let clock = new Date("2026-08-05T03:50:00.000Z");
  const scheduledFor = "2026-08-05T04:00:00.000Z";
  const taskSnapshot = {
    id: "task-1",
    botId: "bot-1",
    groupId: "group-1",
    name: "群任务",
    taskType,
    cadence: taskType === "periodic_summary" ? "weekly" : "daily",
    conditionText,
    content,
    summaryTemplate,
    mentionRoleIds: ["role-parent"],
    group: {
      id: "group-1",
      currentName: "冻结群名",
      background: "冻结背景",
      createdAt: "2026-01-01T00:00:00.000Z"
    },
    roles: [{
      id: "role-parent",
      currentName: "家长",
      identityType: "客户",
      description: "孩子家长"
    }]
  };
  const occurrence = {
    id: "occ-1",
    taskId: "task-1",
    botId: "bot-1",
    groupId: "group-1",
    scheduledFor,
    cycleKey: "2026-08-05",
    cycleStartAt: "2026-08-04T16:00:00.000Z",
    cycleEndAt: "2026-08-05T16:00:00.000Z",
    status: "pending",
    stage: "preanalysis_pending",
    leaseOwner: "",
    taskSnapshot,
    historyStartAt: "2026-08-04T16:00:00.000Z",
    historyEndAt: scheduledFor,
    preanalysisCutoffAt: "2026-08-05T03:50:00.000Z",
    frozenPayload: {},
    retryMetadata: {}
  };
  const checkpoints = new Map();
  const transitions = [];
  const analyzeCalls = [];
  const mergeCalls = [];
  const finalCalls = [];
  const sendCalls = [];
  const ensureCalls = [];
  const listCalls = [];
  const logs = [];
  const chunkFailures = new Set();

  const db = {
    claimPreparatoryGroupAutomationOccurrences({ owner }) {
      if (!["preanalysis_pending", "retry_wait"].includes(occurrence.stage)) return [];
      occurrence.stage = "preanalysis";
      occurrence.leaseOwner = owner;
      return [{ ...occurrence }];
    },
    claimTargetGroupAutomationOccurrences({ owner, now }) {
      if (occurrence.stage !== "waiting_target") return [];
      if (new Date(now).getTime() < new Date(occurrence.scheduledFor).getTime()) return [];
      occurrence.stage = "delta_analysis";
      occurrence.leaseOwner = owner;
      return [{ ...occurrence }];
    },
    getGroupAutomationOccurrence() {
      return structuredClone(occurrence);
    },
    getGroupById() {
      return {
        id: "group-1",
        currentName: "已被修改的群名",
        conversationKey: "bot-1:group-id:group-1",
        background: "不应使用的新背景",
        createdAt: "2026-01-01T00:00:00.000Z"
      };
    },
    getLatestGroupConversationMessageIdAtOrBefore({ until }) {
      const upper = new Date(until).getTime();
      return messages
        .filter((message) => new Date(message.occurredAt).getTime() <= upper)
        .map((message) => Number(message.externalMessageId.replace("wt-message-", "")))
        .at(-1) || 0;
    },
    getGroupAutomationChunkCheckpoint({ occurrenceId, stage, level, ordinal, inputHash }) {
      return checkpoints.get(`${occurrenceId}:${stage}:${level}:${ordinal}:${inputHash}`) || null;
    },
    saveGroupAutomationChunkCheckpoint(input) {
      const checkpoint = {
        ...input,
        evidenceMessageIds: input.evidenceMessageIds || []
      };
      checkpoints.set(
        `${input.occurrenceId}:${input.stage}:${input.level}:${input.ordinal}:${input.inputHash}`,
        checkpoint
      );
      return checkpoint;
    },
    heartbeatGroupAutomationOccurrence() {
      return { ...occurrence };
    },
    transitionGroupAutomationOccurrence({ fromStages, toStage, patch = {} }) {
      assert.ok(fromStages.includes(occurrence.stage));
      transitions.push({ from: occurrence.stage, to: toStage, patch: structuredClone(patch) });
      occurrence.stage = toStage;
      Object.assign(occurrence, patch);
      if (["waiting_target", "sent", "skipped", "failed"].includes(toStage)) {
        occurrence.leaseOwner = "";
      }
      occurrence.status = toStage === "sent"
        ? "sent"
        : toStage === "skipped" ? "skipped" : occurrence.status;
      return structuredClone(occurrence);
    },
    resolveGroupAutomationMentionNames({ roleIds }) {
      return {
        names: taskSnapshot.roles
          .filter((role) => roleIds.includes(role.id))
          .map((role) => role.currentName),
        warnings: []
      };
    }
  };

  const historySyncWorker = {
    async ensureSyncedThrough(input) {
      ensureCalls.push(input);
      return { ready: true, syncedThroughMessageId: input.throughMessageId };
    }
  };
  const listDclawHistory = async ({ from, until, after = "" }) => {
    listCalls.push({ from, until, after });
    const lower = new Date(from).getTime();
    const upper = new Date(until).getTime();
    const filtered = messages.filter((message) => {
      const time = new Date(message.occurredAt).getTime();
      return time >= lower && time <= upper;
    });
    const offset = Number(after || 0);
    const page = filtered.slice(offset, offset + 7);
    const next = offset + page.length;
    return {
      messages: page,
      nextCursor: next < filtered.length ? String(next) : "",
      hasMore: next < filtered.length
    };
  };
  const analyzeChunk = async (input) => {
    analyzeCalls.push(input);
    if (
      failChunkOrdinalOnce === input.chunkOrdinal
      && !chunkFailures.has(input.chunkOrdinal)
    ) {
      chunkFailures.add(input.chunkOrdinal);
      throw new Error("chunk failed once");
    }
    return {
      analysis: `分析 ${input.transcriptChunk.messageCodes.join(",")}`,
      evidenceMessageCodes: input.transcriptChunk.messageCodes.slice(0, 1)
    };
  };
  const mergeAnalyses = async (input) => {
    mergeCalls.push(input);
    return {
      analysis: input.partials.map((partial) => partial.analysis).join("；"),
      evidenceMessageCodes: [...new Set(input.partials.flatMap(
        (partial) => partial.evidenceMessageCodes
      ))]
    };
  };
  const finalizeConditional = async (input) => {
    finalCalls.push(input);
    return finalDecision || {
      achieved: false,
      decisionNote: "没有明确完成记录",
      evidenceMessageCodes: []
    };
  };
  const finalizeSummary = async (input) => {
    finalCalls.push(input);
    return finalDecision || {
      content: "本周暂无明确记录。",
      decisionNote: "周期内记录稀疏",
      evidenceMessageCodes: []
    };
  };
  const worker = createGroupAutomationWorker({
    db,
    historySyncWorker,
    listDclawHistory,
    analyzeChunk,
    mergeAnalyses,
    finalizeConditional,
    finalizeSummary,
    sendGroupMessage: async (input) => {
      sendCalls.push(input);
      return { code: 0, messageId: "send-1" };
    },
    now: () => new Date(clock),
    logger: {
      info(event, fields) { logs.push({ level: "info", event, fields }); },
      warn(event, fields) { logs.push({ level: "warn", event, fields }); },
      error(event, fields) { logs.push({ level: "error", event, fields }); }
    },
    transcriptMaxChars,
    mergeBatchMaxItems: 2
  });

  return {
    worker,
    db,
    occurrence,
    checkpoints,
    transitions,
    analyzeCalls,
    mergeCalls,
    finalCalls,
    sendCalls,
    ensureCalls,
    listCalls,
    logs,
    setClock(value) { clock = new Date(value); }
  };
}

test("preanalyzes through T-10, waits for T, and analyzes only the exact target delta", async () => {
  const harness = createPhasedHarness({
    messages: [
      historyMessage(1, "2026-08-05T03:40:00.000Z", "此前消息"),
      historyMessage(2, "2026-08-05T03:55:00.000Z", "刚刚完成作业"),
      historyMessage(3, "2026-08-05T04:00:00.000Z", "目标时刻消息"),
      historyMessage(4, "2026-08-05T04:00:01.000Z", "目标之后消息")
    ]
  });

  await harness.worker.runOccurrenceTick({ owner: "worker-1", limit: 10 });
  assert.equal(harness.occurrence.stage, "waiting_target");
  assert.equal(harness.finalCalls.length, 0);
  assert.equal(harness.sendCalls.length, 0);
  assert.equal(harness.analyzeCalls.length, 1);
  assert.match(harness.analyzeCalls[0].transcriptChunk.text, /此前消息/);
  assert.doesNotMatch(harness.analyzeCalls[0].transcriptChunk.text, /刚刚完成作业/);

  harness.setClock("2026-08-05T04:00:00.000Z");
  await harness.worker.runOccurrenceTick({ owner: "worker-1", limit: 10 });
  assert.equal(harness.occurrence.stage, "skipped");
  assert.equal(harness.sendCalls.length, 0);
  assert.equal(harness.analyzeCalls.length, 2);
  assert.match(harness.analyzeCalls[1].transcriptChunk.text, /刚刚完成作业/);
  assert.match(harness.analyzeCalls[1].transcriptChunk.text, /目标时刻消息/);
  assert.doesNotMatch(harness.analyzeCalls[1].transcriptChunk.text, /目标之后消息/);
  assert.equal(harness.finalCalls.length, 1);
});

test("uses the frozen task, background, roles, and cumulative history range", async () => {
  const harness = createPhasedHarness({
    conditionText: "从建群至今是否累计完成20次作业",
    messages: [historyMessage(1, "2026-01-02T03:40:00.000Z", "第一次作业")]
  });
  await harness.worker.runOccurrenceTick({ owner: "worker-1", limit: 10 });

  assert.equal(harness.listCalls[0].from, "2026-01-01T00:00:00.000Z");
  assert.equal(harness.analyzeCalls[0].group.currentName, "冻结群名");
  assert.equal(harness.analyzeCalls[0].group.background, "冻结背景");
  assert.equal(harness.analyzeCalls[0].roles[0].description, "孩子家长");
  assert.equal(harness.analyzeCalls[0].task.conditionText, "从建群至今是否累计完成20次作业");
});

test("checkpoints every long-history chunk, resumes only the failed chunk, and merges recursively", async () => {
  const messages = Array.from({ length: 30 }, (_, index) => historyMessage(
    index + 1,
    new Date(Date.UTC(2026, 7, 5, 1, index)).toISOString(),
    `第 ${index + 1} 条${"很长内容".repeat(12)}`
  ));
  const harness = createPhasedHarness({
    messages,
    transcriptMaxChars: 900,
    failChunkOrdinalOnce: 1
  });

  await harness.worker.runOccurrenceTick({ owner: "worker-1", limit: 10 });
  assert.equal(harness.occurrence.stage, "retry_wait");
  const completedBeforeRetry = harness.analyzeCalls.filter((call) => call.chunkOrdinal === 0).length;
  assert.equal(completedBeforeRetry, 1);

  await harness.worker.runOccurrenceTick({ owner: "worker-1", limit: 10 });
  assert.equal(harness.occurrence.stage, "waiting_target");
  assert.equal(harness.analyzeCalls.filter((call) => call.chunkOrdinal === 0).length, 1);
  assert.equal(harness.analyzeCalls.filter((call) => call.chunkOrdinal === 1).length, 2);
  assert.ok(harness.mergeCalls.length > 1);
  assert.ok(Math.max(...harness.mergeCalls.map((call) => call.level)) > 0);

  const analyzedCodes = new Set(harness.analyzeCalls.flatMap(
    (call) => call.transcriptChunk.messageCodes
  ));
  assert.equal(analyzedCodes.size, messages.length);
});

test("mandatory sparse summary freezes and sends nonempty content without a condition gate", async () => {
  const harness = createPhasedHarness({
    taskType: "periodic_summary",
    messages: [],
    finalDecision: {
      content: "本周暂无明确记录。",
      decisionNote: "周期内没有群消息",
      evidenceMessageCodes: []
    }
  });
  await harness.worker.runOccurrenceTick({ owner: "worker-1", limit: 10 });
  harness.setClock("2026-08-05T04:00:00.000Z");
  await harness.worker.runOccurrenceTick({ owner: "worker-1", limit: 10 });

  assert.equal(harness.occurrence.stage, "sent");
  assert.equal(harness.sendCalls[0].content, "本周暂无明确记录。");
  assert.deepEqual(harness.sendCalls[0].atList, ["家长"]);
  assert.equal(harness.occurrence.frozenPayload.content, "本周暂无明确记录。");
});

test("technical analysis failure never sends and metrics never contain message or context bodies", async () => {
  const secret = "绝不能进入日志的秘密内容";
  const harness = createPhasedHarness({
    messages: [historyMessage(1, "2026-08-05T03:40:00.000Z", secret)],
    failChunkOrdinalOnce: 0
  });
  await harness.worker.runOccurrenceTick({ owner: "worker-1", limit: 10 });

  assert.equal(harness.occurrence.stage, "retry_wait");
  assert.equal(harness.sendCalls.length, 0);
  const serializedLogs = JSON.stringify(harness.logs);
  assert.doesNotMatch(serializedLogs, new RegExp(secret));
  assert.doesNotMatch(serializedLogs, /冻结背景/);
  assert.match(serializedLogs, /messageCount|chunkCount|stageDurationMs/);
});
