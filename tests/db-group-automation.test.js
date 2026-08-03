import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-group-automation-db-test-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");

function createGroupWithRoles(botId, groupName = `${botId}群`) {
  const group = db.createOrGetGroup({
    botId,
    currentName: groupName,
    source: "callback",
    discoveredAt: "2026-08-01T00:00:00.000Z"
  });
  const saved = db.saveGroupRoles({
    botId,
    groupId: group.id,
    expectedVersion: group.version,
    roles: [
      {
        currentName: "家长",
        identityType: "customer",
        description: "家长",
        replyPolicy: "always"
      },
      {
        currentName: "授课老师",
        identityType: "colleague",
        description: "直播授课老师",
        replyPolicy: "mention_only"
      }
    ]
  });
  return { group: saved.group, roles: saved.roles };
}

function createWeeklyTask({ botId, groupId, mentionRoleIds = [], enabled = true }) {
  return db.createGroupAutomationTask({
    botId,
    groupId,
    name: "作业提醒",
    taskType: "conditional_push",
    cadence: "weekly",
    scheduleDays: [1, 3, 5],
    timeOfDay: "20:00",
    conditionText: "本周客户尚未提交作业",
    content: "请记得提交作业",
    summaryTemplate: "",
    mentionRoleIds,
    enabled,
    nextRunAt: "2026-08-05T12:00:00.000Z"
  });
}

test("persists group tasks and atomically claims each scheduled occurrence once", () => {
  const botId = "group_automation_claim_bot";
  const { group, roles } = createGroupWithRoles(botId);
  const task = createWeeklyTask({
    botId,
    groupId: group.id,
    mentionRoleIds: roles.map((role) => role.id)
  });

  assert.deepEqual(task.mentionRoleIds, roles.map((role) => role.id));
  assert.equal(task.version, 1);

  const claimed = db.claimDueGroupAutomationOccurrences({
    nowIso: "2026-08-05T12:00:00.000Z",
    limit: 10,
    leaseMs: 300000
  });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].scheduledFor, "2026-08-05T12:00:00.000Z");
  assert.equal(claimed[0].status, "evaluating");
  assert.equal(claimed[0].cycleKey, "2026-W32");
  assert.equal(db.claimDueGroupAutomationOccurrences({
    nowIso: "2026-08-05T12:00:00.000Z",
    limit: 10,
    leaseMs: 300000
  }).length, 0);

  const stored = db.getGroupAutomationTask({ botId, taskId: task.id });
  assert.equal(stored.nextRunAt, "2026-08-07T12:00:00.000Z");
});

test("task updates use optimistic versions and soft deletion retains execution history", () => {
  const botId = "group_automation_version_bot";
  const { group } = createGroupWithRoles(botId);
  const task = createWeeklyTask({ botId, groupId: group.id });
  const occurrence = db.claimDueGroupAutomationOccurrences({
    nowIso: "2026-08-05T12:00:00.000Z",
    limit: 100,
    leaseMs: 300000
  }).find((item) => item.groupId === group.id);
  db.completeGroupAutomationOccurrence({
    botId,
    occurrenceId: occurrence.id,
    status: "skipped",
    conditionAchieved: false,
    reason: "尚未发现提交记录",
    evidenceMessageIds: []
  });

  const updated = db.updateGroupAutomationTask({
    botId,
    taskId: task.id,
    expectedVersion: task.version,
    name: "作业提醒（更新）",
    enabled: false
  });
  assert.equal(updated.version, 2);
  assert.equal(updated.enabled, false);
  assert.throws(() => db.updateGroupAutomationTask({
    botId,
    taskId: task.id,
    expectedVersion: task.version,
    name: "过期写入"
  }), (error) => error?.code === "GROUP_AUTOMATION_VERSION_CONFLICT");

  const deleted = db.softDeleteGroupAutomationTask({
    botId,
    taskId: task.id,
    expectedVersion: updated.version
  });
  assert.ok(deleted.deletedAt);
  assert.deepEqual(db.listGroupAutomationTasks({ botId, groupId: group.id }), []);
  assert.equal(db.listGroupAutomationOccurrences({
    botId,
    taskId: task.id
  }).items[0].reason, "尚未发现提交记录");
});

test("disabled tasks are not claimed and duplicated tasks get independent identities", () => {
  const botId = "group_automation_disabled_bot";
  const { group } = createGroupWithRoles(botId);
  const disabled = createWeeklyTask({ botId, groupId: group.id, enabled: false });
  assert.deepEqual(db.claimDueGroupAutomationOccurrences({
    nowIso: "2026-08-05T12:00:00.000Z",
    limit: 10,
    leaseMs: 300000
  }), []);

  const duplicate = db.duplicateGroupAutomationTask({
    botId,
    taskId: disabled.id,
    name: "作业提醒副本"
  });
  assert.notEqual(duplicate.id, disabled.id);
  assert.equal(duplicate.name, "作业提醒副本");
  assert.equal(duplicate.enabled, false);
});

