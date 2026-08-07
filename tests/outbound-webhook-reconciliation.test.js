import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  outboundWebhookRecord,
  reconcileOutboundWebhookMessage
} from "../src/outbound-webhook-reconciliation.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "outbound-webhook-reconciliation-"));
process.env.DATA_DIR = dataDir;

const {
  insertConversationMessage,
  insertOutgoingMessage,
  listConversationMessages,
  persistReconciledOutboundMessage,
  upsertConversation
} = await import("../src/db.js");

function event(overrides = {}) {
  return {
    provider: "whapi",
    channelAccountId: "CHAN-A",
    eventId: "messages.post:external-1",
    eventType: "message.sent",
    occurredAt: "2026-08-07T14:12:37.000Z",
    chat: {
      externalId: "16464068041@s.whatsapp.net",
      type: "private",
      displayName: "Peptide"
    },
    sender: { externalId: "19542049430", displayName: "" },
    message: {
      externalId: "external-1",
      type: "link_preview",
      text: "验证密匙是 ABC",
      attachments: [],
      quotedMessageId: "",
      mentions: [],
      fromMe: true
    },
    rawPayload: {
      id: "external-1",
      from_me: true,
      type: "link_preview",
      status: "pending",
      link_preview: { body: "验证密匙是 ABC", url: "example.com" }
    },
    ...overrides
  };
}

test("outbound webhook records preserve visible link-preview text and scoped identity", () => {
  const rawPayload = event().rawPayload;
  assert.deepEqual(outboundWebhookRecord({ botId: "bot-a", event: event() }), {
    botId: "bot-a",
    provider: "whapi",
    channelAccountId: "CHAN-A",
    conversationKey: "whapi:CHAN-A:private:16464068041@s.whatsapp.net",
    messageId: "external-1",
    content: "验证密匙是 ABC",
    occurredAt: "2026-08-07T14:12:37.000Z",
    deliveryStatus: "pending",
    rawPayload
  });
});

test("outbound webhook records reject inbound, status, and unreadable events", () => {
  assert.equal(outboundWebhookRecord({
    botId: "bot-a",
    event: event({
      eventType: "message.received",
      message: { ...event().message, fromMe: false }
    })
  }), null);
  assert.equal(outboundWebhookRecord({
    botId: "bot-a",
    event: event({ eventType: "status.read" })
  }), null);
  assert.equal(outboundWebhookRecord({
    botId: "bot-a",
    event: event({
      message: { ...event().message, text: "", attachments: [] }
    })
  }), null);
});

test("outbound media webhooks without captions keep a readable placeholder", () => {
  const record = outboundWebhookRecord({
    botId: "bot-a",
    event: event({
      message: {
        ...event().message,
        type: "document",
        text: "",
        attachments: [{
          externalId: "media-1",
          type: "document",
          mimeType: "application/pdf",
          fileName: "report.pdf",
          size: 42,
          checksum: "",
          temporaryUrl: ""
        }]
      }
    })
  });
  assert.equal(record.content, "[文件] report.pdf");
  assert.equal(record.deliveryStatus, "pending");
});

test("reconciliation ignores non-outbound events without calling persistence", () => {
  const result = reconcileOutboundWebhookMessage({
    botId: "bot-a",
    event: event({ eventType: "status.read" }),
    senderName: "机器人",
    persist: () => assert.fail("ignored events must not persist")
  });
  assert.deepEqual(result, {
    outcome: "ignored",
    conversationMessageId: null,
    outgoingInserted: false
  });
});

function createConversation({
  botId = "bot-a",
  conversationKey = "whapi:CHAN-A:private:16464068041@s.whatsapp.net"
} = {}) {
  upsertConversation({
    botId,
    agentId: "agent-a",
    conversationKey,
    message: {
      roomType: 2,
      receivedName: "Peptide",
      groupName: ""
    },
    skipFirstSeenDateTag: true
  });
  return { botId, conversationKey };
}

function persistedInput(overrides = {}) {
  return {
    botId: "bot-a",
    provider: "whapi",
    channelAccountId: "CHAN-A",
    conversationKey: "whapi:CHAN-A:private:16464068041@s.whatsapp.net",
    messageId: "external-db-1",
    content: "外部 API 回复",
    occurredAt: "2026-08-07T14:12:37.000Z",
    deliveryStatus: "sent",
    rawPayload: { id: "external-db-1", from_me: true, type: "text" },
    senderName: "销售客服",
    ...overrides
  };
}

