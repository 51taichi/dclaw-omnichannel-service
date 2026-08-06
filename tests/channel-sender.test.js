import assert from "node:assert/strict";
import test from "node:test";

import { createChannelSender } from "../src/channels/sender.js";

test("channel sender routes configured Bots through standard delivery with compatible results", async () => {
  const commands = [];
  const sender = createChannelSender({
    findAccount: (botId) => botId === "bot-a" ? {
      botId, provider: "whapi", channelId: "CHAN-A", enabled: true, healthStatus: "connected"
    } : null,
    delivery: { send: async (command) => {
      commands.push(command);
      return { accepted: true, externalMessageId: "whapi-message-1", status: "pending" };
    } },
    idempotencyKey: () => "send-key-1"
  });
  const result = await sender.sendText({ botId: "bot-a", target: "123@s.whatsapp.net", content: "hello", mentions: ["456"] });
  assert.deepEqual(commands, [{
    channelAccountId: "CHAN-A", externalChatId: "123@s.whatsapp.net", messageType: "text",
    text: "hello", attachments: [], mentions: ["456"], replyToExternalMessageId: "",
    idempotencyKey: "send-key-1", metadata: { botId: "bot-a", source: "core" }
  }]);
  assert.deepEqual(result, {
    data: "whapi-message-1",
    accepted: true,
    status: "pending",
    channelResult: { accepted: true, externalMessageId: "whapi-message-1", status: "pending" }
  });
});

test("channel sender rejects Bots without a channel account", async () => {
  const sender = createChannelSender({
    findAccount: () => null,
    delivery: { send: () => assert.fail("channel delivery must not run") }
  });
  await assert.rejects(
    () => sender.sendText({ botId: "missing", target: "Ada", content: "hello" }),
    { code: "authentication_required" }
  );
});

test("channel sender maps core media files to standard attachment commands", async () => {
  const commands = [];
  const sender = createChannelSender({
    findAccount: () => ({ botId: "bot-a", provider: "whapi", channelId: "CHAN-A", enabled: true, healthStatus: "connected" }),
    delivery: { send: async (command) => {
      commands.push(command);
      return { accepted: true, externalMessageId: "media-1", status: "pending" };
    } },
    idempotencyKey: () => "media-key-1"
  });
  const result = await sender.sendMedia({
    botId: "bot-a", target: "123@s.whatsapp.net", fileUrl: "https://cdn.example/a.pdf",
    fileName: "a.pdf", fileType: "file", caption: "invoice"
  });
  assert.equal(result.data, "media-1");
  assert.deepEqual(commands[0], {
    channelAccountId: "CHAN-A", externalChatId: "123@s.whatsapp.net", messageType: "document",
    text: "invoice", attachments: [{ url: "https://cdn.example/a.pdf", fileName: "a.pdf" }],
    mentions: [], replyToExternalMessageId: "", idempotencyKey: "media-key-1",
    metadata: { botId: "bot-a", source: "core" }
  });
});

test("disabled or disconnected channel accounts fail closed without legacy fallback", async () => {
  for (const account of [
    { botId: "bot-a", provider: "whapi", channelId: "CHAN-A", enabled: false, healthStatus: "connected" },
    { botId: "bot-a", provider: "whapi", channelId: "CHAN-A", enabled: true, healthStatus: "auth-required" }
  ]) {
    const sender = createChannelSender({
      findAccount: () => account,
      delivery: { send: () => assert.fail("must not send") },
    });
    await assert.rejects(() => sender.sendText({ botId: "bot-a", target: "123", content: "hello" }), {
      code: "authentication_required"
    });
  }
});
