import assert from "node:assert/strict";
import test from "node:test";

import { createChannelDelivery } from "../src/channels/delivery.js";
import { createFakeChannelAdapter } from "../src/channels/fake/adapter.js";
import { createChannelRegistry } from "../src/channels/registry.js";
import { ChannelError } from "../src/channels/errors.js";

function command(overrides = {}) {
  return {
    channelAccountId: "account-1",
    externalChatId: "chat-1",
    messageType: "text",
    text: "Hello",
    attachments: [],
    mentions: [],
    idempotencyKey: "key-1",
    metadata: {},
    ...overrides
  };
}

function deliveryWith(adapter, account = { channelAccountId: "account-1", provider: "fake" }) {
  const registry = createChannelRegistry();
  registry.register(adapter);
  return createChannelDelivery({
    registry,
    resolveAccount(channelAccountId) {
      return channelAccountId === account.channelAccountId ? account : undefined;
    }
  });
}

async function expectChannelError(action, code, context = {}) {
  await assert.rejects(action, (error) => {
    assert.equal(error instanceof ChannelError, true);
    assert.equal(error.code, code);
    for (const [key, value] of Object.entries(context)) {
      assert.equal(error[key], value);
    }
    return true;
  });
}

test("delivery dispatches text and media commands to the matching fake adapter methods", async () => {
  const adapter = createFakeChannelAdapter();
  let textCalls = 0;
  let mediaCalls = 0;
  const sendText = adapter.sendText;
  const sendMedia = adapter.sendMedia;
  adapter.sendText = (sent) => {
    textCalls += 1;
    return sendText(sent);
  };
  adapter.sendMedia = (sent) => {
    mediaCalls += 1;
    return sendMedia(sent);
  };
  const delivery = deliveryWith(adapter);

  const textResult = await delivery.send(command());
  const mediaResult = await delivery.send(command({
    messageType: "image",
    text: "",
    attachments: [{ externalId: "image-1" }],
    idempotencyKey: "key-2"
  }));

  assert.deepEqual(textResult, {
    accepted: true,
    externalMessageId: "fake-message-1",
    status: "accepted"
  });
  assert.deepEqual(mediaResult, {
    accepted: true,
    externalMessageId: "fake-message-2",
    status: "accepted"
  });
  assert.equal(textCalls, 1);
  assert.equal(mediaCalls, 1);
  assert.deepEqual(adapter.sentCommands.map((recorded) => recorded.messageType), ["text", "image"]);
});

test("delivery requires text for text messages and media for every other message type", async () => {
  const adapter = createFakeChannelAdapter();
  const delivery = deliveryWith(adapter);

  await expectChannelError(() => delivery.send(command({ text: "" })), "invalid_contract", {
    channelAccountId: "account-1"
  });
  await expectChannelError(() => delivery.send(command({ messageType: "image", attachments: [] })), "invalid_contract", {
    channelAccountId: "account-1"
  });
  assert.deepEqual(adapter.sentCommands, []);
});

test("fake adapter records immutable command snapshots", async () => {
  const adapter = createFakeChannelAdapter();
  const delivery = deliveryWith(adapter);
  const input = command({
    attachments: [{ externalId: "file-1" }],
    metadata: { campaign: { id: "spring" } }
  });

  await delivery.send(input);
  input.attachments[0].externalId = "changed";
  input.metadata.campaign.id = "changed";

  assert.deepEqual(adapter.sentCommands[0].attachments, [{ externalId: "file-1" }]);
  assert.deepEqual(adapter.sentCommands[0].metadata, { campaign: { id: "spring" } });
  assert.equal(Object.isFrozen(adapter.sentCommands[0]), true);
  assert.equal(Object.isFrozen(adapter.sentCommands[0].attachments[0]), true);
});

test("fake adapter snapshots commands when called directly", async () => {
  const adapter = createFakeChannelAdapter();
  const input = command({ metadata: { source: "direct" } });

  await adapter.sendText(input);
  input.metadata.source = "changed";

  assert.deepEqual(adapter.sentCommands[0].metadata, { source: "direct" });
  assert.equal(Object.isFrozen(adapter.sentCommands[0]), true);
});

test("fake adapter rejects unknown command extension fields", async () => {
  const adapter = createFakeChannelAdapter();
  const input = command({ custom: { nested: { source: "direct" } } });

  await expectChannelError(() => adapter.sendText(input), "invalid_contract");
  assert.deepEqual(adapter.sentCommands, []);
});

