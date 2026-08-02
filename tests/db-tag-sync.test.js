import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-tag-sync-db-test-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");
const sqlite = new DatabaseSync(path.join(dataDir, "worktool-bot-service.sqlite"));

function ensureBot(botId) {
  const agentId = `${botId}_agent`;
  db.upsertAgent({
    agentId,
    agentName: `${botId} Agent`,
    dclawBaseUrl: "https://dclaw.example.com",
    dclawPublicId: agentId,
    enabled: true
  });
  db.upsertBotBinding({ botId, botName: botId, agentId, enabled: true });
  return agentId;
}

function ensureConversation({ botId, agentId, targetName, roomType = 2 }) {
  const kind = [2, 4].includes(roomType) ? "private" : "group";
  const conversationKey = `${botId}:${kind}:${targetName}`;
  db.upsertConversation({
    botId,
    agentId,
    conversationKey,
    message: {
      roomType,
      receivedName: targetName,
      groupName: kind === "group" ? targetName : ""
    },
    skipFirstSeenDateTag: true
  });
  return conversationKey;
}

function outboxRows(botId) {
  return sqlite.prepare(`
    SELECT *
    FROM tag_sync_outbox
    WHERE bot_id = ?
    ORDER BY conversation_key, tag_name, id
  `).all(botId);
}

function addNormalTags({ botId, agentId, conversationKey, names, source = "test" }) {
  db.applyConversationTagChanges({
    botId,
    agentId,
    conversationKey,
    nextTags: names.map((name, index) => ({
      groupId: "intent",
      groupName: "意向",
      tagId: `tag_${index + 1}`,
      tagName: name
    })),
    source
  });
}

test("tag sync config defaults on and validates saved night windows", () => {
  const botId = "tag_sync_config_bot";
  ensureBot(botId);

  const defaults = db.getTagSyncConfig(botId);
  assert.deepEqual({
    botId: defaults.botId,
    nightlyEnabled: defaults.nightlyEnabled,
    syncDateTags: defaults.syncDateTags,
    windowStart: defaults.windowStart,
    windowEnd: defaults.windowEnd,
    initialBackfillAt: defaults.initialBackfillAt
  }, {
    botId,
    nightlyEnabled: true,
    syncDateTags: false,
    windowStart: "03:00",
    windowEnd: "06:00",
    initialBackfillAt: ""
  });
  assert.ok(defaults.createdAt);
  assert.ok(defaults.updatedAt);

  const saved = db.saveTagSyncConfig({
    botId,
    config: {
      nightlyEnabled: true,
      syncDateTags: true,
      windowStart: "00:30",
      windowEnd: "04:00"
    }
  });
  assert.equal(saved.nightlyEnabled, true);
  assert.equal(saved.syncDateTags, true);
  assert.equal(saved.windowStart, "00:30");
  assert.equal(saved.windowEnd, "04:00");

  assert.throws(() => db.saveTagSyncConfig({
    botId,
    config: {
      nightlyEnabled: true,
      windowStart: "09:00",
      windowEnd: "12:00"
    }
  }), /night window/i);
});

test("new bots persist an enabled nightly config and enter scheduler enumeration", () => {
  const botId = "tag_sync_new_bot_default_config";
  ensureBot(botId);

  const row = sqlite.prepare(`
    SELECT nightly_enabled, window_start, window_end
    FROM bot_tag_sync_configs
    WHERE bot_id = ?
  `).get(botId);
  assert.equal(row.nightly_enabled, 1);
  assert.equal(row.window_start, "03:00");
  assert.equal(row.window_end, "06:00");
  assert.ok(db.listRunnableTagSyncConfigs().some((config) => config.botId === botId));
});

test("legacy default-off tag sync configs migrate once and preserve later opt-out", () => {
  const missingConfigBotId = "tag_sync_missing_config_migration_bot";
  const botId = "tag_sync_default_enabled_migration_bot";
  ensureBot(missingConfigBotId);
  ensureBot(botId);
  sqlite.prepare("DELETE FROM bot_tag_sync_configs WHERE bot_id = ?")
    .run(missingConfigBotId);
  db.saveTagSyncConfig({
    botId,
    config: { nightlyEnabled: false, windowStart: "03:00", windowEnd: "06:00" }
  });

  assert.equal(db.migrateTagSyncNightlyDefaultEnabled(), 2);
  assert.equal(db.getTagSyncConfig(missingConfigBotId).nightlyEnabled, true);
  assert.equal(db.getTagSyncConfig(botId).nightlyEnabled, true);

  db.saveTagSyncConfig({
    botId,
    config: { nightlyEnabled: false, windowStart: "03:00", windowEnd: "06:00" }
  });
  assert.equal(db.migrateTagSyncNightlyDefaultEnabled(), 0);
  assert.equal(db.getTagSyncConfig(botId).nightlyEnabled, false);
});

