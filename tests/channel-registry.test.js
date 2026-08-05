import assert from "node:assert/strict";
import test from "node:test";

import { createChannelRegistry } from "../src/channels/registry.js";
import { CHANNEL_CAPABILITY_KEYS } from "../src/channels/contract.js";
import { ChannelError } from "../src/channels/errors.js";

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

function adapter(provider, enabledCapabilities = {}) {
  return {
    provider,
    capabilities: Object.fromEntries(
      CHANNEL_CAPABILITY_KEYS.map((capability) => [capability, enabledCapabilities[capability] ?? false])
    ),
    ...Object.fromEntries(adapterMethods.map((method) => [method, () => undefined]))
  };
}

function expectChannelError(action, code, context = {}) {
  assert.throws(action, (error) => {
    assert.equal(error instanceof ChannelError, true);
    assert.equal(error.code, code);
    for (const [key, value] of Object.entries(context)) {
      assert.equal(error[key], value);
    }
    return true;
  });
}

test("register returns adapters and lists providers alphabetically in an immutable snapshot", () => {
  const registry = createChannelRegistry();
  const zebra = adapter("zebra");
  const alpha = adapter("alpha");

  assert.equal(registry.register(zebra), zebra);
  assert.equal(registry.register(alpha), alpha);
  const providers = registry.list();

  assert.deepEqual(providers, ["alpha", "zebra"]);
  assert.equal(Object.isFrozen(providers), true);
  assert.throws(() => providers.push("mutated"), TypeError);
  assert.deepEqual(registry.list(), ["alpha", "zebra"]);
});

test("register rejects duplicate providers", () => {
  const registry = createChannelRegistry();
  registry.register(adapter("whapi"));

  expectChannelError(() => registry.register(adapter("whapi")), "invalid_contract", { provider: "whapi" });
});

test("unregister removes a registered provider and reports whether it existed", () => {
  const registry = createChannelRegistry();
  registry.register(adapter("whapi"));

  assert.equal(registry.unregister("whapi"), true);
  assert.equal(registry.unregister("whapi"), false);
  assert.deepEqual(registry.list(), []);
});

test("get validates provider identifiers and rejects unknown providers", () => {
  const registry = createChannelRegistry();

  expectChannelError(() => registry.get("Unknown"), "invalid_contract");
  expectChannelError(() => registry.get("whapi"), "unknown_provider", { provider: "whapi" });
});

test("resolve requires a non-empty account ID", () => {
  const registry = createChannelRegistry();
  registry.register(adapter("whapi"));

  expectChannelError(() => registry.resolve({ provider: "whapi" }), "invalid_contract", { provider: "whapi" });
  expectChannelError(() => registry.resolve({ provider: "whapi", channelAccountId: "" }), "invalid_contract", {
    provider: "whapi",
    channelAccountId: ""
  });
});

test("resolve rejects unknown and disabled capabilities with safe context", () => {
  const registry = createChannelRegistry();
  registry.register(adapter("whapi", { text: true }));

  expectChannelError(
    () => registry.resolve({ provider: "whapi", channelAccountId: "account-1" }, "not-a-capability"),
    "unsupported_capability",
    { provider: "whapi", channelAccountId: "account-1", operation: "not-a-capability" }
  );
  expectChannelError(
    () => registry.resolve({ provider: "whapi", channelAccountId: "account-1" }, "media"),
    "unsupported_capability",
    { provider: "whapi", channelAccountId: "account-1", operation: "media" }
  );
  assert.equal(
    registry.resolve({ provider: "whapi", channelAccountId: "account-1" }, "text").provider,
    "whapi"
  );
});

test("registry instances keep their registered providers isolated", () => {
  const first = createChannelRegistry();
  const second = createChannelRegistry();
  const whapi = adapter("whapi");

  first.register(whapi);

  assert.equal(first.get("whapi"), whapi);
  expectChannelError(() => second.get("whapi"), "unknown_provider", { provider: "whapi" });
  assert.deepEqual(second.list(), []);
});

test("registration snapshots capabilities so caller mutation cannot change resolution", () => {
  const registry = createChannelRegistry();
  const mutable = adapter("mutable", { text: true, media: false });
  registry.register(mutable);

  mutable.capabilities.text = false;
  mutable.capabilities.media = true;

  assert.equal(
    registry.resolve({ provider: "mutable", channelAccountId: "account-1" }, "text"),
    mutable
  );
  expectChannelError(
    () => registry.resolve({ provider: "mutable", channelAccountId: "account-1" }, "media"),
    "unsupported_capability",
    { provider: "mutable", channelAccountId: "account-1", operation: "media" }
  );
});