test("delivery rejects missing and mismatched accounts without invoking an adapter", async () => {
  const adapter = createFakeChannelAdapter();
  const registry = createChannelRegistry();
  registry.register(adapter);
  const missing = createChannelDelivery({ registry, resolveAccount: () => undefined });
  const mismatched = createChannelDelivery({
    registry,
    resolveAccount: () => ({ channelAccountId: "account-2", provider: "fake" })
  });

  await expectChannelError(() => missing.send(command()), "invalid_contract", { channelAccountId: "account-1" });
  await expectChannelError(() => mismatched.send(command()), "invalid_contract", { channelAccountId: "account-1" });
  assert.deepEqual(adapter.sentCommands, []);
});

test("delivery rejects disabled required capabilities before it sends", async () => {
  const adapter = createFakeChannelAdapter({ capabilities: { text: false, media: false } });
  const delivery = deliveryWith(adapter);

  await expectChannelError(() => delivery.send(command()), "unsupported_capability", {
    provider: "fake",
    channelAccountId: "account-1",
    operation: "text"
  });
  await expectChannelError(() => delivery.send(command({
    messageType: "image",
    attachments: [{ externalId: "image-1" }]
  })), "unsupported_capability", {
    provider: "fake",
    channelAccountId: "account-1",
    operation: "media"
  });
  assert.deepEqual(adapter.sentCommands, []);
});

test("fake queued outcomes are FIFO and preserve documented provider errors", async () => {
  const adapter = createFakeChannelAdapter();
  const delivery = deliveryWith(adapter);
  const auth = new ChannelError("authentication_required", "Authentication required", { provider: "fake" });
  const temporary = new ChannelError("temporary_provider_failure", "Try again", { retryable: true });
  const permanent = new ChannelError("permanent_provider_rejection", "Rejected");
  adapter.queueOutcome(auth);
  adapter.queueOutcome((sent) => {
    assert.equal(sent.idempotencyKey, "key-2");
    return { accepted: false, status: "rejected" };
  });
  adapter.queueOutcome(temporary);
  adapter.queueOutcome(permanent);

  await expectChannelError(() => delivery.send(command()), "authentication_required", { provider: "fake" });
  assert.deepEqual(await delivery.send(command({ idempotencyKey: "key-2" })), { accepted: false, status: "rejected" });
  await expectChannelError(() => delivery.send(command({ idempotencyKey: "key-3" })), "temporary_provider_failure");
  await expectChannelError(() => delivery.send(command({ idempotencyKey: "key-4" })), "permanent_provider_rejection");
});

test("delivery rejects malformed provider results and sanitizes unexpected secret-bearing errors", async () => {
  const adapter = createFakeChannelAdapter();
  const delivery = deliveryWith(adapter);
  adapter.queueOutcome({ accepted: true, externalMessageId: "", status: "accepted", token: "secret-token" });
  adapter.queueOutcome(new Error("Authorization Bearer secret-token failed"));

  await expectChannelError(() => delivery.send(command()), "invalid_contract");
  await assert.rejects(() => delivery.send(command({ idempotencyKey: "key-2" })), (error) => {
    assert.equal(error.code, "temporary_provider_failure");
    assert.equal(error.provider, "fake");
    assert.equal(error.channelAccountId, "account-1");
    assert.equal(error.operation, "sendText");
    assert.equal(JSON.stringify(error).includes("secret-token"), false);
    return true;
  });
});

test("fake clear resets queued state, records, and deterministic message IDs", async () => {
  const adapter = createFakeChannelAdapter();
  const delivery = deliveryWith(adapter);
  adapter.queueOutcome({ accepted: true, externalMessageId: "queued-id", status: "accepted" });

  assert.equal((await delivery.send(command())).externalMessageId, "queued-id");
  adapter.clear();
  assert.deepEqual(adapter.sentCommands, []);
  assert.equal((await delivery.send(command({ idempotencyKey: "key-2" }))).externalMessageId, "fake-message-1");
});

test("fake adapter instances do not share commands, outcomes, or IDs", async () => {
  const first = createFakeChannelAdapter();
  const second = createFakeChannelAdapter();
  const firstDelivery = deliveryWith(first);
  const secondDelivery = deliveryWith(second);
  first.queueOutcome({ accepted: true, externalMessageId: "first-only", status: "accepted" });

  assert.equal((await firstDelivery.send(command())).externalMessageId, "first-only");
  assert.equal((await secondDelivery.send(command())).externalMessageId, "fake-message-1");
  assert.equal(first.sentCommands.length, 1);
  assert.equal(second.sentCommands.length, 1);
});
