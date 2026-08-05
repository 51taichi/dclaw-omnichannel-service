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

function validInboundEvent(overrides = {}) {
  return {
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
      attachments: [{ externalId: "media-1", audit: { size: 42 } }],
      quotedMessageId: "",
      mentions: ["user-2", { externalId: "user-3" }],
      fromMe: false
    },
    rawPayload: { envelope: { sequence: 1 } },
    ...overrides
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
  let getterCalls = 0;
  const withAccessor = { ...capabilities };
  Object.defineProperty(withAccessor, "text", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return true;
    }
  });
  expectInvalid(() => assertCapabilities(withAccessor));
  assert.equal(getterCalls, 0);
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

test("send commands reject unknown extension fields and non-JSON-like nested data", () => {
  const input = {
    channelAccountId: "account-1",
    externalChatId: "chat-1",
    messageType: "text",
    idempotencyKey: "idempotency-1",
    metadata: { nested: { source: "original" } }
  };
  const normalized = normalizeSendCommand(input);
  input.metadata.nested.source = "changed";

  assert.deepEqual(normalized.metadata, { nested: { source: "original" } });
  assert.equal(Object.isFrozen(normalized.metadata.nested), true);
  expectInvalid(() => normalizeSendCommand({ ...input, custom: { enabled: true } }));
  expectInvalid(() => normalizeSendCommand({ ...input, metadata: { createdAt: new Date() } }));
  expectInvalid(() => normalizeSendCommand({ ...input, metadata: { values: new Map() } }));
  expectInvalid(() => normalizeSendCommand({ ...input, metadata: { callback: () => undefined } }));
  expectInvalid(() => normalizeSendCommand({ ...input, metadata: { count: 1n } }));
  expectInvalid(() => normalizeSendCommand({ ...input, metadata: { marker: Symbol("marker") } }));
  expectInvalid(() => normalizeSendCommand({ ...input, metadata: { values: [Symbol("marker")] } }));
  const arrayWithExtension = ["valid"];
  arrayWithExtension.extension = true;
  expectInvalid(() => normalizeSendCommand({ ...input, metadata: { values: arrayWithExtension } }));
  const cyclic = {};
  cyclic.self = cyclic;
  expectInvalid(() => normalizeSendCommand({ ...input, metadata: cyclic }));
});

test("send command snapshots preserve __proto__ as immutable JSON data", () => {
  const metadata = JSON.parse('{"__proto__":{"retained":"yes"},"normal":1}');
  const normalized = normalizeSendCommand({
    channelAccountId: "account-1",
    externalChatId: "chat-1",
    messageType: "text",
    idempotencyKey: "idempotency-1",
    metadata
  });
  metadata.__proto__.retained = "changed";

  assert.equal(Object.getPrototypeOf(normalized.metadata), Object.prototype);
  assert.equal(Object.hasOwn(normalized.metadata, "__proto__"), true);
  assert.deepEqual(normalized.metadata.__proto__, { retained: "yes" });
  assert.equal(normalized.metadata.normal, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(normalized.metadata)),
    JSON.parse('{"__proto__":{"retained":"yes"},"normal":1}')
  );
  assert.equal(Object.isFrozen(normalized.metadata), true);
  assert.equal(Object.isFrozen(normalized.metadata.__proto__), true);
});

test("send results become immutable standard snapshots without caller aliases", () => {
  const result = {
    accepted: true,
    externalMessageId: "message-1",
    status: "queued",
    providerResponse: { providerOnly: { state: "kept for audit" } }
  };
  const snapshot = assertSendResult(result);
  result.providerResponse.providerOnly.state = "changed";

  assert.notEqual(snapshot, result);
  assert.deepEqual(snapshot, {
    accepted: true,
    externalMessageId: "message-1",
    status: "queued",
    providerResponse: { providerOnly: { state: "kept for audit" } }
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.providerResponse), true);
  assert.equal(Object.isFrozen(snapshot.providerResponse.providerOnly), true);
  assert.throws(() => { snapshot.status = "changed"; }, TypeError);

  const rejected = assertSendResult({ accepted: false, status: "rejected" });
  assert.deepEqual(rejected, { accepted: false, status: "rejected" });
  assert.equal(Object.isFrozen(rejected), true);
});

