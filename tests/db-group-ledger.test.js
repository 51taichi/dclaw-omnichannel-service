import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-group-ledger-db-test-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");

function setupLedgerGroup(botId) {
  const group = db.createOrGetGroup({
    botId,
    currentName: `${botId}学习群`,
    source: "callback"
  });
  const saved = db.saveGroupRoles({
    botId,
    groupId: group.id,
    expectedVersion: group.version,
    roles: [{
      currentName: "家长",
      identityType: "customer",
      description: "学生家长",
      replyPolicy: "never"
    }]
  });
  const task = db.createGroupAutomationTask({
    botId,
    groupId: group.id,
    name: "每日作业检查",
    taskType: "conditional_push",
    cadence: "daily",
    scheduleDays: [],
    timeOfDay: "21:00",
    conditionText: "客户今天已经提交作业",
    content: "作业已收到",
    mentionRoleIds: [saved.roles[0].id],
    enabled: true,
    nextRunAt: "2026-08-04T13:00:00.000Z"
  });
  return { group: saved.group, parentRole: saved.roles[0], task };
}

function applySingleLedgerFact({ botId, group, roleId, semanticKey, category = "lesson_completed" }) {
  const message = db.insertConversationMessage({
    botId,
    conversationKey: group.conversationKey,
    direction: "inbound",
    senderName: "家长",
    content: `${semanticKey} 已完成`
  });
  db.enqueueGroupLedgerJob({
    botId,
    groupId: group.id,
    mode: "live",
    throughMessageId: message.id
  });
  const job = db.claimGroupLedgerJobs({
    nowIso: "2026-08-04T12:00:00.000Z",
    limit: 1,
    leaseMs: 300000
  })[0];
  db.applyGroupLedgerEvaluation({
    jobId: job.id,
    botId,
    groupId: group.id,
    throughMessageId: message.id,
    facts: [{
      operation: "upsert",
      semanticKey,
      category,
      statement: `${semanticKey} 已完成`,
      value: { count: 1 },
      happenedAt: "2026-08-03T10:00:00.000Z",
      speakerName: "家长",
      roleId,
      evidenceMessageIds: [message.id]
    }],
    conditionStates: []
  });
  return message;
}

test("coalesces live jobs and atomically applies facts, evidence, cursor, and condition state", () => {
  const botId = "ledger_apply_bot";
  const { group, parentRole, task } = setupLedgerGroup(botId);
  const message1 = db.insertConversationMessage({
    botId,
    conversationKey: group.conversationKey,
    direction: "inbound",
    senderName: "家长",
    content: "老师好"
  });
  const message2 = db.insertConversationMessage({
    botId,
    conversationKey: group.conversationKey,
    direction: "inbound",
    senderName: "家长",
    content: "数学作业已经提交"
  });
  const message3 = db.insertConversationMessage({
    botId,
    conversationKey: group.conversationKey,
    direction: "inbound",
    senderName: "家长",
    content: "请查收"
  });

  db.enqueueGroupLedgerJob({
    botId,
    groupId: group.id,
    mode: "live",
    throughMessageId: message2.id
  });
  db.enqueueGroupLedgerJob({
    botId,
    groupId: group.id,
    mode: "live",
    throughMessageId: message3.id
  });
  const jobs = db.claimGroupLedgerJobs({
    nowIso: "2026-08-04T12:00:00.000Z",
    limit: 10,
    leaseMs: 300000
  });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].throughMessageId, message3.id);

  db.applyGroupLedgerEvaluation({
    jobId: jobs[0].id,
    botId,
    groupId: group.id,
    throughMessageId: message3.id,
    facts: [{
      operation: "upsert",
      semanticKey: "homework:student-a:2026-08-04",
      category: "homework_submission",
      statement: "已提交数学作业",
      value: { subject: "student-a", submitted: true },
      happenedAt: "2026-08-04T11:30:00.000Z",
      speakerName: "家长",
      roleId: parentRole.id,
      evidenceMessageIds: [message2.id]
    }],
    conditionStates: [{
      taskId: task.id,
      cycleKey: "2026-08-04",
      achieved: true,
      reason: "家长明确表示已提交",
      supportingFactKeys: ["homework:student-a:2026-08-04"],
      contradictingFactKeys: []
    }]
  });

  assert.equal(
    db.getGroupLedgerState({ botId, groupId: group.id }).liveCursorMessageId,
    message3.id
  );
  assert.equal(db.getGroupAutomationCycleState({
    botId,
    groupId: group.id,
    taskId: task.id,
    cycleKey: "2026-08-04"
  }).achieved, true);
  const projection = db.listGroupLedgerProjection({ botId, groupId: group.id });
  assert.equal(projection.facts[0].statement, "已提交数学作业");
  assert.deepEqual(projection.facts[0].evidenceMessageIds, [message2.id]);
  assert.equal(parentRole.replyPolicy, "never", "ledger evidence ignores reply policy");
});

