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

const SEND_COMMAND_KEYS = Object.freeze([
  "channelAccountId",
  "externalChatId",
  "messageType",
  "text",
  "attachments",
  "mentions",
  "replyToExternalMessageId",
  "idempotencyKey",
  "metadata"
]);

const SEND_RESULT_KEYS = Object.freeze([
  "accepted",
  "externalMessageId",
  "status",
  "providerResponse"
]);

const INBOUND_EVENT_KEYS = Object.freeze([
  "provider",
  "channelAccountId",
  "eventId",
  "eventType",
  "occurredAt",
  "chat",
  "sender",
  "message",
  "rawPayload"
]);

const INBOUND_CHAT_KEYS = Object.freeze(["externalId", "type", "displayName"]);
const INBOUND_SENDER_KEYS = Object.freeze(["externalId", "displayName"]);
const INBOUND_MESSAGE_KEYS = Object.freeze([
  "externalId",
  "type",
  "text",
  "attachments",
  "quotedMessageId",
  "mentions",
  "fromMe"
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
const RFC3339_TIMESTAMP = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

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
  if (!isRecord(command) || !hasOnlyKnownKeys(command, SEND_COMMAND_KEYS)) {
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
  const fields = ownDataFields(result, SEND_RESULT_KEYS, ["accepted", "status"]);
  if (fields === null || typeof fields.accepted !== "boolean") {
    invalid("Send result is invalid");
  }
  requireNonEmptyString(fields.status, "Send result is invalid");
  if (fields.accepted) {
    requireNonEmptyString(fields.externalMessageId, "Send result is invalid");
  } else if (Object.hasOwn(fields, "externalMessageId") && typeof fields.externalMessageId !== "string") {
    invalid("Send result is invalid");
  }

  const snapshot = {
    accepted: fields.accepted,
    ...(Object.hasOwn(fields, "externalMessageId") ? { externalMessageId: fields.externalMessageId } : {}),
    status: fields.status,
    ...(Object.hasOwn(fields, "providerResponse")
      ? { providerResponse: freezeSnapshot(fields.providerResponse, new WeakSet(), "Send result is invalid") }
      : {})
  };
  return Object.freeze(snapshot);
}

export function assertInboundEvents(events) {
  if (!isStandardArray(events)) {
    invalid("Inbound events are invalid");
  }
  return Object.freeze(events.map(normalizeInboundEvent));
}

function normalizeInboundEvent(event) {
  const fields = ownDataFields(event, INBOUND_EVENT_KEYS, [
    "provider",
    "channelAccountId",
    "eventId",
    "eventType",
    "occurredAt",
    "chat",
    "sender",
    "message"
  ]);
  if (fields === null) {
    invalid("Inbound event is invalid");
  }
  assertProviderId(fields.provider);
  requireNonBlankString(fields.channelAccountId, "Inbound event is invalid");
  requireNonBlankString(fields.eventId, "Inbound event is invalid");
  requireNonBlankString(fields.eventType, "Inbound event is invalid");
  if (typeof fields.occurredAt !== "string"
    || !RFC3339_TIMESTAMP.test(fields.occurredAt)
    || !Number.isFinite(Date.parse(fields.occurredAt))) {
    invalid("Inbound event is invalid");
  }

  const chat = normalizeInboundIdentity(fields.chat, INBOUND_CHAT_KEYS, true);
  const sender = normalizeInboundIdentity(fields.sender, INBOUND_SENDER_KEYS, false);
  let message = null;
  if (fields.message === null) {
    if (isMessageEvent(fields.eventType)) {
      invalid("Inbound event is invalid", { provider: fields.provider, channelAccountId: fields.channelAccountId });
    }
  } else {
    message = normalizeInboundMessage(fields.message, fields);
  }

  return Object.freeze({
    provider: fields.provider,
    channelAccountId: fields.channelAccountId,
    eventId: fields.eventId,
    eventType: fields.eventType,
    occurredAt: fields.occurredAt,
    chat,
    sender,
    message,
    ...(Object.hasOwn(fields, "rawPayload")
      ? { rawPayload: freezeSnapshot(fields.rawPayload, new WeakSet(), "Inbound event is invalid") }
      : {})
  });
}

function normalizeInboundIdentity(value, keys, includesType) {
  const fields = ownDataFields(value, keys, keys);
  if (fields === null) {
    invalid("Inbound event is invalid");
  }
  requireNonBlankString(fields.externalId, "Inbound event is invalid");
  if (includesType) {
    requireNonBlankString(fields.type, "Inbound event is invalid");
  }
  if (typeof fields.displayName !== "string") {
    invalid("Inbound event is invalid");
  }
  return Object.freeze({
    externalId: fields.externalId,
    ...(includesType ? { type: fields.type } : {}),
    displayName: fields.displayName
  });
}

function normalizeInboundMessage(value, eventFields) {
  const fields = ownDataFields(value, INBOUND_MESSAGE_KEYS, INBOUND_MESSAGE_KEYS);
  if (fields === null) {
    invalid("Inbound event is invalid", { provider: eventFields.provider, channelAccountId: eventFields.channelAccountId });
  }
  requireNonBlankString(fields.externalId, "Inbound event is invalid");
  requireNonBlankString(fields.type, "Inbound event is invalid");
  if (typeof fields.text !== "string"
    || typeof fields.quotedMessageId !== "string"
    || typeof fields.fromMe !== "boolean"
    || !isStandardArray(fields.attachments)
    || !isStandardArray(fields.mentions)) {
    invalid("Inbound event is invalid", { provider: eventFields.provider, channelAccountId: eventFields.channelAccountId });
  }
  return Object.freeze({
    externalId: fields.externalId,
    type: fields.type,
    text: fields.text,
    attachments: freezeSnapshot(fields.attachments, new WeakSet(), "Inbound event is invalid"),
    quotedMessageId: fields.quotedMessageId,
    mentions: freezeSnapshot(fields.mentions, new WeakSet(), "Inbound event is invalid"),
    fromMe: fields.fromMe
  });
}

function isMessageEvent(eventType) {
  return eventType === "message" || eventType.startsWith("message.") || eventType.startsWith("message:");
}

function requireNonEmptyString(value, message) {
  if (typeof value !== "string" || value.length === 0) {
    invalid(message);
  }
}

function requireNonBlankString(value, message) {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalid(message);
  }
}

function hasExactKeys(value, keys) {
  const actualKeys = Reflect.ownKeys(value);
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function hasOnlyKnownKeys(value, keys) {
  return Reflect.ownKeys(value).every((key) => typeof key === "string" && keys.includes(key));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStandardArray(value) {
  if (!Array.isArray(value)) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  const elementKeys = keys.filter((key) => key !== "length");
  return elementKeys.length === value.length && elementKeys.every((key) => {
    if (typeof key !== "string" || !isArrayIndex(key)) {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor.enumerable && Object.hasOwn(descriptor, "value");
  });
}

function ownDataFields(value, allowedKeys, requiredKeys = []) {
  if (!isPlainObject(value) || !hasOnlyKnownKeys(value, allowedKeys)) {
    return null;
  }
  const fields = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      return null;
    }
    Object.defineProperty(fields, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: false,
      writable: false
    });
  }
  return requiredKeys.every((key) => Object.hasOwn(fields, key)) ? fields : null;
}

function freezeSnapshot(value, ancestors = new WeakSet(), errorMessage = "Send command is invalid") {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "object" || (!isPlainObject(value) && !Array.isArray(value)) || ancestors.has(value)) {
    invalid(errorMessage);
  }
  const copy = Array.isArray(value) ? [] : {};
  ancestors.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string"
      || !descriptor.enumerable
      || !Object.hasOwn(descriptor, "value")
      || (Array.isArray(value) && !isArrayIndex(key))) {
      invalid(errorMessage);
    }
    Object.defineProperty(copy, key, {
      value: freezeSnapshot(descriptor.value, ancestors, errorMessage),
      enumerable: true,
      configurable: false,
      writable: false
    });
  }
  ancestors.delete(value);
  return Object.freeze(copy);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isArrayIndex(key) {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < 4294967295 && String(index) === key;
}

function invalid(message, context) {
  throw new ChannelError(CHANNEL_ERROR_CODES.INVALID_CONTRACT, message, context);
}
