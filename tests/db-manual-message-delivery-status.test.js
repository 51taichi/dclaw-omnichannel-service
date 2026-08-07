import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnichannel-manual-delivery-status-test-"));
process.env.DATA_DIR = dataDir;

const {
  insertConversationMessage,
  insertOutgoingMessage,
  listConversationMessages,
  listConversationMessagesAround,
  updateOutgoingMessageChannelStatus
} = await import("../src/db.js");

function insertManualReply({ botId, conversationKey, messageId, content = "人工回复" }) {
  return insertConversationMessage({
    botId,
    conversationKey,
    direction: "outbound",
    senderName: "人工客服",
    content,
    rawPayload: { source: "manual_reply", messageId }
  });
}

function messageById(messages, id) {
  return messages.find((message) => message.id === id);
}

test("manual replies expose their delivery status while other messages do not", () => {
  const botId = "bot-a";
  const conversationKey = "whapi:channel-a:private:customer-a";
  const manualMessage = insertManualReply({ botId, conversationKey, messageId: "message-1" });
  const automaticMessage = insertConversationMessage({
    botId,
    conversationKey,
    direction: "outbound",
    senderName: "AI",
    content: "自动回复",
    rawPayload: { source: "agent_reply", messageId: "message-2" }
  });

  insertOutgoingMessage({
    botId,
    conversationKey,
    messageId: "message-1",
    targetName: "customer-a",
    content: "人工回复",
    provider: "whapi",
    channelAccountId: "channel-a",
    deliveryStatus: "pending",
    channelResponse: {}
  });
  insertOutgoingMessage({
    botId,
    conversationKey,
    messageId: "message-2",
    targetName: "customer-a",
    content: "自动回复",
    provider: "whapi",
    channelAccountId: "channel-a",
    deliveryStatus: "delivered",
    channelResponse: {}
  });
  updateOutgoingMessageChannelStatus({
    provider: "whapi",
    channelAccountId: "channel-a",
    messageId: "message-1",
    status: "delivered"
  });

  const messages = listConversationMessages({ botId, conversationKey, limit: 10 });
  const manual = messageById(messages, manualMessage.id);
  const automatic = messageById(messages, automaticMessage.id);
  assert.equal(manual.deliveryStatus, "delivered");
  assert.equal(manual.deliveryError, "");
  assert.ok(manual.deliveryUpdatedAt);
  assert.equal(automatic.deliveryStatus, undefined);
});

test("manual reply delivery lookup stays within its bot and conversation", () => {
  const botId = "bot-scope";
  const conversationKey = "whapi:channel-a:private:customer-scope";
  const manualMessage = insertManualReply({ botId, conversationKey, messageId: "shared-message-id" });

  insertOutgoingMessage({
    botId,
    conversationKey,
    messageId: "shared-message-id",
    targetName: "customer-scope",
    content: "正确的发送记录",
    deliveryStatus: "sent",
    channelResponse: {}
  });
  insertOutgoingMessage({
    botId: "other-bot",
    conversationKey,
    messageId: "shared-message-id",
    targetName: "customer-scope",
    content: "不同 Bot 的发送记录",
    deliveryStatus: "failed",
    channelResponse: {}
  });
  insertOutgoingMessage({
    botId,
    conversationKey: "whapi:channel-a:private:other-customer",
    messageId: "shared-message-id",
    targetName: "other-customer",
    content: "不同会话的发送记录",
    deliveryStatus: "read",
    channelResponse: {}
  });

  const [message] = listConversationMessages({ botId, conversationKey, limit: 10 });
  assert.equal(message.id, manualMessage.id);
  assert.equal(message.deliveryStatus, "sent");
});

test("manual reply delivery lookup selects the newest outgoing record", () => {
  const botId = "bot-latest";
  const conversationKey = "whapi:channel-a:private:customer-latest";
  const manualMessage = insertManualReply({ botId, conversationKey, messageId: "replayed-message-id" });

  insertOutgoingMessage({
    botId,
    conversationKey,
    messageId: "replayed-message-id",
    targetName: "customer-latest",
    content: "旧记录",
    deliveryStatus: "sent",
    channelResponse: {}
  });
  insertOutgoingMessage({
    botId,
    conversationKey,
    messageId: "replayed-message-id",
    targetName: "customer-latest",
    content: "新记录",
    deliveryStatus: "read",
    channelResponse: {}
  });

  const [message] = listConversationMessages({ botId, conversationKey, limit: 10 });
  assert.equal(message.id, manualMessage.id);
  assert.equal(message.deliveryStatus, "read");
});

