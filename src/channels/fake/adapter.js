import { CHANNEL_CAPABILITY_KEYS, assertChannelAdapter, normalizeSendCommand } from "../contract.js";

export function createFakeChannelAdapter(options = {}) {
  const sentCommands = [];
  const outcomes = [];
  let nextMessageId = 1;
  const capabilities = normalizeCapabilities(options.capabilities);

  const send = async (command) => {
    const snapshot = deepFreezeSnapshot(normalizeSendCommand(command));
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
  if (!isRecord(overrides) || Reflect.ownKeys(overrides).some((key) => !CHANNEL_CAPABILITY_KEYS.includes(key))) {
    return invalidCapabilities();
  }
  const defaults = { text: true, media: true };
  const capabilities = Object.fromEntries(CHANNEL_CAPABILITY_KEYS.map((key) => [key, overrides[key] ?? defaults[key] ?? false]));
  return Object.freeze(capabilities);
}

function invalidCapabilities() {
  return {};
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreezeSnapshot(value, seen = new WeakMap()) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return seen.get(value);
  }
  if (!Array.isArray(value) && !isRecord(value)) {
    return value;
  }

  const copy = Array.isArray(value) ? [] : {};
  seen.set(value, copy);
  for (const key of Object.keys(value)) {
    copy[key] = deepFreezeSnapshot(value[key], seen);
  }
  return Object.freeze(copy);
}
