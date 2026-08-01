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

test("tag sync config defaults off and validates saved night windows", () => {
  const botId = "tag_sync_config_bot";
  ensureBot(botId);

  assert.deepEqual(db.getTagSyncConfig(botId), {
    botId,
    nightlyEnabled: false,
    windowStart: "03:00",
    windowEnd: "06:00",
    initialBackfillAt: "",
    createdAt: "",
    updatedAt: ""
  });

  const saved = db.saveTagSyncConfig({
    botId,
    config: {
      nightlyEnabled: true,
      windowStart: "23:30",
      windowEnd: "04:00"
    }
  });
  assert.equal(saved.nightlyEnabled, true);
  assert.equal(saved.windowStart, "23:30");
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

test("initial backfill includes every private tag and excludes group tags", () => {
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

  assert.equal(first.insertedCount, 3);
  assert.equal(second.insertedCount, 0);
  assert.ok(first.initialBackfillAt);
  assert.deepEqual(
    outboxRows(botId).map((row) => row.tag_name).sort(),
    ["20260801", "A类", "VIP"]
  );
});

test("initialized Bots register agent manual and date tag additions without duplicates", () => {
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
    ["20260801", "A类", "VIP"]
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
    error: ""
  });
  assert.equal(resolved.succeededCount, 5);

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
  db.startTagSyncRun({ botId, triggerType: "manual" });

  assert.equal(db.getTagSyncConfig(botId).nightlyEnabled, false);
  assert.ok(db.listRunnableTagSyncConfigs().some((config) => config.botId === botId));
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
