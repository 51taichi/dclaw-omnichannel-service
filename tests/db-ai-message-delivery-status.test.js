import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnichannel-ai-delivery-status-test-"));
process.env.DATA_DIR = dataDir;

const {
  insertConversationMessage,
  insertOutgoingMessage,
  listConversationMessages,
  updateOutgoingMessageChannelStatus
} = await import("../src/db.js");

function insertAiReply({ botId, conversationKey, messageIds, legacy = false }) {
  return insertConversationMessage({
    botId,
    conversationKey,
    direction: "outbound",
    senderName: "AI",
    content: "AI 自动回复",
    rawPayload: legacy
      ? { source: "agent_reply", channelMessageId: messageIds[0] }
      : { source: "agent_reply", channelMessageIds: messageIds }
  });
}

function insertOutgoing({
  botId,
  conversationKey,
  messageId,
  status,
  provider = "whapi",
  channelAccountId = "channel-a"
}) {
  insertOutgoingMessage({
    botId,
    conversationKey,
    messageId,
    targetName: "customer",
    content: messageId,
    provider,
    channelAccountId,
    deliveryStatus: status,
    channelResponse: {}
  });
}

function loadMessage(botId, conversationKey, id) {
  return listConversationMessages({ botId, conversationKey, limit: 100 })
    .find((message) => message.id === id);
}

test("single-part AI replies expose each supported aggregate delivery state", () => {
  for (const [status, expected] of [
    ["pending", "sent"],
    ["delivered", "delivered"],
    ["read", "read"],
    ["failed", "failed"]
  ]) {
    const botId = `single-${status}`;
    const conversationKey = `whapi:channel-a:private:customer-${status}`;
    const messageId = `ai-${status}`;
    const message = insertAiReply({ botId, conversationKey, messageIds: [messageId] });
    insertOutgoing({ botId, conversationKey, messageId, status });

    assert.equal(loadMessage(botId, conversationKey, message.id).deliveryStatus, expected);
  }
});

test("multi-part AI replies aggregate all text and attachment statuses", () => {
  const cases = [
    { statuses: ["read", "failed"], expected: "failed" },
    { statuses: ["read", "pending"], expected: "sent" },
    { statuses: ["read", "sent"], expected: "sent" },
    { statuses: ["read", "delivered"], expected: "delivered" },
    { statuses: ["read", "played"], expected: "read" }
  ];

  for (const [index, fixture] of cases.entries()) {
    const botId = `aggregate-${index}`;
    const conversationKey = `whapi:channel-a:private:aggregate-${index}`;
    const messageIds = [`text-${index}`, `attachment-${index}`];
    const message = insertAiReply({ botId, conversationKey, messageIds });
    messageIds.forEach((messageId, partIndex) => insertOutgoing({
      botId,
      conversationKey,
      messageId,
      status: fixture.statuses[partIndex]
    }));

    assert.equal(loadMessage(botId, conversationKey, message.id).deliveryStatus, fixture.expected);
  }
});

test("AI replies degrade partial records to sent and hide status when every record is missing", () => {
  const botId = "partial-bot";
  const conversationKey = "whapi:channel-a:private:partial-customer";
  const partial = insertAiReply({
    botId,
    conversationKey,
    messageIds: ["known-read", "missing-part"]
  });
  const missing = insertAiReply({
    botId,
    conversationKey,
    messageIds: ["missing-one", "missing-two"]
  });
  insertOutgoing({ botId, conversationKey, messageId: "known-read", status: "read" });

  assert.equal(loadMessage(botId, conversationKey, partial.id).deliveryStatus, "sent");
  assert.equal(loadMessage(botId, conversationKey, missing.id).deliveryStatus, undefined);
});

test("legacy AI replies use channelMessageId", () => {
  const botId = "legacy-bot";
  const conversationKey = "whapi:channel-a:private:legacy-customer";
  const message = insertAiReply({
    botId,
    conversationKey,
    messageIds: ["legacy-message"],
    legacy: true
  });
  insertOutgoing({ botId, conversationKey, messageId: "legacy-message", status: "delivered" });

  assert.equal(loadMessage(botId, conversationKey, message.id).deliveryStatus, "delivered");
});

test("AI aggregation isolates provider/account and exposes failed error plus latest update time", () => {
  const botId = "scope-bot";
  const conversationKey = "whapi:channel-a:private:scope-customer";
  const message = insertAiReply({
    botId,
    conversationKey,
    messageIds: ["failed-part", "read-part"]
  });
  insertOutgoing({ botId, conversationKey, messageId: "failed-part", status: "sent" });
  insertOutgoing({ botId, conversationKey, messageId: "read-part", status: "sent" });
  updateOutgoingMessageChannelStatus({
    botId,
    provider: "whapi",
    channelAccountId: "channel-a",
    messageId: "failed-part",
    status: "failed",
    errorMessage: "provider rejected AI part"
  });
  updateOutgoingMessageChannelStatus({
    botId,
    provider: "whapi",
    channelAccountId: "channel-a",
    messageId: "read-part",
    status: "read"
  });
  insertOutgoing({
    botId,
    conversationKey,
    messageId: "failed-part",
    status: "read",
    provider: "other-provider"
  });
  insertOutgoing({
    botId,
    conversationKey,
    messageId: "read-part",
    status: "read",
    channelAccountId: "other-account"
  });

  const loaded = loadMessage(botId, conversationKey, message.id);
  assert.equal(loaded.deliveryStatus, "failed");
  assert.equal(loaded.deliveryError, "provider rejected AI part");
  assert.ok(loaded.deliveryUpdatedAt);
});