test("send results reject credential extensions, hidden keys, accessors, and unsafe audit values", () => {
  try {
    assertSendResult({ accepted: true, externalMessageId: "", status: "queued", providerResponse: { secret: "nope" } });
    assert.fail("expected invalid result");
  } catch (error) {
    assert.equal(error.message.includes("nope"), false);
    assert.equal(JSON.stringify(error).includes("nope"), false);
    assert.equal(error.code, "invalid_contract");
  }
  expectInvalid(() => assertSendResult({ accepted: "yes", status: "queued" }));
  expectInvalid(() => assertSendResult({ accepted: false, status: "rejected", token: "secret-token" }));
  expectInvalid(() => assertSendResult({ accepted: false, status: "rejected", authorization: "Bearer secret-token" }));
  expectInvalid(() => assertSendResult({ accepted: false, status: "rejected", extension: true }));
  expectInvalid(() => assertSendResult({ accepted: false, status: "rejected", [Symbol("hidden")]: true }));
  const hidden = { accepted: false, status: "rejected" };
  Object.defineProperty(hidden, "token", { value: "secret-token" });
  expectInvalid(() => assertSendResult(hidden));
  let getterCalls = 0;
  const accessor = { status: "rejected" };
  Object.defineProperty(accessor, "accepted", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return false;
    }
  });
  expectInvalid(() => assertSendResult(accessor));
  assert.equal(getterCalls, 0);
  expectInvalid(() => assertSendResult({
    accepted: false,
    status: "rejected",
    providerResponse: { callback: () => undefined }
  }));
  const cyclicResponse = {};
  cyclicResponse.self = cyclicResponse;
  expectInvalid(() => assertSendResult({
    accepted: false,
    status: "rejected",
    providerResponse: cyclicResponse
  }));
  expectInvalid(() => assertSendResult({
    accepted: false,
    status: "rejected",
    providerResponse: Array(2)
  }));
});

