import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-group-history-sync-db-test-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");

function createGroup(botId, name = `${botId}群`) {
  return db.createOrGetGroup({
    botId,
    currentName: name,
    source: "callback",
    discoveredAt: "2026-08-05T00:00:00.000Z"
  });
}

function insertRawMessage({
  botId,
  conversationKey,
  direction = "inbound",
  senderName = "张三",
  content,
  source = "local",
  sourceKey = null,
  createdAt
}) {
  const rawDb = new DatabaseSync(path.join(dataDir, "worktool-bot-service.sqlite"));
  const result = rawDb.prepare(`
    INSERT INTO conversation_messages (
      bot_id, conversation_key, direction, sender_name, content,
      raw_payload_json, source, source_key, created_at
    ) VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?)
  `).run(
    botId,
    conversationKey,
    direction,
    senderName,
    content,
    source,
    sourceKey,
    createdAt
  );
  rawDb.close();
  return Number(result.lastInsertRowid);
}

test("finds the latest local message id at or before a fixed cutoff", () => {
  const botId = "history_cutoff_bot";
  const group = createGroup(botId);
  const before = insertRawMessage({
    botId,
    conversationKey: group.conversationKey,
    content: "截止前",
    createdAt: "2026-08-05T01:00:00.000Z"
  });
  insertRawMessage({
    botId,
    conversationKey: group.conversationKey,
    content: "截止后",
    createdAt: "2026-08-05T03:00:00.000Z"
  });

  assert.equal(db.getLatestGroupConversationMessageIdAtOrBefore({
    botId,
    groupId: group.id,
    until: "2026-08-05T02:00:00.000Z"
  }), before);
  assert.equal(db.getLatestGroupConversationMessageIdAtOrBefore({
    botId,
    groupId: group.id,
    until: "2026-08-05T00:30:00.000Z"
  }), 0);
});

test("canonical export suppresses imported duplicates across source cursor pages", () => {
  const botId = "history_canonical_bot";
  const group = createGroup(botId);
  const localId = insertRawMessage({
    botId,
    conversationKey: group.conversationKey,
    content: "老师 在吗",
    source: "local",
    createdAt: "2026-08-05T01:00:00.000Z"
  });
  const importedId = insertRawMessage({
    botId,
    conversationKey: group.conversationKey,
    content: " 老师   在吗 ",
    source: "worktool_customer_history",
    sourceKey: "history-1",
    createdAt: "2026-08-05T01:00:08.000Z"
  });
  const repeatedLocalId = insertRawMessage({
    botId,
    conversationKey: group.conversationKey,
    content: "老师 在吗",
    source: "local",
    createdAt: "2026-08-05T01:00:09.000Z"
  });

  const first = db.listCanonicalGroupMessagesForHistory({
    botId,
    groupId: group.id,
    afterMessageId: 0,
    throughMessageId: repeatedLocalId,
    limit: 1
  });
  const second = db.listCanonicalGroupMessagesForHistory({
    botId,
    groupId: group.id,
    afterMessageId: first.processedThroughMessageId,
    throughMessageId: repeatedLocalId,
    limit: 1
  });
  const third = db.listCanonicalGroupMessagesForHistory({
    botId,
    groupId: group.id,
    afterMessageId: second.processedThroughMessageId,
    throughMessageId: repeatedLocalId,
    limit: 1
  });

  assert.equal(first.processedThroughMessageId, localId);
  assert.deepEqual(first.messages.map((message) => message.id), [localId]);
  assert.equal(second.processedThroughMessageId, importedId);
  assert.deepEqual(second.messages, []);
  assert.equal(third.processedThroughMessageId, repeatedLocalId);
  assert.deepEqual(third.messages.map((message) => message.id), [repeatedLocalId]);
  assert.equal(third.hasMore, false);
});

test("canonical export does not let a message after the through-id cutoff suppress an earlier row", () => {
  const botId = "history_cutoff_canonical_bot";
  const group = createGroup(botId);
  const importedId = insertRawMessage({
    botId,
    conversationKey: group.conversationKey,
    content: "作业完成了",
    source: "worktool_customer_history",
    sourceKey: "history-before-cutoff",
    createdAt: "2026-08-05T01:00:00.000Z"
  });
  insertRawMessage({
    botId,
    conversationKey: group.conversationKey,
    content: "作业完成了",
    source: "local",
    createdAt: "2026-08-05T01:00:05.000Z"
  });

  const result = db.listCanonicalGroupMessagesForHistory({
    botId,
    groupId: group.id,
    afterMessageId: 0,
    throughMessageId: importedId,
    limit: 10
  });

  assert.deepEqual(result.messages.map((message) => message.id), [importedId]);
  assert.equal(result.processedThroughMessageId, importedId);
  assert.equal(result.hasMore, false);
});