test("a newer correction retracts a fact and can flip the same task cycle", () => {
  const botId = "ledger_correction_bot";
  const { group, parentRole, task } = setupLedgerGroup(botId);
  const submitted = db.insertConversationMessage({
    botId,
    conversationKey: group.conversationKey,
    direction: "inbound",
    senderName: "家长",
    content: "作业交了"
  });
  const corrected = db.insertConversationMessage({
    botId,
    conversationKey: group.conversationKey,
    direction: "inbound",
    senderName: "家长",
    content: "刚才说错了，还没有提交"
  });
  const firstJob = db.enqueueGroupLedgerJob({
    botId,
    groupId: group.id,
    mode: "live",
    throughMessageId: submitted.id
  });
  const firstClaim = db.claimGroupLedgerJobs({
    nowIso: "2026-08-04T12:00:00.000Z",
    limit: 1,
    leaseMs: 300000
  })[0];
  db.applyGroupLedgerEvaluation({
    jobId: firstClaim.id,
    botId,
    groupId: group.id,
    throughMessageId: submitted.id,
    facts: [{
      operation: "upsert",
      semanticKey: "homework:2026-08-04",
      category: "homework_submission",
      statement: "已提交作业",
      value: { submitted: true },
      happenedAt: "2026-08-04T10:00:00.000Z",
      speakerName: "家长",
      roleId: parentRole.id,
      evidenceMessageIds: [submitted.id]
    }],
    conditionStates: [{
      taskId: task.id,
      cycleKey: "2026-08-04",
      achieved: true,
      reason: "已提交",
      supportingFactKeys: ["homework:2026-08-04"],
      contradictingFactKeys: []
    }]
  });
  assert.equal(firstJob.mode, "live");

  db.enqueueGroupLedgerJob({
    botId,
    groupId: group.id,
    mode: "live",
    throughMessageId: corrected.id
  });
  const correctionJob = db.claimGroupLedgerJobs({
    nowIso: "2026-08-04T12:10:00.000Z",
    limit: 1,
    leaseMs: 300000
  })[0];
  db.applyGroupLedgerEvaluation({
    jobId: correctionJob.id,
    botId,
    groupId: group.id,
    throughMessageId: corrected.id,
    facts: [{
      operation: "retract",
      semanticKey: "homework:2026-08-04",
      evidenceMessageIds: [corrected.id]
    }],
    conditionStates: [{
      taskId: task.id,
      cycleKey: "2026-08-04",
      achieved: false,
      reason: "家长纠正为尚未提交",
      supportingFactKeys: [],
      contradictingFactKeys: ["homework:2026-08-04"]
    }]
  });

  const correctedProjection = db.listGroupLedgerProjection({
    botId,
    groupId: group.id,
    includeRetracted: true
  });
  assert.equal(correctedProjection.facts[0].active, false);
  const revisions = db.listGroupFactRevisions({
    botId,
    groupId: group.id,
    factId: correctedProjection.facts[0].id
  });
  assert.deepEqual(revisions.map((revision) => revision.operation), ["upsert", "retract"]);
  assert.equal(revisions[1].correctsRevisionId, revisions[0].id);
  assert.deepEqual(revisions[0].evidenceMessageIds, [submitted.id]);
  assert.deepEqual(revisions[1].evidenceMessageIds, [corrected.id]);
  assert.equal(db.getGroupAutomationCycleState({
    botId,
    groupId: group.id,
    taskId: task.id,
    cycleKey: "2026-08-04"
  }).achieved, false);
});

