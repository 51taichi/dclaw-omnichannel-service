import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
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

test("preparatory claims freeze the task configuration at T-10 and advance from the target", () => {
  const botId = "group_automation_prepare_bot";
  const { group, roles } = createGroupWithRoles(botId);
  const task = createWeeklyTask({
    botId,
    groupId: group.id,
    mentionRoleIds: roles.map((role) => role.id)
  });

  const claimed = db.claimPreparatoryGroupAutomationOccurrences({
    owner: "prepare-worker-a",
    now: "2026-08-05T11:50:00.000Z",
    prepareBeforeMs: 600_000,
    leaseMs: 120_000,
    limit: 10
  });

  const occurrence = claimed.find((item) => item.taskId === task.id);
  assert.ok(occurrence);
  assert.equal(occurrence.scheduledFor, "2026-08-05T12:00:00.000Z");
  assert.equal(occurrence.preanalysisCutoffAt, "2026-08-05T11:50:00.000Z");
  assert.equal(occurrence.historyStartAt, "2026-08-02T16:00:00.000Z");
  assert.equal(occurrence.historyEndAt, "2026-08-05T12:00:00.000Z");
  assert.equal(occurrence.stage, "preanalysis");
  assert.equal(occurrence.leaseOwner, "prepare-worker-a");
  assert.equal(occurrence.stageAttempts, 1);
  assert.equal(occurrence.taskSnapshot.name, "作业提醒");
  assert.equal(occurrence.taskSnapshot.group.createdAt, group.createdAt);
  assert.deepEqual(occurrence.taskSnapshot.mentionRoleIds, roles.map((role) => role.id));
  assert.equal(db.getGroupAutomationTask({ botId, taskId: task.id }).nextRunAt, "2026-08-07T12:00:00.000Z");

  const updated = db.updateGroupAutomationTask({
    botId,
    taskId: task.id,
    expectedVersion: task.version,
    name: "修改后的任务名称"
  });
  assert.equal(updated.name, "修改后的任务名称");
  assert.equal(db.getGroupAutomationOccurrence({
    botId,
    occurrenceId: occurrence.id
  }).taskSnapshot.name, "作业提醒");
  db.transitionGroupAutomationOccurrence({
    occurrenceId: occurrence.id,
    owner: "prepare-worker-a",
    fromStages: ["preanalysis"],
    toStage: "waiting_target",
    now: "2026-08-05T11:51:00.000Z"
  });
});

test("occurrence checkpoints, heartbeat, transitions, and stage fencing are durable", () => {
  const botId = "group_automation_stage_bot";
  const { group } = createGroupWithRoles(botId);
  createWeeklyTask({ botId, groupId: group.id });
  const occurrence = db.claimPreparatoryGroupAutomationOccurrences({
    owner: "stage-worker-a",
    now: "2026-08-05T11:50:00.000Z",
    prepareBeforeMs: 600_000,
    leaseMs: 60_000,
    limit: 1
  })[0];

  const heartbeat = db.heartbeatGroupAutomationOccurrence({
    occurrenceId: occurrence.id,
    owner: "stage-worker-a",
    now: "2026-08-05T11:50:30.000Z",
    leaseMs: 60_000
  });
  assert.equal(heartbeat.leaseExpiresAt, "2026-08-05T11:51:30.000Z");

  const checkpoint = db.saveGroupAutomationChunkCheckpoint({
    occurrenceId: occurrence.id,
    stage: "preanalysis",
    level: 0,
    ordinal: 0,
    inputHash: "sha256:chunk-0",
    result: { summary: "本段确认完成一次作业" },
    evidenceMessageIds: [12, 13],
    now: "2026-08-05T11:50:40.000Z"
  });
  assert.deepEqual(checkpoint.evidenceMessageIds, [12, 13]);
  assert.deepEqual(db.saveGroupAutomationChunkCheckpoint({
    occurrenceId: occurrence.id,
    stage: "preanalysis",
    level: 0,
    ordinal: 0,
    inputHash: "sha256:chunk-0",
    result: { summary: "不得覆盖" },
    evidenceMessageIds: [99],
    now: "2026-08-05T11:50:50.000Z"
  }).result, { summary: "本段确认完成一次作业" });
  assert.deepEqual(db.getGroupAutomationChunkCheckpoint({
    occurrenceId: occurrence.id,
    stage: "preanalysis",
    level: 0,
    ordinal: 0,
    inputHash: "sha256:chunk-0"
  }).result, { summary: "本段确认完成一次作业" });

  const waiting = db.transitionGroupAutomationOccurrence({
    occurrenceId: occurrence.id,
    owner: "stage-worker-a",
    fromStages: ["preanalysis"],
    toStage: "waiting_target",
    patch: {
      decisionNote: "预分析已完成",
      evidenceMessageIds: [12, 13],
      frozenPayload: { partial: "完成一次作业" }
    },
    now: "2026-08-05T11:51:00.000Z"
  });
  assert.equal(waiting.stage, "waiting_target");
  assert.equal(waiting.leaseOwner, "");
  assert.equal(waiting.decisionNote, "预分析已完成");
  assert.throws(() => db.transitionGroupAutomationOccurrence({
    occurrenceId: occurrence.id,
    owner: "stage-worker-a",
    fromStages: ["waiting_target"],
    toStage: "preanalysis",
    now: "2026-08-05T11:51:01.000Z"
  }), /transition|stage/i);
  assert.throws(() => db.heartbeatGroupAutomationOccurrence({
    occurrenceId: occurrence.id,
    owner: "stage-worker-a",
    now: "2026-08-05T11:51:01.000Z",
    leaseMs: 60_000
  }), /lease|owner/i);
});

