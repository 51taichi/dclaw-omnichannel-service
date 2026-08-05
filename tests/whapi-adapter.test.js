import assert from "node:assert/strict";
import test from "node:test";

import { CHANNEL_CAPABILITY_KEYS, assertChannelAdapter } from "../src/channels/contract.js";
import { createWhapiAdapter } from "../src/channels/whapi/adapter.js";

function command(overrides = {}) {
  return {
    channelAccountId: "CHAN-A",
    externalChatId: "123@s.whatsapp.net",
    messageType: "text",
    text: "hello",
    attachments: [],
    mentions: ["456@s.whatsapp.net"],
    replyToExternalMessageId: "quoted-1",
    idempotencyKey: "send-1",
    metadata: {},
    ...overrides
  };
}

test("Whapi adapter satisfies the channel contract and maps text results", async () => {
  const requests = [];
  const client = {
    sendText: async (body) => { requests.push(body); return { sent: true, message: { id: "message-1", status: "pending" } }; }
  };
  const adapter = createWhapiAdapter({ resolveAccountClient: async () => client });
  assert.equal(assertChannelAdapter(adapter), adapter);
  assert.deepEqual(Object.keys(adapter.capabilities), CHANNEL_CAPABILITY_KEYS);

  const result = await adapter.sendText(command());
  assert.deepEqual(requests, [{
    to: "123@s.whatsapp.net",
    body: "hello",
    mentions: ["456@s.whatsapp.net"],
    quoted: "quoted-1"
  }]);
  assert.deepEqual(result, {
    accepted: true,
    externalMessageId: "message-1",
    status: "pending",
    providerResponse: { sent: true, message: { id: "message-1", status: "pending" } }
  });
});

test("Whapi adapter selects media endpoints and exposes groups and participants", async () => {
  const calls = [];
  const client = {
    sendMedia: async (type, body) => { calls.push([type, body]); return { sent: true, message: { id: "media-1", status: "pending" } }; },
    listChats: async (options) => ({ chats: [options] }),
    listGroups: async (options) => ({ groups: [options] }),
    getGroup: async (id) => ({ id, participants: [{ id: "p1" }] })
  };
  const adapter = createWhapiAdapter({ resolveAccountClient: async () => client });
  const result = await adapter.sendMedia(command({
    messageType: "document",
    text: "caption",
    attachments: [{ url: "https://cdn.example/a.pdf", fileName: "a.pdf", mimeType: "application/pdf" }]
  }));
  assert.deepEqual(calls[0], ["document", {
    to: "123@s.whatsapp.net",
    media: "https://cdn.example/a.pdf",
    caption: "caption",
    filename: "a.pdf",
    mime_type: "application/pdf",
    mentions: ["456@s.whatsapp.net"],
    quoted: "quoted-1"
  }]);
  assert.equal(result.externalMessageId, "media-1");
  assert.deepEqual(await adapter.listGroupParticipants({ channelAccountId: "CHAN-A" }, "group-1"), [{ id: "p1" }]);
});