test("shared fact aggregates roll numeric totals back when historical evidence is retracted", () => {
  const botId = "ledger_aggregate_bot";
  const { group, parentRole } = setupLedgerGroup(botId);
  const first = db.insertConversationMessage({
    botId,
    conversationKey: group.conversationKey,
    direction: "inbound",
    senderName: "家长",
    content: "7月完成了第一节45分钟课程"
  });
  const second = db.insertConversationMessage({
    botId,
    conversationKey: group.conversationKey,
    direction: "inbound",
    senderName: "家长",
    content: "8月完成了第二节45分钟课程"
  });
  db.enqueueGroupLedgerJob({
    botId,
    groupId: group.id,
    mode: "live",
    throughMessageId: second.id
  });
  const initialJob = db.claimGroupLedgerJobs({
    nowIso: "2026-08-04T12:00:00.000Z",
    limit: 1,
    leaseMs: 300000
  })[0];
  db.applyGroupLedgerEvaluation({
    jobId: initialJob.id,
    botId,
    groupId: group.id,
    throughMessageId: second.id,
    facts: [
      {
        operation: "upsert",
        semanticKey: "lesson:2026-07:1",
        category: "lesson_completed",
        statement: "7月完成第一节课程",
        value: { count: 1, durationMinutes: 45 },
        happenedAt: "2026-07-10T10:00:00.000Z",
        speakerName: "家长",
        roleId: parentRole.id,
        evidenceMessageIds: [first.id]
      },
      {
        operation: "upsert",
        semanticKey: "lesson:2026-08:1",
        category: "lesson_completed",
        statement: "8月完成第二节课程",
        value: { count: 1, durationMinutes: 45 },
        happenedAt: "2026-08-03T10:00:00.000Z",
        speakerName: "家长",
        roleId: parentRole.id,
        evidenceMessageIds: [second.id]
      }
    ],
    conditionStates: []
  });

  assert.deepEqual(
    db.listGroupLedgerProjection({ botId, groupId: group.id }).aggregates.lesson_completed,
    {
      factCount: 2,
      numericSums: { count: 2, durationMinutes: 90 },
      firstHappenedAt: "2026-07-10T10:00:00.000Z",
      lastHappenedAt: "2026-08-03T10:00:00.000Z",
      evidenceFactKeys: ["lesson:2026-07:1", "lesson:2026-08:1"],
      evidenceMessageIds: [first.id, second.id]
    }
  );

  const correction = db.insertConversationMessage({
    botId,
    conversationKey: group.conversationKey,
    direction: "inbound",
    senderName: "家长",
    content: "更正：8月那节课取消了"
  });
  db.enqueueGroupLedgerJob({
    botId,
    groupId: group.id,
    mode: "live",
    throughMessageId: correction.id
  });
  const correctionJob = db.claimGroupLedgerJobs({
    nowIso: "2026-08-04T12:10:00.000Z",
    limit: 1,
    leaseMs: 300000
  })[0];
  db.applyGroupLedgerEvaluation({
    jobId: correctionJob.id,
    botId,
    groupId: group.id,
    throughMessageId: correction.id,
    facts: [{
      operation: "retract",
      semanticKey: "lesson:2026-08:1",
      evidenceMessageIds: [correction.id]
    }],
    conditionStates: []
  });

  assert.deepEqual(
    db.listGroupLedgerProjection({ botId, groupId: group.id }).aggregates.lesson_completed,
    {
      factCount: 1,
      numericSums: { count: 1, durationMinutes: 45 },
      firstHappenedAt: "2026-07-10T10:00:00.000Z",
      lastHappenedAt: "2026-07-10T10:00:00.000Z",
      evidenceFactKeys: ["lesson:2026-07:1"],
      evidenceMessageIds: [first.id]
    }
  );
});

