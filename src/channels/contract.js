import { CHANNEL_ERROR_CODES, ChannelError } from "./errors.js";

export const CHANNEL_CAPABILITY_KEYS = Object.freeze([
  "privateChats",
  "groupChats",
  "text",
  "media",
  "deliveryReceipts",
  "readReceipts",
  "groupParticipants",
  "groupMentions",
  "nativeMentionAll",
  "contactLabels",
  "friendAddedEvent"
]);

const ADAPTER_METHODS = Object.freeze([
  "normalizeWebhook",
  "sendText",
  "sendMedia",
  "getAccountHealth",
  "configureWebhook",
  "listChats",
  "listGroups",
  "getGroup",
  "listGroupParticipants"
]);

const PROVIDER_ID = /^[a-z][a-z0-9-]*$/;

export function assertProviderId(provider) {
  if (typeof provider !== "string" || !PROVIDER_ID.test(provider)) {
    invalid("Provider identifier is invalid");
  }
  return provider;
}

export function assertCapabilities(value) {
  if (!isRecord(value) || !hasExactKeys(value, CHANNEL_CAPABILITY_KEYS)) {
    invalid("Channel capabilities are invalid");
  }
  for (const key of CHANNEL_CAPABILITY_KEYS) {
    if (typeof value[key] !== "boolean") {
      invalid("Channel capabilities are invalid");
    }
  }
  return value;
}

export function assertChannelAdapter(adapter) {
  if (!isRecord(adapter)) {
    invalid("Channel adapter is invalid");
  }
  assertProviderId(adapter.provider);
  assertCapabilities(adapter.capabilities);
  for (const method of ADAPTER_METHODS) {
    if (typeof adapter[method] !== "function") {
      invalid("Channel adapter is invalid", { provider: adapter.provider });
    }
  }
  return adapter;
}

export function normalizeSendCommand(command) {
  if (!isRecord(command)) {
    invalid("Send command is invalid");
  }
  for (const key of ["channelAccountId", "externalChatId", "messageType", "idempotencyKey"]) {
    requireNonEmptyString(command[key], "Send command is invalid");
  }
  if (command.text !== undefined && typeof command.text !== "string") {
    invalid("Send command is invalid");
  }
  if (command.replyToExternalMessageId !== undefined && typeof command.replyToExternalMessageId !== "string") {
    invalid("Send command is invalid");
  }
  if (command.attachments !== undefined && !Array.isArray(command.attachments)) {
    invalid("Send command is invalid");
  }
  if (command.mentions !== undefined && !Array.isArray(command.mentions)) {
    invalid("Send command is invalid");
  }
  if (command.metadata !== undefined && !isRecord(command.metadata)) {
    invalid("Send command is invalid");
  }

  return Object.freeze({
    ...command,
    text: command.text ?? "",
    attachments: freezeSnapshot(command.attachments ?? []),
    mentions: freezeSnapshot(command.mentions ?? []),
    replyToExternalMessageId: command.replyToExternalMessageId ?? "",
    metadata: freezeSnapshot(command.metadata ?? {})
  });
}

export function assertSendResult(result) {
  if (!isRecord(result) || typeof result.accepted !== "boolean") {
    invalid("Send result is invalid");
  }
  requireNonEmptyString(result.status, "Send result is invalid");
  if (result.accepted) {
    requireNonEmptyString(result.externalMessageId, "Send result is invalid");
  } else if (result.externalMessageId !== undefined && typeof result.externalMessageId !== "string") {
    invalid("Send result is invalid");
  }
  return result;
}

export function assertInboundEvents(events) {
  if (!Array.isArray(events)) {
    invalid("Inbound events are invalid");
  }
  for (const event of events) {
    assertInboundEvent(event);
  }
  return events;
}

function assertInboundEvent(event) {
  if (!isRecord(event)) {
    invalid("Inbound event is invalid");
  }
  assertProviderId(event.provider);
  requireNonEmptyString(event.channelAccountId, "Inbound event is invalid");
  requireNonEmptyString(event.eventId, "Inbound event is invalid");
  requireNonEmptyString(event.eventType, "Inbound event is invalid");
  requireNonEmptyString(event.occurredAt, "Inbound event is invalid");
  assertIdentity(event.chat, true, "Inbound event is invalid");
  assertIdentity(event.sender, false, "Inbound event is invalid");

  if (event.message === null) {
    if (isMessageEvent(event.eventType)) {
      invalid("Inbound event is invalid", { provider: event.provider, channelAccountId: event.channelAccountId });
    }
    return;
  }
  if (!isRecord(event.message)) {
    invalid("Inbound event is invalid", { provider: event.provider, channelAccountId: event.channelAccountId });
  }
  requireNonEmptyString(event.message.externalId, "Inbound event is invalid");
  requireNonEmptyString(event.message.type, "Inbound event is invalid");
  if (!Array.isArray(event.message.attachments) || !Array.isArray(event.message.mentions)) {
    invalid("Inbound event is invalid", { provider: event.provider, channelAccountId: event.channelAccountId });
  }
}

function assertIdentity(value, requiresType, message) {
  if (!isRecord(value)) {
    invalid(message);
  }
  requireNonEmptyString(value.externalId, message);
  if (requiresType) {
    requireNonEmptyString(value.type, message);
  }
  if (value.displayName !== undefined && typeof value.displayName !== "string") {
    invalid(message);
  }
}

function isMessageEvent(eventType) {
  return eventType === "message" || eventType.startsWith("message.") || eventType.startsWith("message:");
}

function requireNonEmptyString(value, message) {
  if (typeof value !== "string" || value.length === 0) {
    invalid(message);
  }
}

function hasExactKeys(value, keys) {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function freezeSnapshot(value, seen = new WeakMap()) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    invalid("Send command is invalid");
  }
  if (!Array.isArray(value) && !isRecord(value)) {
    invalid("Send command is invalid");
  }
  const copy = Array.isArray(value) ? [] : {};
  seen.set(value, copy);
  for (const key of Object.keys(value)) {
    copy[key] = freezeSnapshot(value[key], seen);
  }
  return Object.freeze(copy);
}

function invalid(message, context) {
  throw new ChannelError(CHANNEL_ERROR_CODES.INVALID_CONTRACT, message, context);
}
