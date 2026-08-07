import assert from "node:assert/strict";
import test from "node:test";

import { channelConversationKey, toCoreMessage } from "../src/channels/core-message-bridge.js";

function event(overrides = {}) {
  return {
    provider: "whapi", channelAccountId: "CHAN-A", eventId: "messages.post:message-1",
    eventType: "message.received", occurredAt: "2026-08-06T10:00:00.000Z",
    chat: { externalId: "15551234567@s.whatsapp.net", type: "private", displayName: "Ada" },
    sender: { externalId: "15551234567", displayName: "Ada" },
    message: {
      externalId: "message-1", type: "text", text: "hello", attachments: [],
      quotedMessageId: "", mentions: [], fromMe: false
    },
    rawPayload: {},
    ...overrides
  };
}

test("channel conversation keys use provider account chat type and stable external ID", () => {
  assert.equal(channelConversationKey(event()), "whapi:CHAN-A:private:15551234567@s.whatsapp.net");
  assert.equal(channelConversationKey(event({
    chat: { externalId: "120000000000@g.us", type: "group", displayName: "Renamed Group" }
  })), "whapi:CHAN-A:group:120000000000@g.us");
});

test("private standard events translate to the existing core shape without using names as identity", () => {
  const message = toCoreMessage(event());
  assert.deepEqual(message, {
    messageId: "message-1",
    roomType: 2,
    textType: 1,
    receivedName: "Ada",
    groupName: "",
    spoken: "hello",
    rawSpoken: "hello",
    fileType: "",
    fileUrl: "",
    fileName: "",
    atMe: "false",
    metadata: {
      provider: "whapi", channelAccountId: "CHAN-A",
      externalChatId: "15551234567@s.whatsapp.net", externalSenderId: "15551234567",
      conversationKey: "whapi:CHAN-A:private:15551234567@s.whatsapp.net",
      occurredAt: "2026-08-06T10:00:00.000Z", quotedMessageId: "", mentions: []
    },
    channelEvent: event()
  });
});

test("media translation exposes the first durable-download candidate to existing attachment handling", () => {
  const input = event({ message: {
    externalId: "message-2", type: "document", text: "caption",
    attachments: [{ type: "document", temporaryUrl: "https://cdn.example/a.pdf", fileName: "a.pdf" }],
    quotedMessageId: "quoted-1", mentions: ["bot-id"], fromMe: false
  } });
  const message = toCoreMessage(input);
  assert.equal(message.textType, 5);
  assert.equal(message.fileType, "file");
  assert.equal(message.fileUrl, "https://cdn.example/a.pdf");
  assert.equal(message.fileName, "a.pdf");
  assert.equal(message.atMe, "true");
});

test("gif and short video map to supported core media types", () => {
  for (const [type, textType, fileType] of [["gif", 4, "video"], ["short", 4, "video"]]) {
    const message = toCoreMessage(event({ message: {
      externalId: `message-${type}`, type, text: "",
      attachments: [{ type, temporaryUrl: `https://cdn.example/${type}.mp4`, fileName: "" }],
      quotedMessageId: "", mentions: [], fromMe: false
    } }));
    assert.equal(message.textType, textType);
    assert.equal(message.fileType, fileType);
    assert.equal(message.fileUrl, `https://cdn.example/${type}.mp4`);
  }
});

test("outbound and non-message events do not enter the core inbound message path", () => {
  assert.equal(toCoreMessage(event({ message: { ...event().message, fromMe: true } })), null);
  assert.equal(toCoreMessage(event({ eventType: "account.health", message: null })), null);
});
