import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
