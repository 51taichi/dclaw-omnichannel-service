import { CHANNEL_CAPABILITY_KEYS, assertChannelAdapter, normalizeSendCommand } from "../contract.js";

export function createFakeChannelAdapter(options = {}) {
  const sentCommands = [];
  const outcomes = [];
  let nextMessageId = 1;
  const capabilities = normalizeCapabilities(options.capabilities);

  const send = async (command) => {
    const snapshot = normalizeSendCommand(command);
    sentCommands.push(snapshot);
    const outcome = outcomes.shift();
    if (outcome !== undefined) {
      const resolved = typeof outcome === "function" ? await outcome(snapshot) : outcome;
      if (resolved instanceof Error) {
        throw resolved;
      }
      return resolved;
    }
    const externalMessageId = `fake-message-${nextMessageId}`;
    nextMessageId += 1;
    return { accepted: true, externalMessageId, status: "accepted" };
  };

  const adapter = {
    provider: options.provider ?? "fake",
    capabilities,
    normalizeWebhook: () => EMPTY_ARRAY,
    sendText: send,
    sendMedia: send,
    getAccountHealth: () => ACCOUNT_HEALTH,
    configureWebhook: () => WEBHOOK_CONFIGURATION,
    listChats: () => EMPTY_ARRAY,
    listGroups: () => EMPTY_ARRAY,
    getGroup: () => EMPTY_GROUP,
    listGroupParticipants: () => EMPTY_ARRAY,
    sentCommands,
    queueOutcome(outcome) {
      outcomes.push(outcome);
    },
    clear() {
      outcomes.length = 0;
      sentCommands.length = 0;
      nextMessageId = 1;
    }
  };

  assertChannelAdapter(adapter);
  return adapter;
}

const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_GROUP = Object.freeze({});
const ACCOUNT_HEALTH = Object.freeze({ status: "healthy" });
const WEBHOOK_CONFIGURATION = Object.freeze({ configured: true });

function normalizeCapabilities(overrides = {}) {
  if (!isRecord(overrides)) {
    return invalidCapabilities();
  }
  const overrideValues = {};
  for (const key of Reflect.ownKeys(overrides)) {
    const descriptor = Object.getOwnPropertyDescriptor(overrides, key);
    if (typeof key !== "string"
      || !CHANNEL_CAPABILITY_KEYS.includes(key)
      || !descriptor.enumerable
      || !Object.hasOwn(descriptor, "value")
      || typeof descriptor.value !== "boolean") {
      return invalidCapabilities();
    }
    overrideValues[key] = descriptor.value;
  }
  const defaults = { text: true, media: true };
  const capabilities = Object.fromEntries(CHANNEL_CAPABILITY_KEYS.map((key) => [
    key,
    Object.hasOwn(overrideValues, key) ? overrideValues[key] : defaults[key] ?? false
  ]));
  return Object.freeze(capabilities);
}

function invalidCapabilities() {
  return {};
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