test("waiting target occurrences are claimed exactly at T and terminal transitions update status", () => {
  const botId = "group_automation_target_claim_bot";
  const { group } = createGroupWithRoles(botId);
  createWeeklyTask({ botId, groupId: group.id });
  const occurrence = db.claimPreparatoryGroupAutomationOccurrences({
    owner: "prepare-worker",
    now: "2026-08-05T11:50:00.000Z",
    prepareBeforeMs: 600_000,
    leaseMs: 60_000,
    limit: 1
  })[0];
  db.transitionGroupAutomationOccurrence({
    occurrenceId: occurrence.id,
    owner: "prepare-worker",
    fromStages: ["preanalysis"],
    toStage: "waiting_target",
    now: "2026-08-05T11:51:00.000Z"
  });

  assert.deepEqual(db.claimTargetGroupAutomationOccurrences({
    owner: "target-worker-a",
    now: "2026-08-05T11:59:59.999Z",
    leaseMs: 60_000,
    limit: 1
  }), []);
  const claimed = db.claimTargetGroupAutomationOccurrences({
    owner: "target-worker-a",
    now: "2026-08-05T12:00:00.000Z",
    leaseMs: 60_000,
    limit: 100
  });
  const target = claimed.find((item) => item.id === occurrence.id);
  assert.equal(target.stage, "delta_analysis");
  assert.equal(target.leaseOwner, "target-worker-a");
  const duplicateClaims = db.claimTargetGroupAutomationOccurrences({
    owner: "target-worker-b",
    now: "2026-08-05T12:00:01.000Z",
    leaseMs: 60_000,
    limit: 100
  });
  assert.equal(duplicateClaims.some((item) => item.id === occurrence.id), false);

  db.transitionGroupAutomationOccurrence({
    occurrenceId: occurrence.id,
    owner: "target-worker-a",
    fromStages: ["delta_analysis"],
    toStage: "finalizing",
    now: "2026-08-05T12:00:02.000Z"
  });
  const skipped = db.transitionGroupAutomationOccurrence({
    occurrenceId: occurrence.id,
    owner: "target-worker-a",
    fromStages: ["finalizing"],
    toStage: "skipped",
    patch: { decisionNote: "条件未达成" },
    now: "2026-08-05T12:00:03.000Z"
  });
  assert.equal(skipped.stage, "skipped");
  assert.equal(skipped.status, "skipped");
});

