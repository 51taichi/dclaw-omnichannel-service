import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnichannel-group-automation-db-test-"));
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

function createWeeklyTask({ botId, groupId, mentionRoleIds = [], enabled = true, name = "作业提醒" }) {
  return db.createGroupAutomationTask({
    botId,
    groupId,
    name,
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

test("task updates use optimistic versions and soft deletion retain the task audit", () => {
  const botId = "group_automation_version_bot";
  const { group } = createGroupWithRoles(botId);
  const task = createWeeklyTask({ botId, groupId: group.id });

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
  assert.deepEqual(db.listGroupAutomationTasks({
    botId,
    groupId: group.id,
    includeDeleted: true
  }).map((item) => item.id), [task.id]);
});
test("disabled tasks can be duplicated with independent identities", () => {
  const botId = "group_automation_disabled_bot";
  const { group } = createGroupWithRoles(botId);
  const disabled = createWeeklyTask({ botId, groupId: group.id, enabled: false });
  const duplicate = db.duplicateGroupAutomationTask({
    botId,
    taskId: disabled.id,
    name: "作业提醒副本"
  });
  assert.notEqual(duplicate.id, disabled.id);
  assert.equal(duplicate.name, "作业提醒副本");
  assert.equal(duplicate.enabled, false);
});

test("re-enabling a task discards stale disabled schedules instead of backfilling old sends", () => {
  const botId = "group_automation_reenable_bot";
  const { group } = createGroupWithRoles(botId);
  const disabled = db.createGroupAutomationTask({
    botId,
    groupId: group.id,
    name: "重新启用提醒",
    taskType: "conditional_push",
    cadence: "daily",
    scheduleDays: [],
    timeOfDay: "20:00",
    conditionText: "客户今天是否完成作业",
    content: "测试提醒",
    summaryTemplate: "",
    mentionRoleIds: [],
    enabled: false,
    nextRunAt: "2020-01-01T12:00:00.000Z"
  });

  const beforeEnable = Date.now();
  const enabled = db.updateGroupAutomationTask({
    botId,
    taskId: disabled.id,
    expectedVersion: disabled.version,
    enabled: true
  });

  assert.ok(new Date(enabled.nextRunAt).getTime() > beforeEnable);
  db.updateGroupAutomationTask({
    botId,
    taskId: enabled.id,
    expectedVersion: enabled.version,
    enabled: false
  });
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

test("deleting a Bot removes its managed groups, automations, and occurrences", () => {
  const botId = "group_automation_delete_bot";
  db.upsertBotBinding({
    botId,
    botName: "待删除群任务 Bot",
    agentId: "group_automation_delete_agent",
    enabled: true
  });
  const { group } = createGroupWithRoles(botId);
  const task = createWeeklyTask({ botId, groupId: group.id });
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
  const sourceEvidence = db.insertConversationMessage({
    botId,
    conversationKey: source.conversationKey,
    direction: "inbound",
    senderName: "客户",
    content: "原群中的客观证据"
  });
  db.mergeGroupAlias({ botId, sourceGroupId: source.id, targetGroupId: target.id });

  const movedTask = db.getGroupAutomationTask({ botId, taskId: task.id });
  assert.equal(movedTask.groupId, target.id);
  assert.equal(db.listGroupAutomationTasks({ botId, groupId: source.id }).length, 0);
  assert.equal(db.listGroupAutomationTasks({ botId, groupId: target.id }).some((item) => item.id === task.id), true);
  assert.equal(db.listConversationMessages({
    botId,
    conversationKey: target.conversationKey
  }).find((message) => message.id === sourceEvidence.id)?.content, "原群中的客观证据");
});

test("task type validation requires an objective condition only for conditional pushes", () => {
  const botId = "group_automation_contract_bot";
  const { group } = createGroupWithRoles(botId);
  assert.throws(() => db.createGroupAutomationTask({
    botId,
    groupId: group.id,
    name: "缺少条件",
    taskType: "conditional_push",
    cadence: "daily",
    scheduleDays: [],
    timeOfDay: "20:00",
    conditionText: "",
    content: "提醒",
    summaryTemplate: "",
    enabled: true,
    nextRunAt: "2026-08-05T12:00:00.000Z"
  }), /condition/i);
  assert.throws(() => db.createGroupAutomationTask({
    botId,
    groupId: group.id,
    name: "汇总不应有条件",
    taskType: "periodic_summary",
    cadence: "weekly",
    scheduleDays: [3],
    timeOfDay: "20:00",
    conditionText: "客户是否交作业",
    content: "",
    summaryTemplate: "本周复盘",
    enabled: true,
    nextRunAt: "2026-08-05T12:00:00.000Z"
  }), /condition/i);
});