test("manual reply hides empty and unknown outgoing delivery statuses", () => {
  const botId = "bot-status-filter";
  const conversationKey = "whapi:channel-a:private:customer-status-filter";
  const emptyStatus = insertManualReply({ botId, conversationKey, messageId: "empty-status" });
  const unknownStatus = insertManualReply({ botId, conversationKey, messageId: "unknown-status" });

  insertOutgoingMessage({
    botId,
    conversationKey,
    messageId: "empty-status",
    targetName: "customer-status-filter",
    content: "空状态",
    channelResponse: {}
  });
  insertOutgoingMessage({
    botId,
    conversationKey,
    messageId: "unknown-status",
    targetName: "customer-status-filter",
    content: "未知状态",
    deliveryStatus: "unexpected",
    channelResponse: {}
  });

  const messages = listConversationMessages({ botId, conversationKey, limit: 10 });
  for (const id of [emptyStatus.id, unknownStatus.id]) {
    const message = messageById(messages, id);
    assert.equal(message.deliveryStatus, undefined);
    assert.equal(message.deliveryError, undefined);
    assert.equal(message.deliveryUpdatedAt, undefined);
  }
});

test("manual reply delivery status is attached in anchored message windows", () => {
  const botId = "bot-around";
  const conversationKey = "whapi:channel-a:private:customer-around";
  const manualMessage = insertManualReply({ botId, conversationKey, messageId: "around-message-id" });
  insertOutgoingMessage({
    botId,
    conversationKey,
    messageId: "around-message-id",
    targetName: "customer-around",
    content: "窗口状态",
    deliveryStatus: "played",
    channelResponse: {}
  });

  const [message] = listConversationMessagesAround({
    botId,
    conversationKey,
    anchorMessageId: manualMessage.id,
    before: 0,
    after: 0
  });
  assert.equal(message.deliveryStatus, "played");
});

test("manual reply delivery lookup has a matching scoped index", () => {
  const sqlite = new DatabaseSync(path.join(dataDir, "dclaw-omnichannel-service.sqlite"));
  const columns = sqlite.prepare("PRAGMA index_xinfo(idx_outgoing_messages_delivery_lookup)").all()
    .filter((column) => column.key === 1)
    .map((column) => ({ name: column.name, descending: column.desc }));
  const plan = sqlite.prepare(`
    EXPLAIN QUERY PLAN
    SELECT message_id, delivery_status, delivery_error, delivery_updated_at
    FROM outgoing_messages
    WHERE bot_id = ?
      AND conversation_key = ?
      AND message_id IN (?, ?)
    ORDER BY message_id ASC, id DESC
  `).all("bot-index", "whapi:channel-a:private:customer-index", "first", "second")
    .map((row) => row.detail)
    .join("\n");
  sqlite.close();

  assert.deepEqual(columns, [
    { name: "bot_id", descending: 0 },
    { name: "conversation_key", descending: 0 },
    { name: "message_id", descending: 0 },
    { name: "id", descending: 1 }
  ]);
  assert.match(plan, /USING INDEX idx_outgoing_messages_delivery_lookup/);
});

test("anchored message windows expose failed manual delivery errors after collecting neighbors", () => {
  const botId = "bot-around-failed";
  const conversationKey = "whapi:channel-a:private:customer-around-failed";
  insertConversationMessage({
    botId,
    conversationKey,
    direction: "inbound",
    senderName: "customer-around-failed",
    content: "前一条消息",
    rawPayload: { messageId: "before-around-message" }
  });
  const manualMessage = insertManualReply({
    botId,
    conversationKey,
    messageId: "failed-around-message"
  });
  insertConversationMessage({
    botId,
    conversationKey,
    direction: "inbound",
    senderName: "customer-around-failed",
    content: "后一条消息",
    rawPayload: { messageId: "after-around-message" }
  });
  insertOutgoingMessage({
    botId,
    conversationKey,
    messageId: "failed-around-message",
    targetName: "customer-around-failed",
    content: "人工回复",
    provider: "whapi",
    channelAccountId: "channel-a",
    deliveryStatus: "pending",
    channelResponse: {}
  });
  updateOutgoingMessageChannelStatus({
    provider: "whapi",
    channelAccountId: "channel-a",
    messageId: "failed-around-message",
    status: "failed",
    errorMessage: "provider rejected message"
  });

  const messages = listConversationMessagesAround({
    botId,
    conversationKey,
    anchorMessageId: manualMessage.id,
    before: 1,
    after: 1
  });
  const manual = messageById(messages, manualMessage.id);
  assert.equal(messages.length, 3);
  assert.equal(manual.deliveryStatus, "failed");
  assert.equal(manual.deliveryError, "provider rejected message");
  assert.ok(manual.deliveryUpdatedAt);
});