test("initial backfill excludes date and group tags by default", () => {
  const botId = "tag_sync_backfill_bot";
  const agentId = ensureBot(botId);
  const privateKey = ensureConversation({ botId, agentId, targetName: "客户甲" });
  const groupKey = ensureConversation({
    botId,
    agentId,
    targetName: "测试群",
    roomType: 1
  });

  addNormalTags({ botId, agentId, conversationKey: privateKey, names: ["A类", "VIP"] });
  db.upsertSystemDateTag({
    botId,
    agentId,
    conversationKey: privateKey,
    dateTagId: "20260801"
  });
  addNormalTags({ botId, agentId, conversationKey: groupKey, names: ["群标签"] });

  const first = db.ensureTagSyncInitialBackfill({ botId });
  const second = db.ensureTagSyncInitialBackfill({ botId });

  assert.equal(first.insertedCount, 2);
  assert.equal(second.insertedCount, 0);
  assert.ok(first.initialBackfillAt);
  assert.deepEqual(
    outboxRows(botId).map((row) => row.tag_name).sort(),
    ["A类", "VIP"]
  );
});

test("initialized Bots exclude date tag additions by default", () => {
  const botId = "tag_sync_registration_bot";
  const agentId = ensureBot(botId);
  const conversationKey = ensureConversation({ botId, agentId, targetName: "客户乙" });
  db.ensureTagSyncInitialBackfill({ botId });

  db.applyAgentTagOutcome({
    botId,
    agentId,
    conversationKey,
    accepted: [{ action: "add", groupId: "intent", tagId: "a" }],
    nextTags: [{
      groupId: "intent",
      groupName: "意向",
      tagId: "a",
      tagName: "A类"
    }]
  });
  addNormalTags({
    botId,
    agentId,
    conversationKey,
    names: ["A类", "VIP"],
    source: "manual"
  });
  db.upsertSystemDateTag({
    botId,
    agentId,
    conversationKey,
    dateTagId: "20260801"
  });
  addNormalTags({
    botId,
    agentId,
    conversationKey,
    names: ["VIP"],
    source: "manual"
  });
  addNormalTags({
    botId,
    agentId,
    conversationKey,
    names: ["A类", "VIP"],
    source: "manual"
  });

  assert.deepEqual(
    outboxRows(botId).map((row) => row.tag_name).sort(),
    ["A类", "VIP"]
  );
});

test("enabling date tag sync backfills current dates and disabling removes only unsent dates", () => {
  const botId = "tag_sync_date_policy_bot";
  const agentId = ensureBot(botId);
  const conversations = ["待同步", "失败", "处理中", "已同步"].map((targetName) => ({
    targetName,
    conversationKey: ensureConversation({ botId, agentId, targetName })
  }));

  for (const [index, item] of conversations.entries()) {
    db.upsertSystemDateTag({
      botId,
      agentId,
      conversationKey: item.conversationKey,
      dateTagId: `2026080${index + 1}`
    });
  }
  db.ensureTagSyncInitialBackfill({ botId });
  assert.equal(outboxRows(botId).length, 0);

  const enabled = db.saveTagSyncConfig({
    botId,
    config: {
      nightlyEnabled: true,
      syncDateTags: true,
      windowStart: "03:00",
      windowEnd: "06:00"
    }
  });
  assert.equal(enabled.syncDateTags, true);
  assert.deepEqual(
    outboxRows(botId)
      .map((row) => [row.tag_name, row.tag_type])
      .sort(([left], [right]) => left.localeCompare(right)),
    [
      ["20260801", "date"],
      ["20260802", "date"],
      ["20260803", "date"],
      ["20260804", "date"]
    ]
  );

  sqlite.prepare(`UPDATE tag_sync_outbox SET status = 'failed' WHERE tag_name = '20260802'`).run();
  sqlite.prepare(`
    UPDATE tag_sync_outbox
    SET status = 'processing', lease_expires_at = '2026-08-01T16:00:00.000Z'
    WHERE tag_name = '20260803'
  `).run();
  sqlite.prepare(`UPDATE tag_sync_outbox SET status = 'succeeded' WHERE tag_name = '20260804'`).run();

  const disabled = db.saveTagSyncConfig({
    botId,
    config: {
      nightlyEnabled: true,
      syncDateTags: false,
      windowStart: "03:00",
      windowEnd: "06:00"
    }
  });
  assert.equal(disabled.syncDateTags, false);
  assert.deepEqual(
    outboxRows(botId)
      .map((row) => [row.tag_name, row.status])
      .sort(([left], [right]) => left.localeCompare(right)),
    [["20260803", "processing"], ["20260804", "succeeded"]]
  );

  assert.equal(db.recoverExpiredTagSyncLeases({
    nowIso: "2026-08-01T16:01:00.000Z",
    nextRetryAt: "2026-08-01T16:01:30.000Z"
  }), 1);
  assert.deepEqual(
    outboxRows(botId).map((row) => [row.tag_name, row.status]),
    [["20260804", "succeeded"]]
  );
});