test("mention resolution uses latest role names and warns when a role was removed", () => {
  const botId = "group_automation_mentions_bot";
  const { group, roles } = createGroupWithRoles(botId);
  const task = createWeeklyTask({
    botId,
    groupId: group.id,
    mentionRoleIds: roles.map((role) => role.id)
  });
  const renamed = db.saveGroupRoles({
    botId,
    groupId: group.id,
    expectedVersion: group.version,
    roles: [{
      ...roles[0],
      currentName: "家长-王女士"
    }]
  });

  const resolved = db.resolveGroupAutomationMentionNames({
    botId,
    groupId: group.id,
    roleIds: task.mentionRoleIds
  });
  assert.deepEqual(resolved.names, ["家长-王女士"]);
  assert.equal(resolved.warnings.length, 1);
  assert.match(resolved.warnings[0], /授课老师|removed/);
  assert.equal(renamed.roles.length, 1);
});

test("group task identities and reads are isolated by Bot", () => {
  const { group } = createGroupWithRoles("group_automation_owner_bot", "共享群名");
  createGroupWithRoles("group_automation_other_bot", "共享群名");
  const task = createWeeklyTask({
    botId: "group_automation_owner_bot",
    groupId: group.id
  });

  assert.equal(db.getGroupAutomationTask({
    botId: "group_automation_other_bot",
    taskId: task.id
  }), null);
  assert.throws(() => db.updateGroupAutomationTask({
    botId: "group_automation_other_bot",
    taskId: task.id,
    expectedVersion: 1,
    name: "越权修改"
  }), /not found/);
});

test("occurrence retries reuse the same identity and sending snapshots are durable", () => {
  const botId = "group_automation_retry_bot";
  const { group, roles } = createGroupWithRoles(botId);
  createWeeklyTask({
    botId,
    groupId: group.id,
    mentionRoleIds: roles.map((role) => role.id)
  });
  const occurrence = db.claimDueGroupAutomationOccurrences({
    nowIso: "2026-08-05T12:00:00.000Z",
    limit: 100,
    leaseMs: 300000
  }).find((item) => item.groupId === group.id);
  db.scheduleGroupAutomationOccurrenceRetry({
    botId,
    occurrenceId: occurrence.id,
    nextRetryAt: "2026-08-05T12:01:00.000Z",
    errorMessage: "Agent 暂时失败"
  });
  assert.equal(db.claimDueGroupAutomationOccurrences({
    nowIso: "2026-08-05T12:00:59.000Z",
    limit: 1,
    leaseMs: 300000
  }).length, 0);
  const retried = db.claimDueGroupAutomationOccurrences({
    nowIso: "2026-08-05T12:01:00.000Z",
    limit: 1,
    leaseMs: 300000
  })[0];
  assert.equal(retried.id, occurrence.id);
  assert.equal(retried.attempts, 2);

  const sending = db.markGroupAutomationOccurrenceSending({
    botId,
    occurrenceId: occurrence.id,
    renderedContent: "请提交作业",
    mentionRoleIds: roles.map((role) => role.id),
    mentionNames: ["家长", "授课老师"],
    conditionAchieved: true,
    reason: "已达成",
    variableValues: {},
    factIds: ["fact-1"],
    evidenceMessageIds: [12]
  });
  assert.equal(sending.status, "sending");
  assert.deepEqual(sending.mentionNames, ["家长", "授课老师"]);
  assert.equal(sending.renderedContent, "请提交作业");
});

test("delivery_unknown is never automatically reclaimed but can be manually retried", () => {
  const botId = "group_automation_unknown_bot";
  const { group } = createGroupWithRoles(botId);
  createWeeklyTask({ botId, groupId: group.id });
  const occurrence = db.claimDueGroupAutomationOccurrences({
    nowIso: "2026-08-05T12:00:00.000Z",
    limit: 1,
    leaseMs: 300000
  })[0];
  db.completeGroupAutomationOccurrence({
    botId,
    occurrenceId: occurrence.id,
    status: "delivery_unknown",
    errorMessage: "网络结果未知"
  });
  assert.equal(db.claimDueGroupAutomationOccurrences({
    nowIso: "2026-08-06T12:00:00.000Z",
    limit: 1,
    leaseMs: 300000
  }).some((item) => item.id === occurrence.id), false);

  db.retryGroupAutomationOccurrence({
    botId,
    occurrenceId: occurrence.id,
    nextRetryAt: "2026-08-06T12:01:00.000Z"
  });
  assert.equal(db.claimDueGroupAutomationOccurrences({
    nowIso: "2026-08-06T12:01:00.000Z",
    limit: 10,
    leaseMs: 300000
  }).some((item) => item.id === occurrence.id), true);
});

