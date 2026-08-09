import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omnichannel-attention-alerts-test-"));

const db = await import("../src/db.js");

function seed(botId, conversationKey, content, sourceKey) {
  return db.insertConversationMessage({
    botId,
    conversationKey,
    direction: "inbound",
    senderName: "Ada",
    content,
    source: "whapi",
    sourceKey,
    rawPayload: { messageId: sourceKey }
  });
}

function record({ botId = "attention_bot", conversationKey = `${botId}:private:Ada`, epoch = "epoch-1", message, nowIso }) {
  return db.recordAttentionAlertOccurrence({
    botId,
    agentId: "attention_agent",
    conversationKey,
    conversationEpoch: epoch,
    customerName: "Ada",
    reason: `需要人工确认 ${message.id}`,
    evidenceMessageId: message.id,
    evidenceText: message.content,
    nowIso
  });
}

test("new occurrences merge into one unread attention alert", () => {
  const botId = "attention_merge";
  const conversationKey = `${botId}:private:Ada`;
  const firstMessage = seed(botId, conversationKey, "可以寄到德国吗？", "merge-1");
  const secondMessage = seed(botId, conversationKey, "请再确认一下", "merge-2");
  const first = record({ botId, conversationKey, message: firstMessage, nowIso: "2026-08-09T01:00:00.000Z" });
  const merged = record({ botId, conversationKey, message: secondMessage, nowIso: "2026-08-09T01:01:00.000Z" });

  assert.equal(first.created, true);
  assert.equal(first.duplicate, false);
  assert.equal(merged.created, false);
  assert.equal(merged.duplicate, false);
  assert.equal(merged.alert.id, first.alert.id);
  assert.equal(merged.alert.occurrenceCount, 2);
  assert.equal(merged.alert.evidenceMessageId, secondMessage.id);
  assert.equal(db.listUnreadAttentionAlerts({ botId }).length, 1);
});

test("replaying one trigger is idempotent before and after read", () => {
  const botId = "attention_replay";
  const conversationKey = `${botId}:private:Ada`;
  const message = seed(botId, conversationKey, "需要确认库存", "replay-1");
  const first = record({ botId, conversationKey, message });
  const replay = record({ botId, conversationKey, message });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.alert.id, first.alert.id);
  assert.equal(replay.alert.occurrenceCount, 1);

  assert.equal(db.markAttentionAlertRead({ botId: "other_bot", alertId: first.alert.id }), null);
  assert.ok(db.markAttentionAlertRead({ botId, alertId: first.alert.id }).readAt);
  const afterReadReplay = record({ botId, conversationKey, message });
  assert.equal(afterReadReplay.duplicate, true);
  assert.equal(afterReadReplay.alert.id, first.alert.id);
  assert.equal(db.listUnreadAttentionAlerts({ botId }).length, 0);
});

test("a new trigger after read creates a new alert and invalid evidence is rejected", () => {
  const botId = "attention_after_read";
  const conversationKey = `${botId}:private:Ada`;
  const firstMessage = seed(botId, conversationKey, "问题一", "after-read-1");
  const secondMessage = seed(botId, conversationKey, "问题二", "after-read-2");
  const first = record({ botId, conversationKey, message: firstMessage });
  db.markAttentionAlertRead({ botId, alertId: first.alert.id });
  const second = record({ botId, conversationKey, message: secondMessage });
  assert.equal(second.created, true);
  assert.notEqual(second.alert.id, first.alert.id);
  assert.throws(() => record({
    botId,
    conversationKey,
    message: { id: 999999, content: "不存在" }
  }), /evidence/i);
});

test("cleanup removes expired read alerts but preserves unread alerts", () => {
  const botId = "attention_cleanup";
  const conversationKey = `${botId}:private:Ada`;
  const oldMessage = seed(botId, conversationKey, "旧问题", "cleanup-1");
  const liveMessage = seed(botId, conversationKey, "未读问题", "cleanup-2");
  const old = record({ botId, conversationKey, message: oldMessage, nowIso: "2026-01-01T00:00:00.000Z" });
  db.markAttentionAlertRead({ botId, alertId: old.alert.id, nowIso: "2026-01-02T00:00:00.000Z" });
  record({ botId, conversationKey, message: liveMessage, nowIso: "2026-01-03T00:00:00.000Z" });

  assert.equal(db.cleanupReadAttentionAlerts({ beforeIso: "2026-04-02T00:00:00.000Z" }), 1);
  assert.equal(db.listUnreadAttentionAlerts({ botId }).length, 1);
});