test("claim groups five tags for one customer and waits for its callback", () => {
  const botId = "tag_sync_claim_bot";
  const agentId = ensureBot(botId);
  const conversationKey = ensureConversation({ botId, agentId, targetName: "客户丙" });
  addNormalTags({
    botId,
    agentId,
    conversationKey,
    names: ["一", "二", "三", "四", "五", "六"]
  });
  const run = db.startTagSyncRun({
    botId,
    triggerType: "manual",
    startedAt: "2026-08-01T16:00:00.000Z"
  });

  const batch = db.claimNextTagSyncBatch({
    botId,
    runId: run.id,
    nowIso: "2026-08-01T16:00:00.000Z",
    leaseExpiresAt: "2026-08-01T16:02:00.000Z",
    limit: 5
  });
  assert.equal(batch.targetName, "客户丙");
  assert.equal(batch.rows.length, 5);
  assert.equal(db.claimNextTagSyncBatch({
    botId,
    runId: run.id,
    nowIso: "2026-08-01T16:00:01.000Z",
    leaseExpiresAt: "2026-08-01T16:02:01.000Z",
    limit: 5
  }), null);

  db.markTagSyncCommandSubmitted({
    botId,
    outboxIds: batch.rows.map((row) => row.id),
    worktoolMessageId: "wt-tags-1"
  });
  assert.deepEqual(db.getSubmittedTagSyncCommand({
    botId,
    worktoolMessageId: "wt-tags-1"
  }), {
    botId,
    worktoolMessageId: "wt-tags-1",
    conversationKey,
    targetName: "客户丙",
    attemptNumber: 1
  });
  const resolved = db.resolveTagSyncCommandCallback({
    botId,
    worktoolMessageId: "wt-tags-1",
    succeeded: true,
    error: "Enterprise WeChat customers cannot be tagged"
  });
  assert.equal(resolved.succeededCount, 5);
  assert.equal(resolved.rows[0].lastError, "Enterprise WeChat customers cannot be tagged");
  assert.equal(resolved.rows[0].nextRetryAt, "");

  const nextBatch = db.claimNextTagSyncBatch({
    botId,
    runId: run.id,
    nowIso: "2026-08-01T16:00:02.000Z",
    leaseExpiresAt: "2026-08-01T16:02:02.000Z",
    limit: 5
  });
  assert.equal(nextBatch.rows.length, 1);
});

test("runnable configs include active manual runs while nightly automation is off", () => {
  const botId = "tag_sync_manual_runnable_bot";
  ensureBot(botId);
  db.saveTagSyncConfig({
    botId,
    config: {
      nightlyEnabled: false,
      windowStart: "03:00",
      windowEnd: "06:00"
    }
  });
  db.startTagSyncRun({ botId, triggerType: "manual" });

  assert.equal(db.getTagSyncConfig(botId).nightlyEnabled, false);
  assert.ok(db.listRunnableTagSyncConfigs().some((config) => config.botId === botId));
});

test("scheduled runs execute only once for the same Beijing night window", () => {
  const botId = "tag_sync_once_per_window_bot";
  ensureBot(botId);
  const first = db.startTagSyncRun({
    botId,
    triggerType: "scheduled",
    windowKey: "2026-08-01",
    startedAt: "2026-08-01T19:00:00.000Z"
  });
  db.updateTagSyncRunStatus({ runId: first.id, status: "completed" });

  const duplicate = db.startTagSyncRun({
    botId,
    triggerType: "scheduled",
    windowKey: "2026-08-01",
    startedAt: "2026-08-01T19:05:00.000Z"
  });

  assert.equal(duplicate, null);
  assert.equal(sqlite.prepare(`
    SELECT COUNT(*) AS count
    FROM tag_sync_runs
    WHERE bot_id = ? AND trigger_type = 'scheduled' AND window_key = ?
  `).get(botId, "2026-08-01").count, 1);
});