test("confirmed group delivery writes outbound history once and manual unknown resolution is idempotent", () => {
  const botId = "group_automation_delivery_resolution_bot";
  const { group } = createGroupWithRoles(botId);
  createWeeklyTask({ botId, groupId: group.id });

  function prepareSendingOccurrence(owner, scheduledFor) {
    const occurrence = db.claimPreparatoryGroupAutomationOccurrences({
      owner,
      now: new Date(new Date(scheduledFor).getTime() - 600_000).toISOString(),
      prepareBeforeMs: 600_000,
      leaseMs: 60_000,
      limit: 100
    }).find((item) => item.botId === botId);
    db.transitionGroupAutomationOccurrence({
      occurrenceId: occurrence.id,
      owner,
      fromStages: ["preanalysis"],
      toStage: "waiting_target",
      now: new Date(new Date(scheduledFor).getTime() - 500_000).toISOString()
    });
    const targetOwner = `${owner}-target`;
    const target = db.claimTargetGroupAutomationOccurrences({
      owner: targetOwner,
      now: scheduledFor,
      leaseMs: 60_000,
      limit: 100
    }).find((item) => item.id === occurrence.id);
    db.transitionGroupAutomationOccurrence({
      occurrenceId: target.id,
      owner: targetOwner,
      fromStages: ["delta_analysis"],
      toStage: "finalizing",
      now: scheduledFor
    });
    db.transitionGroupAutomationOccurrence({
      occurrenceId: target.id,
      owner: targetOwner,
      fromStages: ["finalizing"],
      toStage: "send_pending",
      patch: {
        frozenPayload: {
          targetGroupName: group.currentName,
          content: "固定群提醒",
          atList: ["家长"],
          mentionRoleIds: [],
          evidenceMessageIds: []
        },
        renderedContent: "固定群提醒",
        mentionNames: ["家长"]
      },
      now: scheduledFor
    });
    db.transitionGroupAutomationOccurrence({
      occurrenceId: target.id,
      owner: targetOwner,
      fromStages: ["send_pending"],
      toStage: "sending",
      now: scheduledFor
    });
    return { occurrenceId: target.id, owner: targetOwner };
  }

  const first = prepareSendingOccurrence("delivery-worker", "2026-08-05T12:00:00.000Z");
  db.transitionGroupAutomationOccurrence({
    occurrenceId: first.occurrenceId,
    owner: first.owner,
    fromStages: ["sending"],
    toStage: "awaiting_confirmation",
    patch: {
      worktoolMessageId: "command-1",
      worktoolResponse: { code: 0, messageId: "command-1" },
      deliveryState: "awaiting_confirmation"
    },
    now: "2026-08-05T12:00:01.000Z"
  });
  const confirmed = db.updateGroupAutomationOccurrenceFromCommandCallback({
    botId,
    messageId: "command-1",
    payload: { errorCode: 0 }
  });
  assert.equal(confirmed.stage, "sent");
  assert.equal(confirmed.status, "sent");
  db.updateGroupAutomationOccurrenceFromCommandCallback({
    botId,
    messageId: "command-1",
    payload: { errorCode: 0 }
  });
  assert.equal(db.listConversationMessages({
    botId,
    conversationKey: group.conversationKey,
    limit: 20
  }).filter((message) => message.content === "固定群提醒").length, 1);

  const secondTask = db.createGroupAutomationTask({
    botId,
    groupId: group.id,
    name: "第二个任务",
    taskType: "conditional_push",
    cadence: "weekly",
    scheduleDays: [5],
    timeOfDay: "20:00",
    conditionText: "是否完成",
    content: "第二次提醒",
    summaryTemplate: "",
    mentionRoleIds: [],
    enabled: true,
    nextRunAt: "2026-08-07T12:00:00.000Z"
  });
  assert.ok(secondTask.id);
  const second = prepareSendingOccurrence("unknown-worker", "2026-08-07T12:00:00.000Z");
  const unknown = db.markGroupAutomationSendUnknown({
    occurrenceId: second.occurrenceId,
    owner: second.owner,
    transportReference: "transport-unknown",
    error: "timeout",
    now: "2026-08-07T12:00:01.000Z"
  });
  assert.equal(unknown.stage, "delivery_unknown");
  const retry = db.prepareManualGroupAutomationRetry({
    botId,
    occurrenceId: second.occurrenceId,
    operatorId: "operator-1",
    now: "2026-08-07T12:01:00.000Z"
  });
  assert.equal(retry.stage, "send_pending");
  assert.deepEqual(db.prepareManualGroupAutomationRetry({
    botId,
    occurrenceId: second.occurrenceId,
    operatorId: "operator-1",
    now: "2026-08-07T12:01:01.000Z"
  }), retry);
});

