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