test("sync state claims, heartbeats, advances skipped rows, and releases the lease", () => {
  const botId = "history_state_bot";
  const group = createGroup(botId);
  db.enqueueGroupHistorySync({ botId, groupId: group.id, throughMessageId: 20 });

  const claimed = db.claimGroupHistorySyncJobs({
    owner: "worker-a",
    now: "2026-08-05T01:00:00.000Z",
    leaseMs: 60_000,
    limit: 10
  });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].groupId, group.id);
  assert.equal(claimed[0].requestedThroughMessageId, 20);
  assert.equal(claimed[0].status, "processing");
  assert.deepEqual(db.claimGroupHistorySyncJobs({
    owner: "worker-b",
    now: "2026-08-05T01:00:01.000Z",
    leaseMs: 60_000,
    limit: 10
  }), []);

  const heartbeat = db.heartbeatGroupHistorySyncJob({
    botId,
    groupId: group.id,
    owner: "worker-a",
    now: "2026-08-05T01:00:10.000Z",
    leaseMs: 60_000
  });
  assert.equal(heartbeat.leaseExpiresAt, "2026-08-05T01:01:10.000Z");

  const completed = db.completeGroupHistorySyncBatch({
    botId,
    groupId: group.id,
    owner: "worker-a",
    syncedThroughMessageId: 20,
    now: "2026-08-05T01:00:20.000Z",
    hasMore: false
  });
  assert.equal(completed.status, "idle");
  assert.equal(completed.syncedThroughMessageId, 20);
  assert.equal(completed.leaseOwner, "");
});

test("failed sync jobs retry only after next_retry_at and expired leases recover", () => {
  const botId = "history_retry_bot";
  const group = createGroup(botId);
  db.enqueueGroupHistorySync({ botId, groupId: group.id, throughMessageId: 3 });
  db.claimGroupHistorySyncJobs({
    owner: "worker-a",
    now: "2026-08-05T01:00:00.000Z",
    leaseMs: 10_000,
    limit: 1
  });
  const failed = db.failGroupHistorySyncJob({
    botId,
    groupId: group.id,
    owner: "worker-a",
    error: "DClaw unavailable",
    nextRetryAt: "2026-08-05T01:02:00.000Z",
    now: "2026-08-05T01:00:05.000Z"
  });
  assert.equal(failed.status, "retry_wait");
  assert.equal(failed.attempts, 1);
  assert.deepEqual(db.claimGroupHistorySyncJobs({
    owner: "worker-b",
    now: "2026-08-05T01:01:59.000Z",
    leaseMs: 10_000,
    limit: 1
  }), []);
  assert.equal(db.claimGroupHistorySyncJobs({
    owner: "worker-b",
    now: "2026-08-05T01:02:00.000Z",
    leaseMs: 10_000,
    limit: 1
  }).length, 1);
});

test("history sync state is isolated by bot and source state is removed when groups merge", () => {
  const botId = "history_merge_bot";
  const otherBotId = "history_merge_other_bot";
  const source = createGroup(botId, "待合并群");
  const target = createGroup(botId, "目标群");
  createGroup(otherBotId, "其他 Bot 群");

  const sourceMessageId = insertRawMessage({
    botId,
    conversationKey: source.conversationKey,
    content: "合并前的群消息",
    createdAt: "2026-08-05T01:00:00.000Z"
  });

  db.enqueueGroupHistorySync({
    botId,
    groupId: source.id,
    throughMessageId: sourceMessageId
  });
  assert.throws(
    () => db.getGroupHistorySyncState({ botId: otherBotId, groupId: source.id }),
    /managed group not found/
  );

  db.mergeGroupAlias({ botId, sourceGroupId: source.id, targetGroupId: target.id });

  assert.equal(db.getGroupById({ botId, groupId: source.id }), null);
  const targetState = db.getGroupHistorySyncState({ botId, groupId: target.id });
  assert.equal(targetState.status, "pending");
  assert.equal(targetState.syncedThroughMessageId, 0);
  assert.equal(targetState.requestedThroughMessageId, sourceMessageId);
  const rawDb = new DatabaseSync(path.join(dataDir, "worktool-bot-service.sqlite"));
  const staleState = rawDb.prepare(`
    SELECT COUNT(*) AS count
    FROM managed_group_history_sync_states
    WHERE bot_id = ? AND group_id = ?
  `).get(botId, source.id);
  rawDb.close();
  assert.equal(Number(staleState.count), 0);
});

test("deleting a bot removes its group history sync state", () => {
  const botId = "history_delete_bot";
  db.upsertBotBinding({ botId, agentId: "history-delete-agent" });
  const group = createGroup(botId);
  db.enqueueGroupHistorySync({ botId, groupId: group.id, throughMessageId: 5 });

  const result = db.deleteBotData(botId);

  assert.equal(result.ok, true);
  assert.equal(result.deleted.managed_group_history_sync_states, 1);
});
