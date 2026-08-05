import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-group-automation-direct-db-test-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");

function createGroup(botId, name) {
  return db.createOrGetGroup({
    botId,
    currentName: name,
    source: "callback",
    discoveredAt: "2026-08-01T00:00:00.000Z"
  });
}

function createDailyTask({ botId, groupId, nextRunAt = "2026-08-06T01:00:00.000Z" }) {
  return db.createGroupAutomationTask({
    botId,
    groupId,
    name: "每日作业提醒",
    taskType: "conditional_push",
    cadence: "daily",
    scheduleDays: [],
    timeOfDay: "09:00",
    conditionText: "今天客户已经完成作业",
    content: "今天的作业已经完成，辛苦啦！",
    summaryTemplate: "",
    mentionRoleIds: [],
    enabled: true,
    nextRunAt
  });
}

test("direct occurrence preparation freezes configuration without claiming Agent work", () => {
  const botId = "direct_prepare_bot";
  const group = createGroup(botId, "作业群");
  const task = createDailyTask({ botId, groupId: group.id });

  const prepared = db.prepareGroupAutomationOccurrences({
    now: "2026-08-06T00:50:00.000Z",
    horizonMs: 600_000,
    limit: 10
  });
  const occurrence = prepared.find((item) => item.taskId === task.id);

  assert.ok(occurrence);
  assert.equal(occurrence.stage, "waiting_target");
  assert.equal(occurrence.leaseOwner, "");
  assert.equal(occurrence.stageAttempts, 0);
  assert.equal(occurrence.scheduledFor, "2026-08-06T01:00:00.000Z");
  assert.equal(occurrence.taskSnapshot.name, "每日作业提醒");
  assert.deepEqual(db.claimDueGroupAutomationOccurrences({
    owner: "direct-worker-a",
    now: "2026-08-06T00:59:59.999Z",
    leaseMs: 60_000,
    limit: 10
  }), []);

  const due = db.claimDueGroupAutomationOccurrences({
    owner: "direct-worker-a",
    now: "2026-08-06T01:00:00.000Z",
    leaseMs: 60_000,
    limit: 10
  });
  const claimed = due.find((item) => item.id === occurrence.id);
  assert.equal(claimed.stage, "evaluating");
  assert.equal(claimed.leaseOwner, "direct-worker-a");
  assert.equal(claimed.stageAttemptsByStage.evaluating, 1);
  assert.equal(db.claimDueGroupAutomationOccurrences({
    owner: "direct-worker-b",
    now: "2026-08-06T01:00:01.000Z",
    leaseMs: 60_000,
    limit: 10
  }).some((item) => item.id === occurrence.id), false);
});

test("direct occurrence claim resumes a frozen send without returning to Agent evaluation", () => {
  const botId = "direct_send_recovery_bot";
  const group = createGroup(botId, "发送恢复群");
  const task = createDailyTask({ botId, groupId: group.id });
  const occurrence = db.prepareGroupAutomationOccurrences({
    now: "2026-08-06T00:50:00.000Z",
    horizonMs: 600_000,
    limit: 10
  }).find((item) => item.taskId === task.id);
  const [claimed] = db.claimDueGroupAutomationOccurrences({
    owner: "direct-worker-a",
    now: "2026-08-06T01:00:00.000Z",
    leaseMs: 60_000,
    limit: 10
  }).filter((item) => item.id === occurrence.id);
  db.transitionGroupAutomationOccurrence({
    occurrenceId: claimed.id,
    owner: "direct-worker-a",
    fromStages: ["evaluating"],
    toStage: "send_pending",
    patch: {
      renderedContent: "今天的作业已经完成，辛苦啦！",
      frozenPayload: {
        targetGroupName: "发送恢复群",
        content: "今天的作业已经完成，辛苦啦！",
        atList: []
      }
    },
    now: "2026-08-06T01:00:01.000Z"
  });

  const sqlite = new DatabaseSync(path.join(dataDir, "worktool-bot-service.sqlite"));
  sqlite.prepare(`
    UPDATE managed_group_automation_occurrences
    SET lease_expires_at = '2026-08-06T01:00:02.000Z'
    WHERE id = ?
  `).run(occurrence.id);
  sqlite.close();

  const resumed = db.claimDueGroupAutomationOccurrences({
    owner: "direct-worker-b",
    now: "2026-08-06T01:00:03.000Z",
    leaseMs: 60_000,
    limit: 10
  }).find((item) => item.id === occurrence.id);

  assert.ok(resumed);
  assert.equal(resumed.stage, "send_pending");
  assert.equal(resumed.leaseOwner, "direct-worker-b");
  assert.equal(resumed.stageAttemptsByStage.send_pending, 1);
  assert.equal(resumed.frozenPayload.content, "今天的作业已经完成，辛苦啦！");
});

test("legacy analysis stages recover to waiting target without touching delivery confirmation", () => {
  const botId = "direct_recovery_bot";
  const group = createGroup(botId, "恢复群");
  const task = createDailyTask({ botId, groupId: group.id });
  const occurrence = db.prepareGroupAutomationOccurrences({
    now: "2026-08-06T00:50:00.000Z",
    horizonMs: 600_000,
    limit: 10
  }).find((item) => item.taskId === task.id);
  const sqlite = new DatabaseSync(path.join(dataDir, "worktool-bot-service.sqlite"));
  sqlite.prepare(`
    UPDATE managed_group_automation_occurrences
    SET stage = 'finalizing', lease_owner = 'legacy-worker',
        lease_expires_at = '2026-08-06T01:05:00.000Z'
    WHERE id = ?
  `).run(occurrence.id);
  sqlite.close();

  assert.equal(db.recoverLegacyGroupAutomationOccurrences({
    now: "2026-08-06T00:55:00.000Z"
  }), 1);
  const recovered = db.getGroupAutomationOccurrence({ botId, occurrenceId: occurrence.id });
  assert.equal(recovered.stage, "waiting_target");
  assert.equal(recovered.leaseOwner, "");
  assert.equal(recovered.leaseExpiresAt, "");
});

test("evidence validation accepts only persisted messages from the current Bot group", () => {
  const botId = "direct_evidence_bot";
  const groupA = createGroup(botId, "A群");
  const groupB = createGroup(botId, "B群");
  const otherBotGroup = createGroup("direct_evidence_other_bot", "其他 Bot 群");
  const messageA = db.insertConversationMessage({
    botId,
    conversationKey: groupA.conversationKey,
    direction: "inbound",
    senderName: "家长",
    content: "作业完成了"
  });
  const messageB = db.insertConversationMessage({
    botId,
    conversationKey: groupB.conversationKey,
    direction: "inbound",
    senderName: "家长",
    content: "另一个群的消息"
  });
  const otherBotMessage = db.insertConversationMessage({
    botId: "direct_evidence_other_bot",
    conversationKey: otherBotGroup.conversationKey,
    direction: "inbound",
    senderName: "家长",
    content: "其他 Bot 的消息"
  });

  assert.deepEqual(db.validateGroupAutomationEvidenceMessageIds({
    botId,
    groupId: groupA.id,
    messageIds: [messageA.id, messageA.id, messageB.id, otherBotMessage.id, 999999]
  }), {
    validIds: [messageA.id],
    invalidIds: [messageB.id, otherBotMessage.id, 999999]
  });
  assert.deepEqual(db.validateGroupAutomationEvidenceMessageIds({
    botId,
    groupId: groupA.id,
    messageIds: []
  }), { validIds: [], invalidIds: [] });
});
