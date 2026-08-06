import assert from "node:assert/strict";
import test from "node:test";

import { assertInboundEvents } from "../src/channels/contract.js";
import { normalizeWhapiWebhook } from "../src/channels/whapi/mapper.js";

test("Whapi mapper normalizes private and group text with stable identities", () => {
  const payload = {
    channel_id: "CHAN-A",
    event: { type: "messages", event: "post" },
    messages: [
      {
        id: "message-1", type: "text", chat_id: "15551234567@s.whatsapp.net",
        from: "15551234567", from_name: "Ada", from_me: false, timestamp: 1786000000,
        text: { body: "hello" }, context: { quoted_id: "quoted-1", mentions: ["15550000000"] }
      },
      {
        id: "message-2", type: "text", chat_id: "120000000000@g.us",
        chat_name: "Support", from: "15557654321", from_name: "Grace", from_me: false,
        timestamp: 1786000001, text: { body: "@bot help" }
      }
    ]
  };
  const events = normalizeWhapiWebhook({ channelAccountId: "CHAN-A", payload });
  assert.deepEqual(assertInboundEvents(events), events);
  assert.deepEqual(events.map((event) => ({
    eventId: event.eventId,
    chat: event.chat,
    sender: event.sender,
    message: event.message
  })), [
    {
      eventId: "messages.post:message-1",
      chat: { externalId: "15551234567@s.whatsapp.net", type: "private", displayName: "Ada" },
      sender: { externalId: "15551234567", displayName: "Ada" },
      message: {
        externalId: "message-1", type: "text", text: "hello", attachments: [],
        quotedMessageId: "quoted-1", mentions: ["15550000000"], fromMe: false
      }
    },
    {
      eventId: "messages.post:message-2",
      chat: { externalId: "120000000000@g.us", type: "group", displayName: "Support" },
      sender: { externalId: "15557654321", displayName: "Grace" },
      message: {
        externalId: "message-2", type: "text", text: "@bot help", attachments: [],
        quotedMessageId: "", mentions: [], fromMe: false
      }
    }
  ]);
});

test("Whapi mapper preserves supported media metadata without credential URLs", () => {
  const payload = {
    event: { type: "messages", event: "post" },
    messages: [{
      id: "media-message", type: "document", chat_id: "15551234567@s.whatsapp.net",
      from: "15551234567", from_name: "Ada", from_me: false, timestamp: 1786000000,
      document: {
        id: "media-1", link: "https://gate.whapi.cloud/media/media-1",
        mime_type: "application/pdf", file_size: 42, file_name: "quote.pdf", sha256: "abc",
        caption: "attached"
      }
    }]
  };
  const [event] = normalizeWhapiWebhook({ channelAccountId: "CHAN-A", payload });
  assert.equal(event.message.text, "attached");
  assert.deepEqual(event.message.attachments, [{
    externalId: "media-1", type: "document", mimeType: "application/pdf", fileName: "quote.pdf",
    size: 42, checksum: "abc", temporaryUrl: "https://gate.whapi.cloud/media/media-1"
  }]);
});

test("Whapi mapper normalizes statuses and account health and ignores unknown events", () => {
  const statuses = normalizeWhapiWebhook({ channelAccountId: "CHAN-A", payload: {
    event: { type: "statuses", event: "post" },
    statuses: [{ id: "out-1", status: "delivered", recipient_id: "15551234567@s.whatsapp.net", timestamp: "1786000000" }]
  } });
  assert.equal(statuses[0].eventType, "status.delivered");
  assert.equal(statuses[0].message.externalId, "out-1");
  assert.equal(statuses[0].message.text, "delivered");

  const [health] = normalizeWhapiWebhook({ channelAccountId: "CHAN-A", payload: {
    event: { type: "channel", event: "post" },
    health: { status: { text: "AUTH" }, start_at: 1786000000 }
  } });
  assert.equal(health.eventType, "account.health");
  assert.equal(health.message, null);
  assert.deepEqual(normalizeWhapiWebhook({ channelAccountId: "CHAN-A", payload: {
    event: { type: "calls", event: "post" }, calls: []
  } }), []);
});

test("Whapi mapper normalizes group lifecycle snapshots", () => {
  const [event] = normalizeWhapiWebhook({ channelAccountId: "CHAN-A", payload: {
    event: { type: "groups", event: "patch" },
    groups: [{
      id: "12001@g.us", name: "Renamed support", timestamp: 1786000000,
      participants: [
        { id: "15550001", name: "Ada", rank: "admin" },
        { id: "15550002", name: "Grace", rank: "member" }
      ]
    }]
  } });

  assert.equal(event.eventType, "group.updated");
  assert.deepEqual(event.chat, {
    externalId: "12001@g.us", type: "group", displayName: "Renamed support"
  });
  assert.equal(event.message, null);
  assert.deepEqual(event.rawPayload.participants.map((item) => item.id), ["15550001", "15550002"]);
});

test("Whapi mapper rejects a channel mismatch and malformed documented events", () => {
  assert.throws(() => normalizeWhapiWebhook({ channelAccountId: "CHAN-A", payload: {
    channel_id: "CHAN-B", event: { type: "messages", event: "post" }, messages: []
  } }), { code: "invalid_provider_response" });
  assert.throws(() => normalizeWhapiWebhook({ channelAccountId: "CHAN-A", payload: {
    event: { type: "messages", event: "post" }, messages: [{ id: "missing-fields" }]
  } }), { code: "invalid_provider_response" });
});