test("manual occurrence retry enforces the managed group scope", () => {
  const botId = "group_automation_retry_scope_bot";
  const { group } = createGroupWithRoles(botId, "原群");
  const { group: otherGroup } = createGroupWithRoles(botId, "其他群");
  createWeeklyTask({ botId, groupId: group.id });
  const occurrence = db.claimDueGroupAutomationOccurrences({
    nowIso: "2026-08-05T12:00:00.000Z",
    limit: 100,
    leaseMs: 300000
  }).find((item) => item.groupId === group.id);
  db.completeGroupAutomationOccurrence({
    botId,
    occurrenceId: occurrence.id,
    status: "delivery_unknown",
    errorMessage: "未知"
  });

  assert.throws(() => db.retryGroupAutomationOccurrence({
    botId,
    groupId: otherGroup.id,
    occurrenceId: occurrence.id,
    nextRetryAt: "2026-08-06T12:01:00.000Z"
  }), /not found/);
});

test("deleting a Bot removes its managed groups, automations, occurrences and ledger data", () => {
  const botId = "group_automation_delete_bot";
  db.upsertBotBinding({
    botId,
    botName: "待删除群任务 Bot",
    agentId: "group_automation_delete_agent",
    enabled: true
  });
  const { group } = createGroupWithRoles(botId);
  const task = createWeeklyTask({ botId, groupId: group.id });
  db.claimDueGroupAutomationOccurrences({
    nowIso: "2026-08-05T12:00:00.000Z",
    limit: 100,
    leaseMs: 300000
  });
  db.enqueueGroupLedgerJob({
    botId,
    groupId: group.id,
    mode: "reindex",
    taskId: task.id,
    fromMessageId: 0,
    throughMessageId: 1
  });

  db.deleteBotData(botId);

  assert.equal(db.getGroupById({ botId, groupId: group.id }), null);
  assert.equal(db.getGroupAutomationTask({ botId, taskId: task.id }), null);
  assert.deepEqual(db.listGroupAutomationOccurrences({ botId, taskId: task.id }).items, []);
  assert.equal(db.listGroupsPage({ botId }).pagination.total, 0);
});

test("merging a duplicate managed group moves its scheduled tasks and history to the target", () => {
  const botId = "group_automation_merge_bot";
  const { group: source } = createGroupWithRoles(botId, "重复群");
  const { group: target } = createGroupWithRoles(botId, "正式群");
  const task = createWeeklyTask({ botId, groupId: source.id });
  const occurrence = db.claimDueGroupAutomationOccurrences({
    nowIso: "2026-08-05T12:00:00.000Z",
    limit: 100,
    leaseMs: 300000
  }).find((item) => item.taskId === task.id);

  db.mergeGroupAlias({ botId, sourceGroupId: source.id, targetGroupId: target.id });

  const movedTask = db.getGroupAutomationTask({ botId, taskId: task.id });
  assert.equal(movedTask.groupId, target.id);
  assert.equal(db.listGroupAutomationTasks({ botId, groupId: source.id }).length, 0);
  assert.equal(db.listGroupAutomationTasks({ botId, groupId: target.id }).some((item) => item.id === task.id), true);
  assert.equal(
    db.listGroupAutomationOccurrences({ botId, taskId: task.id }).items.find((item) => item.id === occurrence.id).groupId,
    target.id
  );
});

test("a failed WorkTool command callback marks the matching sent occurrence failed within its Bot", () => {
  const botId = "group_automation_callback_bot";
  const { group } = createGroupWithRoles(botId);
  const task = createWeeklyTask({ botId, groupId: group.id });
  const occurrence = db.claimDueGroupAutomationOccurrences({
    nowIso: "2026-08-05T12:00:00.000Z",
    limit: 100,
    leaseMs: 300000
  }).find((item) => item.taskId === task.id);
  db.completeGroupAutomationOccurrence({
    botId,
    occurrenceId: occurrence.id,
    status: "sent",
    worktoolMessageId: "worktool-group-command-1",
    renderedContent: "提醒内容"
  });

  assert.equal(db.updateGroupAutomationOccurrenceFromCommandCallback({
    botId: "another-bot",
    messageId: "worktool-group-command-1",
    payload: { errorCode: 299999, errorReason: "发送失败" }
  }), null);
  const failed = db.updateGroupAutomationOccurrenceFromCommandCallback({
    botId,
    messageId: "worktool-group-command-1",
    payload: { errorCode: 299999, errorReason: "发送失败" }
  });
  assert.equal(failed.status, "failed");
  assert.match(failed.errorMessage, /发送失败/);
});
