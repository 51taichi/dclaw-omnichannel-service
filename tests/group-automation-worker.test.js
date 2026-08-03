import assert from "node:assert/strict";
import test from "node:test";

import { createGroupAutomationWorker } from "../src/group-automation-worker.js";

function createLedgerHarness({ tasks, agentReply, agentError = null } = {}) {
  const jobs = [];
  const applied = [];
  const failed = [];
  const invocations = [];
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
    now: () => new Date("2026-08-04T12:00:00.000Z"),
    logger: { info() {}, warn() {}, error() {} }
  });
  return { worker, db, jobs, applied, failed, invocations };
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