test("failed callbacks and expired leases stay durable and retryable", () => {
  const botId = "tag_sync_retry_bot";
  const agentId = ensureBot(botId);
  const conversationKey = ensureConversation({ botId, agentId, targetName: "客户丁" });
  addNormalTags({ botId, agentId, conversationKey, names: ["VIP", "付费"] });
  const run = db.startTagSyncRun({
    botId,
    triggerType: "manual",
    startedAt: "2026-08-01T16:00:00.000Z"
  });
  const batch = db.claimNextTagSyncBatch({
    botId,
    runId: run.id,
    nowIso: "2026-08-01T16:00:00.000Z",
    leaseExpiresAt: "2026-08-01T16:01:00.000Z",
    limit: 1
  });
  db.markTagSyncCommandSubmitted({
    botId,
    outboxIds: batch.rows.map((row) => row.id),
    worktoolMessageId: "wt-tags-failed"
  });
  const failed = db.resolveTagSyncCommandCallback({
    botId,
    worktoolMessageId: "wt-tags-failed",
    succeeded: false,
    error: "客户端失败",
    nextRetryAt: "2026-08-01T16:01:30.000Z"
  });
  assert.equal(failed.failedCount, 1);

  const leased = db.claimNextTagSyncBatch({
    botId,
    runId: run.id,
    nowIso: "2026-08-01T16:00:01.000Z",
    leaseExpiresAt: "2026-08-01T16:01:01.000Z",
    limit: 1
  });
  assert.equal(leased.rows.length, 1);
  const recovered = db.recoverExpiredTagSyncLeases({
    nowIso: "2026-08-01T16:02:00.000Z",
    nextRetryAt: "2026-08-01T16:02:30.000Z"
  });
  assert.equal(recovered, 1);
  assert.equal(
    outboxRows(botId).filter((row) => row.status === "failed").length,
    2
  );
});

test("message processing activity is isolated by Bot", () => {
  const botId = "tag_sync_activity_bot";
  ensureBot(botId);
  db.beginMessageProcessing({
    messageKey: "tag-sync-incoming-1",
    botId,
    conversationKey: `${botId}:private:客户甲`,
    messageId: "m-1"
  });

  assert.equal(db.hasRecentBotMessageProcessing({
    botId,
    sinceIso: "2000-01-01T00:00:00.000Z"
  }), true);
  assert.equal(db.hasRecentBotMessageProcessing({
    botId: "tag_sync_other_bot",
    sinceIso: "2000-01-01T00:00:00.000Z"
  }), false);

  db.finishMessageProcessing({
    messageKey: "tag-sync-incoming-1",
    status: "completed"
  });
  assert.equal(db.hasRecentBotMessageProcessing({
    botId,
    sinceIso: "2000-01-01T00:00:00.000Z"
  }), false);
});

test("deleting a conversation removes only its pending tag sync Outbox", () => {
  const botId = "tag_sync_delete_conversation_bot";
  const agentId = ensureBot(botId);
  const deletedKey = ensureConversation({ botId, agentId, targetName: "待删除客户" });
  const keptKey = ensureConversation({ botId, agentId, targetName: "保留客户" });
  addNormalTags({ botId, agentId, conversationKey: deletedKey, names: ["A类"] });
  addNormalTags({ botId, agentId, conversationKey: keptKey, names: ["VIP"] });
  db.ensureTagSyncInitialBackfill({ botId });

  db.clearConversationForReset({ botId, conversationKey: deletedKey });

  assert.equal(sqlite.prepare(`
    SELECT COUNT(*) AS count FROM tag_sync_outbox
    WHERE bot_id = ? AND conversation_key = ?
  `).get(botId, deletedKey).count, 0);
  assert.equal(sqlite.prepare(`
    SELECT COUNT(*) AS count FROM tag_sync_outbox
    WHERE bot_id = ? AND conversation_key = ?
  `).get(botId, keptKey).count, 1);
});

test("deleting a Bot removes its tag sync config runs and Outbox only", () => {
  const deletedBotId = "tag_sync_delete_bot";
  const keptBotId = "tag_sync_keep_bot";
  for (const botId of [deletedBotId, keptBotId]) {
    const agentId = ensureBot(botId);
    const conversationKey = ensureConversation({ botId, agentId, targetName: `${botId}客户` });
    addNormalTags({ botId, agentId, conversationKey, names: ["VIP"] });
    db.saveTagSyncConfig({
      botId,
      config: { nightlyEnabled: true, windowStart: "03:00", windowEnd: "06:00" }
    });
    db.startTagSyncRun({ botId, triggerType: "manual" });
  }

  db.deleteBotData(deletedBotId);

  for (const table of ["bot_tag_sync_configs", "tag_sync_runs", "tag_sync_outbox"]) {
    assert.equal(
      sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE bot_id = ?`)
        .get(deletedBotId).count,
      0
    );
    assert.ok(
      sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE bot_id = ?`)
        .get(keptBotId).count > 0
    );
  }
});