test("inbound events become recursively frozen snapshots without mutating or aliasing input", () => {
  const event = validInboundEvent();
  const events = [event];
  const snapshot = assertInboundEvents(events);

  assert.notEqual(snapshot, events);
  assert.notEqual(snapshot[0], event);
  assert.equal(Object.isFrozen(event), false);
  assert.equal(Object.isFrozen(event.message), false);
  event.chat.displayName = "Changed";
  event.message.text = "changed";
  event.message.attachments[0].audit.size = 0;
  event.message.mentions[1].externalId = "changed";
  event.rawPayload.envelope.sequence = 2;

  assert.equal(snapshot[0].chat.displayName, "Ada");
  assert.equal(snapshot[0].message.text, "hello");
  assert.equal(snapshot[0].message.attachments[0].audit.size, 42);
  assert.equal(snapshot[0].message.mentions[1].externalId, "user-3");
  assert.equal(snapshot[0].rawPayload.envelope.sequence, 1);
  for (const value of [
    snapshot,
    snapshot[0],
    snapshot[0].chat,
    snapshot[0].sender,
    snapshot[0].message,
    snapshot[0].message.attachments,
    snapshot[0].message.attachments[0],
    snapshot[0].message.mentions,
    snapshot[0].message.mentions[1],
    snapshot[0].rawPayload,
    snapshot[0].rawPayload.envelope
  ]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.throws(() => snapshot.push(event), TypeError);
});

test("inbound events permit null messages only for non-message event types", () => {
  const accountEvent = validInboundEvent({
    eventId: "event-2",
    eventType: "account.connected",
    chat: { externalId: "account-1", type: "account", displayName: "Account" },
    sender: { externalId: "system", displayName: "System" },
    message: null
  });

  const snapshot = assertInboundEvents([accountEvent]);
  assert.equal(snapshot[0].message, null);
  assert.equal(Object.isFrozen(snapshot[0]), true);
  expectInvalid(() => assertInboundEvents([validInboundEvent({ message: null })]));
});

test("inbound events reject every malformed documented scalar field", () => {
  expectInvalid(() => assertInboundEvents({ rejectedPayload: "not-an-array" }));
  const malformed = [
    { provider: "FakeChannel" },
    { channelAccountId: "" },
    { eventId: " " },
    { eventType: 1 },
    { occurredAt: "not-a-timestamp" },
    { occurredAt: "1" },
    { occurredAt: "2026-02-31T12:00:00Z" },
    { chat: null },
    { chat: { externalId: "", type: "private", displayName: "Ada" } },
    { chat: { externalId: "chat-1", type: "", displayName: "Ada" } },
    { chat: { externalId: "chat-1", type: "private", displayName: 1 } },
    { sender: null },
    { sender: { externalId: "", displayName: "Ada" } },
    { sender: { externalId: "user-1", displayName: false } },
    { message: { ...validInboundEvent().message, externalId: "" } },
    { message: { ...validInboundEvent().message, type: "" } },
    { message: { ...validInboundEvent().message, text: null } },
    { message: { ...validInboundEvent().message, attachments: {} } },
    { message: { ...validInboundEvent().message, quotedMessageId: null } },
    { message: { ...validInboundEvent().message, mentions: {} } },
    { message: { ...validInboundEvent().message, fromMe: "false" } }
  ];
  for (const override of malformed) {
    expectInvalid(() => assertInboundEvents([validInboundEvent(override)]));
  }
});

test("inbound events reject unknown extensions, accessors, and unsafe nested audit data", () => {
  expectInvalid(() => assertInboundEvents([validInboundEvent({ token: "secret-token" })]));
  expectInvalid(() => assertInboundEvents([validInboundEvent({
    chat: { ...validInboundEvent().chat, extension: true }
  })]));
  expectInvalid(() => assertInboundEvents([validInboundEvent({
    sender: { ...validInboundEvent().sender, type: "person" }
  })]));
  expectInvalid(() => assertInboundEvents([validInboundEvent({
    message: { ...validInboundEvent().message, authorization: "Bearer secret-token" }
  })]));
  expectInvalid(() => assertInboundEvents([validInboundEvent({
    message: { ...validInboundEvent().message, attachments: [{ callback: () => undefined }] }
  })]));
  expectInvalid(() => assertInboundEvents([validInboundEvent({
    message: { ...validInboundEvent().message, mentions: [Symbol("unsafe")] }
  })]));
  expectInvalid(() => assertInboundEvents([validInboundEvent({ rawPayload: { count: 1n } })]));
  expectInvalid(() => assertInboundEvents([validInboundEvent({ rawPayload: new Date() })]));
  expectInvalid(() => assertInboundEvents([validInboundEvent({
    message: { ...validInboundEvent().message, attachments: Array(1) }
  })]));
  expectInvalid(() => assertInboundEvents([validInboundEvent({
    message: { ...validInboundEvent().message, mentions: [Array(1)] }
  })]));
  expectInvalid(() => assertInboundEvents([validInboundEvent({ rawPayload: { nested: Array(1) } })]));
  const cyclic = {};
  cyclic.self = cyclic;
  expectInvalid(() => assertInboundEvents([validInboundEvent({ rawPayload: cyclic })]));
  const withSymbol = validInboundEvent();
  withSymbol[Symbol("hidden")] = true;
  expectInvalid(() => assertInboundEvents([withSymbol]));
  let getterCalls = 0;
  const withAccessor = validInboundEvent();
  Object.defineProperty(withAccessor, "rawPayload", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return {};
    }
  });
  expectInvalid(() => assertInboundEvents([withAccessor]));
  assert.equal(getterCalls, 0);
});