test("group merge rebuilds aggregates from the deduplicated target fact ledger", () => {
  const botId = "ledger_aggregate_merge_bot";
  const { group: source, parentRole } = setupLedgerGroup(botId);
  const target = db.createOrGetGroup({
    botId,
    currentName: "合并后的正式群",
    source: "callback"
  });
  applySingleLedgerFact({
    botId,
    group: source,
    roleId: parentRole.id,
    semanticKey: "lesson:merge:1"
  });

  db.mergeGroupAlias({ botId, sourceGroupId: source.id, targetGroupId: target.id });

  assert.equal(
    db.listGroupLedgerProjection({ botId, groupId: target.id })
      .aggregates.lesson_completed.factCount,
    1
  );
});

test("deleting a Bot removes its durable group fact aggregates", () => {
  const botId = "ledger_aggregate_delete_bot";
  db.upsertBotBinding({
    botId,
    botName: "待删除聚合 Bot",
    agentId: "ledger-aggregate-delete-agent",
    enabled: true
  });
  const { group, parentRole } = setupLedgerGroup(botId);
  applySingleLedgerFact({
    botId,
    group,
    roleId: parentRole.id,
    semanticKey: "lesson:delete:1"
  });

  const result = db.deleteBotData(botId);

  assert.equal(result.deleted.managed_group_fact_aggregates, 1);
});

test("rejects outbound or cross-group evidence without partially advancing the ledger", () => {
  const botId = "ledger_evidence_bot";
  const { group, parentRole } = setupLedgerGroup(botId);
  const outbound = db.insertConversationMessage({
    botId,
    conversationKey: group.conversationKey,
    direction: "outbound",
    senderName: "Bot",
    content: "自动提醒"
  });
  db.enqueueGroupLedgerJob({
    botId,
    groupId: group.id,
    mode: "live",
    throughMessageId: outbound.id
  });
  const job = db.claimGroupLedgerJobs({
    nowIso: "2026-08-04T12:00:00.000Z",
    limit: 1,
    leaseMs: 300000
  })[0];

  assert.throws(() => db.applyGroupLedgerEvaluation({
    jobId: job.id,
    botId,
    groupId: group.id,
    throughMessageId: outbound.id,
    facts: [{
      operation: "upsert",
      semanticKey: "bot:fake",
      category: "homework_submission",
      statement: "Bot 自己说已提交",
      value: { submitted: true },
      happenedAt: "2026-08-04T10:00:00.000Z",
      speakerName: "Bot",
      roleId: parentRole.id,
      evidenceMessageIds: [outbound.id]
    }],
    conditionStates: []
  }), /inbound group message/);
  assert.equal(db.getGroupLedgerState({
    botId,
    groupId: group.id
  }).liveCursorMessageId, 0);
  assert.deepEqual(db.listGroupLedgerProjection({ botId, groupId: group.id }).facts, []);
});