test("expired preparatory leases are reclaimable but an unfinished same-task occurrence stays serial", () => {
  const botId = "group_automation_prepare_reclaim_bot";
  const { group } = createGroupWithRoles(botId);
  const task = createWeeklyTask({ botId, groupId: group.id });
  const first = db.claimPreparatoryGroupAutomationOccurrences({
    owner: "prepare-worker-a",
    now: "2026-08-05T11:50:00.000Z",
    prepareBeforeMs: 600_000,
    leaseMs: 1_000,
    limit: 1
  })[0];
  assert.deepEqual(db.claimPreparatoryGroupAutomationOccurrences({
    owner: "prepare-worker-b",
    now: "2026-08-05T11:50:00.500Z",
    prepareBeforeMs: 600_000,
    leaseMs: 1_000,
    limit: 1
  }), []);
  const reclaimed = db.claimPreparatoryGroupAutomationOccurrences({
    owner: "prepare-worker-b",
    now: "2026-08-05T11:50:01.000Z",
    prepareBeforeMs: 600_000,
    leaseMs: 1_000,
    limit: 1
  })[0];
  assert.equal(reclaimed.id, first.id);
  assert.equal(reclaimed.leaseOwner, "prepare-worker-b");
  assert.equal(reclaimed.stageAttempts, 2);
  db.transitionGroupAutomationOccurrence({
    occurrenceId: reclaimed.id,
    owner: "prepare-worker-b",
    fromStages: ["preanalysis"],
    toStage: "waiting_target",
    now: "2026-08-05T11:50:02.000Z"
  });
  const fridayClaims = db.claimPreparatoryGroupAutomationOccurrences({
    owner: "prepare-worker-c",
    now: "2026-08-07T11:50:00.000Z",
    prepareBeforeMs: 600_000,
    leaseMs: 1_000,
    limit: 100
  });
  assert.equal(fridayClaims.some((item) => item.taskId === task.id), false);
});

test("legacy conditional tasks without a condition are disabled with an explicit validation reason", () => {
  const botId = "group_automation_legacy_condition_bot";
  const { group } = createGroupWithRoles(botId);
  const taskId = "legacy-empty-condition-task";
  const timestamp = "2026-08-05T00:00:00.000Z";
  const sqlite = new DatabaseSync(path.join(dataDir, "worktool-bot-service.sqlite"));
  sqlite.prepare(`
    INSERT INTO managed_group_automation_tasks (
      id, bot_id, group_id, name, task_type, cadence, schedule_days_json,
      time_of_day, condition_text, content, summary_template, enabled,
      next_run_at, version, deleted_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'conditional_push', 'daily', '[]', '09:00', '', ?, '', 1,
      ?, 1, NULL, ?, ?)
  `).run(
    taskId,
    botId,
    group.id,
    "旧条件任务",
    "提醒内容",
    "2026-08-06T01:00:00.000Z",
    timestamp,
    timestamp
  );
  sqlite.close();

  assert.equal(db.disableLegacyConditionalTasksWithoutCondition(), 1);
  const task = db.getGroupAutomationTask({ botId, taskId });
  assert.equal(task.enabled, false);
  assert.equal(task.nextRunAt, "");
  assert.equal(task.validationReason, "needs_condition");
  assert.equal(db.disableLegacyConditionalTasksWithoutCondition(), 0);
});

test("legacy ledger cleanup is readiness-gated, transactional, and idempotent", () => {
  const sqlite = new DatabaseSync(path.join(dataDir, "worktool-bot-service.sqlite"));
  const legacyTables = [
    "managed_group_facts",
    "managed_group_fact_aggregates",
    "managed_group_fact_evidence",
    "managed_group_fact_revisions",
    "managed_group_ledger_states",
    "managed_group_ledger_jobs",
    "managed_group_automation_cycle_states"
  ];
  for (const legacyTable of legacyTables) {
    sqlite.exec(`CREATE TABLE ${legacyTable} (id TEXT)`);
  }
  const tableNames = () => sqlite.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `).all().map((row) => row.name);
  assert.equal(tableNames().includes("managed_group_facts"), true);

  assert.deepEqual(db.finalizeLegacyGroupLedgerRemoval({
    capabilityReady: false,
    allManagedGroupsBackfilled: true
  }), { removed: false, reason: "history_not_ready" });
  assert.deepEqual(db.finalizeLegacyGroupLedgerRemoval({
    capabilityReady: true,
    allManagedGroupsBackfilled: false
  }), { removed: false, reason: "history_not_ready" });
  assert.equal(tableNames().includes("managed_group_facts"), true);

  assert.deepEqual(db.finalizeLegacyGroupLedgerRemoval({
    capabilityReady: true,
    allManagedGroupsBackfilled: true
  }), { removed: true, reason: "removed" });
  const remaining = tableNames();
  for (const legacyTable of legacyTables) {
    assert.equal(remaining.includes(legacyTable), false, legacyTable);
  }
  assert.equal(remaining.includes("managed_group_automation_tasks"), true);
  assert.equal(remaining.includes("managed_group_automation_occurrences"), true);
  assert.deepEqual(db.finalizeLegacyGroupLedgerRemoval({
    capabilityReady: true,
    allManagedGroupsBackfilled: true
  }), { removed: false, reason: "already_removed" });
  sqlite.close();
});
