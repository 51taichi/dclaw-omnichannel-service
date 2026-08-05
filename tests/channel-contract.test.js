import assert from "node:assert/strict";
import test from "node:test";

import {
  CHANNEL_CAPABILITY_KEYS,
  assertChannelAdapter,
  assertCapabilities,
  assertInboundEvents,
  assertProviderId,
  assertSendResult,
  normalizeSendCommand
} from "../src/channels/contract.js";
import { ChannelError } from "../src/channels/errors.js";

const capabilities = Object.freeze({
  privateChats: true,
  groupChats: true,
  text: true,
  media: true,
  deliveryReceipts: true,
  readReceipts: true,
  groupParticipants: true,
  groupMentions: true,
  nativeMentionAll: false,
  contactLabels: false,
  friendAddedEvent: false
});

const adapterMethods = [
  "normalizeWebhook",
  "sendText",
  "sendMedia",
  "getAccountHealth",
  "configureWebhook",
  "listChats",
  "listGroups",
  "getGroup",
  "listGroupParticipants"
];

function validAdapter() {
  return {
    provider: "fake-channel",
    capabilities,
    ...Object.fromEntries(adapterMethods.map((method) => [method, () => undefined]))
  };
}

function expectInvalid(action) {
  assert.throws(action, (error) => {
    assert.equal(error instanceof ChannelError, true);
    assert.equal(error.code, "invalid_contract");
    return true;
  });
}

test("provider identifiers accept lowercase hyphenated names and reject unsafe names", () => {
  assert.equal(assertProviderId("fake-channel"), "fake-channel");
  expectInvalid(() => assertProviderId("FakeChannel"));
  expectInvalid(() => assertProviderId("fake_channel"));
});

test("capabilities require exactly the documented boolean keys", () => {
  assert.deepEqual(CHANNEL_CAPABILITY_KEYS, Object.keys(capabilities));
  assert.equal(Object.isFrozen(CHANNEL_CAPABILITY_KEYS), true);
  assert.equal(assertCapabilities(capabilities), capabilities);
  expectInvalid(() => assertCapabilities({ ...capabilities, text: "true" }));
  expectInvalid(() => assertCapabilities({ ...capabilities, extra: true }));
  const withHiddenStringKey = { ...capabilities };
  Object.defineProperty(withHiddenStringKey, "hidden", { value: true });
  expectInvalid(() => assertCapabilities(withHiddenStringKey));
  const withSymbolKey = { ...capabilities, [Symbol("hidden")]: true };
  expectInvalid(() => assertCapabilities(withSymbolKey));
});

test("adapters require a valid provider, capabilities, and every contract method", () => {
  const adapter = validAdapter();
  assert.equal(assertChannelAdapter(adapter), adapter);
  delete adapter.sendMedia;
  expectInvalid(() => assertChannelAdapter(adapter));
});

test("send commands validate required fields and produce immutable input snapshots", () => {
  const input = {
    channelAccountId: "account-1",
    externalChatId: "chat-1",
    messageType: "text",
    idempotencyKey: "idempotency-1",
    attachments: [{ externalId: "file-1" }],
    mentions: ["user-1"],
    metadata: { campaign: { id: "spring" } }
  };

  const command = normalizeSendCommand(input);
  input.attachments[0].externalId = "changed";
  input.mentions.push("user-2");
  input.metadata.campaign.id = "changed";

  assert.deepEqual(command, {
    ...input,
    attachments: [{ externalId: "file-1" }],
    mentions: ["user-1"],
    metadata: { campaign: { id: "spring" } },
    text: "",
    replyToExternalMessageId: ""
  });
  assert.equal(Object.isFrozen(command), true);
  assert.equal(Object.isFrozen(command.attachments), true);
  assert.equal(Object.isFrozen(command.attachments[0]), true);
  assert.equal(Object.isFrozen(command.metadata.campaign), true);
  expectInvalid(() => normalizeSendCommand({ ...input, channelAccountId: "" }));
});

test("send results require accepted status and message IDs without putting responses in errors", () => {
  const result = {
    accepted: true,
    externalMessageId: "message-1",
    status: "queued",
    providerResponse: { providerOnly: "kept for audit" }
  };
  assert.equal(assertSendResult(result), result);
  try {
    assertSendResult({ accepted: true, externalMessageId: "", status: "queued", providerResponse: { secret: "nope" } });
    assert.fail("expected invalid result");
  } catch (error) {
    assert.equal(error.message.includes("nope"), false);
    assert.equal(JSON.stringify(error).includes("nope"), false);
    assert.equal(error.code, "invalid_contract");
  }
  expectInvalid(() => assertSendResult({ accepted: "yes", status: "queued" }));
});

test("inbound events accept message and account events while rejecting malformed safe errors", () => {
  const events = [
    {
      provider: "fake-channel",
      channelAccountId: "account-1",
      eventId: "event-1",
      eventType: "message.received",
      occurredAt: "2026-08-06T12:00:00.000Z",
      chat: { externalId: "chat-1", type: "private", displayName: "Ada" },
      sender: { externalId: "user-1", displayName: "Ada" },
      message: {
        externalId: "message-1",
        type: "text",
        text: "hello",
        attachments: [],
        quotedMessageId: "",
        mentions: [],
        fromMe: false
      }
    },
    {
      provider: "fake-channel",
      channelAccountId: "account-1",
      eventId: "event-2",
      eventType: "message.received",
      occurredAt: "2026-08-06T12:00:30.000Z",
      chat: { externalId: "group-1", type: "group", displayName: "Support" },
      sender: { externalId: "user-2", displayName: "Bea" },
      message: {
        externalId: "message-2",
        type: "media",
        text: "",
        attachments: [{ externalId: "media-1" }],
        quotedMessageId: "",
        mentions: ["user-1"],
        fromMe: false
      }
    },
    {
      provider: "fake-channel",
      channelAccountId: "account-1",
      eventId: "event-3",
      eventType: "account.connected",
      occurredAt: "2026-08-06T12:01:00.000Z",
      chat: { externalId: "account-1", type: "account", displayName: "Account" },
      sender: { externalId: "system", displayName: "System" },
      message: null
    }
  ];
  assert.equal(assertInboundEvents(events), events);
  expectInvalid(() => assertInboundEvents({ rejectedPayload: "not-an-array" }));
  expectInvalid(() => assertInboundEvents([{ ...events[0], message: { ...events[0].message, mentions: "no" } }]));
});