test("untracked outbound webhooks atomically create one conversation and outgoing row", () => {
  const scope = createConversation();
  const first = persistReconciledOutboundMessage(persistedInput());
  assert.equal(first.outcome, "inserted");
  assert.equal(first.outgoingInserted, true);

  const messages = listConversationMessages({ ...scope, limit: 20 });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, "外部 API 回复");
  assert.equal(messages[0].createdAt, "2026-08-07T14:12:37.000Z");
  assert.deepEqual(messages[0].rawPayload, {
    source: "channel_outbound_webhook",
    messageId: "external-db-1",
    channelMessageId: "external-db-1",
    channelMessageIds: ["external-db-1"],
    provider: "whapi",
    channelAccountId: "CHAN-A",
    channelPayload: { id: "external-db-1", from_me: true, type: "text" }
  });

  const sqlite = new DatabaseSync(path.join(dataDir, "dclaw-omnichannel-service.sqlite"), {
    readOnly: true
  });
  const outgoing = sqlite.prepare(`
    SELECT provider, channel_account_id, message_id, content,
           delivery_status, delivery_updated_at, created_at
    FROM outgoing_messages
    WHERE bot_id = ? AND message_id = ?
  `).get("bot-a", "external-db-1");
  sqlite.close();
  assert.deepEqual({ ...outgoing }, {
    provider: "whapi",
    channel_account_id: "CHAN-A",
    message_id: "external-db-1",
    content: "外部 API 回复",
    delivery_status: "sent",
    delivery_updated_at: "2026-08-07T14:12:37.000Z",
    created_at: "2026-08-07T14:12:37.000Z"
  });

  const duplicate = persistReconciledOutboundMessage(persistedInput());
  assert.equal(duplicate.outcome, "existing_outgoing");
  assert.equal(listConversationMessages({ ...scope, limit: 20 }).length, 1);
});

test("a later standard-send persistence converges on an earlier webhook echo", () => {
  const scope = createConversation({
    botId: "echo-race-bot",
    conversationKey: "whapi:CHAN-A:private:echo-race-customer"
  });
  const input = persistedInput({
    ...scope,
    messageId: "echo-race-id",
    content: "竞态消息"
  });
  const reconciled = persistReconciledOutboundMessage(input);

  const standardConversation = insertConversationMessage({
    ...scope,
    direction: "outbound",
    senderName: "机器人",
    content: "竞态消息",
    rawPayload: {
      channelMessageId: "echo-race-id",
      channelMessageIds: ["echo-race-id"]
    }
  });
  insertOutgoingMessage({
    ...scope,
    messageId: "echo-race-id",
    targetName: "echo-race-customer",
    content: "竞态消息",
    channelResponse: {
      accepted: true,
      data: "echo-race-id",
      channelResult: { accepted: true, data: "echo-race-id", status: "sent" }
    }
  });

  assert.equal(standardConversation.id, reconciled.conversationMessageId);
  assert.equal(listConversationMessages({ ...scope, limit: 20 }).length, 1);
  const sqlite = new DatabaseSync(path.join(dataDir, "dclaw-omnichannel-service.sqlite"), {
    readOnly: true
  });
  const count = sqlite.prepare(`
    SELECT COUNT(*) AS count FROM outgoing_messages
    WHERE bot_id = ? AND provider = ? AND channel_account_id = ? AND message_id = ?
  `).get("echo-race-bot", "whapi", "CHAN-A", "echo-race-id").count;
  sqlite.close();
  assert.equal(count, 1);
});

test("existing conversation identity repairs only the missing outgoing row", () => {
  const scope = createConversation({
    botId: "bot-conversation-only",
    conversationKey: "whapi:CHAN-A:private:conversation-only"
  });
  insertConversationMessage({
    ...scope,
    direction: "outbound",
    senderName: "机器人",
    content: "已经存在的气泡",
    rawPayload: { channelMessageIds: ["conversation-only-id"] }
  });

  const result = persistReconciledOutboundMessage(persistedInput({
    ...scope,
    messageId: "conversation-only-id"
  }));
  assert.equal(result.outcome, "existing_conversation");
  assert.equal(result.outgoingInserted, true);
  assert.equal(listConversationMessages({ ...scope, limit: 20 }).length, 1);
});

test("outbound reconciliation scopes duplicate identity and requires an owned conversation", () => {
  createConversation({
    botId: "other-bot",
    conversationKey: "whapi:OTHER:private:other-customer"
  });
  insertOutgoingMessage({
    botId: "other-bot",
    conversationKey: "whapi:OTHER:private:other-customer",
    messageId: "shared-scoped-id",
    targetName: "other-customer",
    content: "其他范围",
    provider: "other-provider",
    channelAccountId: "OTHER",
    deliveryStatus: "failed",
    channelResponse: {}
  });
  const scope = createConversation({
    botId: "scoped-bot",
    conversationKey: "whapi:CHAN-A:private:scoped-customer"
  });
  const inserted = persistReconciledOutboundMessage(persistedInput({
    ...scope,
    messageId: "shared-scoped-id"
  }));
  assert.equal(inserted.outcome, "inserted");

  const missing = persistReconciledOutboundMessage(persistedInput({
    botId: "missing-bot",
    conversationKey: "whapi:CHAN-A:private:missing-customer",
    messageId: "missing-conversation-id"
  }));
  assert.deepEqual(missing, {
    outcome: "missing_conversation",
    conversationMessageId: null,
    outgoingInserted: false
  });
});