test("rejects an achieved condition without an active supporting fact and evidence", () => {
  const botId = "ledger_unsupported_achievement_bot";
  const { group, task } = setupLedgerGroup(botId);
  const message = db.insertConversationMessage({
    botId,
    conversationKey: group.conversationKey,
    direction: "inbound",
    senderName: "家长",
    content: "今天聊一下作业"
  });
  db.enqueueGroupLedgerJob({
    botId,
    groupId: group.id,
    mode: "live",
    throughMessageId: message.id
  });
  const job = db.claimGroupLedgerJobs({
    nowIso: "2026-08-04T12:00:00.000Z",
    limit: 1,
    leaseMs: 300000
  })[0];

  assert.throws(() => db.applyGroupLedgerEvaluation({
    jobId: job.id,
    botId,
    groupId: group.id,
    throughMessageId: message.id,
    facts: [],
    conditionStates: [{
      taskId: task.id,
      cycleKey: "2026-08-04",
      achieved: true,
      reason: "Agent 猜测已完成",
      supportingFactKeys: [],
      contradictingFactKeys: []
    }]
  }), /supporting fact/);
  assert.equal(db.getGroupLedgerState({ botId, groupId: group.id }).liveCursorMessageId, 0);
});

test("keeps one live cursor and independent per-task backfill cursors", () => {
  const botId = "ledger_cursor_bot";
  const { group, task } = setupLedgerGroup(botId);
  const message = db.insertConversationMessage({
    botId,
    conversationKey: group.conversationKey,
    direction: "inbound",
    senderName: "家长",
    content: "历史记录"
  });
  db.enqueueGroupLedgerJob({
    botId,
    groupId: group.id,
    taskId: task.id,
    mode: "backfill",
    throughMessageId: message.id
  });
  const job = db.claimGroupLedgerJobs({
    nowIso: "2026-08-04T12:00:00.000Z",
    limit: 1,
    leaseMs: 300000
  })[0];
  db.applyGroupLedgerEvaluation({
    jobId: job.id,
    botId,
    groupId: group.id,
    throughMessageId: message.id,
    facts: [],
    conditionStates: []
  });

  const state = db.getGroupLedgerState({ botId, groupId: group.id });
  assert.equal(state.liveCursorMessageId, 0);
  assert.equal(state.backfillCursors[task.id], message.id);
});

test("ledger message batches contain only bounded inbound rows from the managed group", () => {
  const botId = "ledger_message_batch_bot";
  const { group } = setupLedgerGroup(botId);
  const first = db.insertConversationMessage({
    botId,
    conversationKey: group.conversationKey,
    direction: "inbound",
    senderName: "家长",
    content: "第一条"
  });
  db.insertConversationMessage({
    botId,
    conversationKey: group.conversationKey,
    direction: "outbound",
    senderName: "Bot",
    content: "自动回复"
  });
  const last = db.insertConversationMessage({
    botId,
    conversationKey: group.conversationKey,
    direction: "inbound",
    senderName: "家长",
    content: "第二条"
  });

  assert.deepEqual(db.listInboundGroupMessagesForLedger({
    botId,
    groupId: group.id,
    afterMessageId: 0,
    throughMessageId: last.id,
    limit: 10
  }).map((message) => message.id), [first.id, last.id]);
  assert.equal(db.getLatestInboundGroupMessageId({ botId, groupId: group.id }), last.id);
});

test("terminal ledger failures are not reclaimed after the bounded retry budget", () => {
  const botId = "ledger_terminal_retry_bot";
  const { group } = setupLedgerGroup(botId);
  const message = db.insertConversationMessage({
    botId,
    conversationKey: group.conversationKey,
    direction: "inbound",
    senderName: "家长",
    content: "待分析"
  });
  db.enqueueGroupLedgerJob({
    botId,
    groupId: group.id,
    mode: "live",
    throughMessageId: message.id
  });
  const job = db.claimGroupLedgerJobs({
    nowIso: "2026-08-04T12:00:00.000Z",
    limit: 1,
    leaseMs: 300000
  })[0];
  db.failGroupLedgerJob({
    jobId: job.id,
    botId,
    errorMessage: "重试耗尽",
    terminal: true
  });
  const reclaimed = db.claimGroupLedgerJobs({
    nowIso: "2026-08-05T12:00:00.000Z",
    limit: 100,
    leaseMs: 300000
  });
  assert.equal(reclaimed.some((item) => item.id === job.id), false);
});
