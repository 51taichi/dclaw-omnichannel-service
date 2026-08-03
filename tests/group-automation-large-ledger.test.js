import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createGroupAutomationWorker } from "../src/group-automation-worker.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-group-large-ledger-test-"));
process.env.DATA_DIR = dataDir;
const db = await import("../src/db.js");

test("a 2,000-message group ledger drains every bounded SQLite batch without skipping", async () => {
  const botId = "large-ledger-bot";
  const group = db.createOrGetGroup({ botId, currentName: "长期学习群", source: "callback" });
  const task = db.createGroupAutomationTask({
    botId,
    groupId: group.id,
    name: "每日作业判断",
    taskType: "conditional_push",
    cadence: "daily",
    scheduleDays: [],
    timeOfDay: "20:00",
    conditionText: "今天是否交了作业",
    content: "请提交作业",
    summaryTemplate: "",
    mentionRoleIds: [],
    enabled: true,
    nowIso: "2026-08-04T00:00:00.000Z"
  });
  let lastMessageId = 0;
  for (let index = 1; index <= 2000; index += 1) {
    lastMessageId = db.insertConversationMessage({
      botId,
      conversationKey: group.conversationKey,
      direction: "inbound",
      senderName: "家长",
      content: `第 ${index} 条客观群消息`
    }).id;
  }

  let invocations = 0;
  const worker = createGroupAutomationWorker({
    db,
    getBinding: () => ({ botId, agentId: "agent-1", enabled: true }),
    invokeAgent: async () => {
      invocations += 1;
      return JSON.stringify({
        facts: [],
        conditionStates: [{
          taskId: task.id,
          cycleKey: "2026-08-04",
          achieved: false,
          reason: "本批没有达成证据",
          supportingFactKeys: [],
          contradictingFactKeys: []
        }]
      });
    },
    now: () => new Date("2026-08-04T12:00:00.000Z"),
    logger: { info() {}, warn() {}, error() {} }
  });

  await worker.enqueueLive({ botId, groupId: group.id, throughMessageId: lastMessageId });
  for (let batch = 0; batch < 250; batch += 1) {
    await worker.runLedgerTick();
    if (db.getGroupLedgerState({ botId, groupId: group.id }).liveCursorMessageId >= lastMessageId) {
      break;
    }
  }

  assert.equal(db.getGroupLedgerState({ botId, groupId: group.id }).liveCursorMessageId, lastMessageId);
  assert.ok(invocations > 10);
  assert.equal(db.claimGroupLedgerJobs({
    nowIso: "2026-08-04T13:00:00.000Z",
    limit: 10,
    leaseMs: 300000
  }).length, 0);
});

test("real SQLite occurrence uses bounded cross-month aggregates without loading old fact statements", async () => {
  const botId = "cumulative-occurrence-bot";
  const group = db.createOrGetGroup({
    botId,
    currentName: "跨月课程群",
    source: "callback"
  });
  const task = db.createGroupAutomationTask({
    botId,
    groupId: group.id,
    name: "累计课程周报",
    taskType: "periodic_summary",
    cadence: "weekly",
    scheduleDays: [2],
    timeOfDay: "20:00",
    conditionText: "",
    content: "",
    summaryTemplate: "累计上课 {{累计上课次数（从建群至今明确完成的课程；只输出数字）}} 次",
    mentionRoleIds: [],
    enabled: true,
    nextRunAt: "2026-08-04T12:00:00.000Z"
  });
  const oldMessage = db.insertConversationMessage({
    botId,
    conversationKey: group.conversationKey,
    direction: "inbound",
    senderName: "家长",
    content: "7月课程已完成"
  });
  const currentMessage = db.insertConversationMessage({
    botId,
    conversationKey: group.conversationKey,
    direction: "inbound",
    senderName: "家长",
    content: "本周课程已完成"
  });
  db.enqueueGroupLedgerJob({
    botId,
    groupId: group.id,
    mode: "live",
    throughMessageId: currentMessage.id
  });
  const ledgerJob = db.claimGroupLedgerJobs({
    nowIso: "2026-08-04T11:50:00.000Z",
    limit: 1,
    leaseMs: 300000
  })[0];
  db.applyGroupLedgerEvaluation({
    jobId: ledgerJob.id,
    botId,
    groupId: group.id,
    throughMessageId: currentMessage.id,
    facts: [
      {
        operation: "upsert",
        semanticKey: "lesson:2026-07:1",
        category: "lesson_completed",
        statement: "7月课程已完成",
        value: { count: 1 },
        happenedAt: "2026-07-10T10:00:00.000Z",
        speakerName: "家长",
        roleId: "",
        evidenceMessageIds: [oldMessage.id]
      },
      {
        operation: "upsert",
        semanticKey: "lesson:2026-08:1",
        category: "lesson_completed",
        statement: "本周课程已完成",
        value: { count: 1 },
        happenedAt: "2026-08-04T10:00:00.000Z",
        speakerName: "家长",
        roleId: "",
        evidenceMessageIds: [currentMessage.id]
      }
    ],
    conditionStates: []
  });

  let occurrenceRequest = "";
  const sends = [];
  const worker = createGroupAutomationWorker({
    db,
    getBinding: () => ({ botId, agentId: "agent-1", enabled: true }),
    invokeAgent: async ({ request, purpose }) => {
      assert.equal(purpose, "group-automation-occurrence");
      occurrenceRequest = request.message;
      return JSON.stringify({
        variables: [{
          name: "累计上课次数",
          value: "2",
          factKeys: ["lesson:2026-07:1", "lesson:2026-08:1"],
          fallbackUsed: false,
          reason: "累计聚合记录两次已完成课程"
        }]
      });
    },
    sendText: async (input) => {
      sends.push(input);
      return { code: 0, data: "cumulative-command-1" };
    },
    now: () => new Date("2026-08-04T12:00:00.000Z"),
    logger: { info() {}, warn() {}, error() {} }
  });

  await worker.runOccurrenceTick();

  assert.equal(sends[0].content, "累计上课 2 次");
  assert.match(occurrenceRequest, /"factCount": 2/);
  assert.doesNotMatch(occurrenceRequest, /7月课程已完成/);
  const occurrence = db.listGroupAutomationOccurrences({
    botId,
    taskId: task.id
  }).items[0];
  assert.equal(occurrence.status, "sent");
  assert.deepEqual(occurrence.evidenceMessageIds, [oldMessage.id, currentMessage.id]);
});
