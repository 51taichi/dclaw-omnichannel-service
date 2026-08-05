import { assertInboundEvents } from "../contract.js";
import { CHANNEL_ERROR_CODES, ChannelError } from "../errors.js";

const MEDIA_TYPES = new Set(["image", "video", "audio", "voice", "document", "sticker"]);

export function normalizeWhapiWebhook({ channelAccountId, payload }) {
  if (!isRecord(payload) || typeof channelAccountId !== "string" || channelAccountId.length === 0) {
    invalidResponse();
  }
  if (typeof payload.channel_id === "string" && payload.channel_id !== channelAccountId) {
    invalidResponse();
  }
  const type = payload.event?.type;
  const action = payload.event?.event;
  if (typeof type !== "string" || typeof action !== "string") invalidResponse();

  let events;
  if (type === "messages") {
    if (!Array.isArray(payload.messages)) invalidResponse();
    events = payload.messages.map((message) => normalizeMessage(channelAccountId, action, message));
  } else if (type === "statuses") {
    if (!Array.isArray(payload.statuses)) invalidResponse();
    events = payload.statuses.map((status) => normalizeStatus(channelAccountId, action, status));
  } else if (type === "channel" && isRecord(payload.health)) {
    events = [normalizeHealth(channelAccountId, action, payload.health)];
  } else {
    return Object.freeze([]);
  }
  return assertInboundEvents(events);
}

function normalizeMessage(channelAccountId, action, message) {
  if (!isRecord(message)) invalidResponse();
  const externalId = requiredString(message.id);
  const chatId = requiredString(message.chat_id);
  const messageType = requiredString(message.type);
  const fromMe = requiredBoolean(message.from_me);
  const group = chatId.endsWith("@g.us");
  const senderId = requiredString(message.from || (group ? "" : chatId.split("@")[0]));
  const senderName = optionalString(message.from_name);
  const text = messageText(message, messageType);
  return {
    provider: "whapi",
    channelAccountId,
    eventId: `messages.${action}:${externalId}`,
    eventType: action === "delete" ? "message.deleted" : action === "put" ? "message.updated" : fromMe ? "message.sent" : "message.received",
    occurredAt: timestampToIso(message.timestamp),
    chat: {
      externalId: chatId,
      type: group ? "group" : "private",
      displayName: optionalString(message.chat_name) || (group ? "" : senderName)
    },
    sender: { externalId: senderId, displayName: senderName },
    message: {
      externalId,
      type: messageType,
      text,
      attachments: mediaAttachments(message, messageType),
      quotedMessageId: optionalString(message.context?.quoted_id),
      mentions: stringArray(message.context?.mentions),
      fromMe
    },
    rawPayload: message
  };
}

function normalizeStatus(channelAccountId, action, status) {
  if (!isRecord(status)) invalidResponse();
  const externalId = requiredString(status.id);
  const state = requiredString(status.status).toLowerCase();
  const chatId = requiredString(status.recipient_id);
  return {
    provider: "whapi",
    channelAccountId,
    eventId: `statuses.${action}:${externalId}:${state}`,
    eventType: `status.${state}`,
    occurredAt: timestampToIso(status.timestamp),
    chat: { externalId: chatId, type: chatId.endsWith("@g.us") ? "group" : "private", displayName: "" },
    sender: { externalId: optionalString(status.viewer_id) || "system", displayName: "" },
    message: {
      externalId,
      type: "status",
      text: state,
      attachments: [],
      quotedMessageId: "",
      mentions: [],
      fromMe: true
    },
    rawPayload: status
  };
}

function normalizeHealth(channelAccountId, action, health) {
  const providerStatus = requiredString(health.status?.text);
  const timestamp = health.start_at ?? Math.floor(Date.now() / 1000);
  return {
    provider: "whapi",
    channelAccountId,
    eventId: `channel.${action}:${channelAccountId}:${timestamp}:${providerStatus}`,
    eventType: "account.health",
    occurredAt: timestampToIso(timestamp),
    chat: { externalId: channelAccountId, type: "account", displayName: "" },
    sender: { externalId: "system", displayName: "" },
    message: null,
    rawPayload: health
  };
}

function messageText(message, type) {
  if (type === "text") return requiredString(message.text?.body, true);
  if (MEDIA_TYPES.has(type)) return optionalString(message[type]?.caption);
  return optionalString(message[type]?.body || message.text?.body);
}

function mediaAttachments(message, type) {
  if (!MEDIA_TYPES.has(type)) return [];
  const media = message[type];
  if (!isRecord(media)) invalidResponse();
  return [{
    externalId: requiredString(media.id),
    type,
    mimeType: optionalString(media.mime_type),
    fileName: optionalString(media.file_name),
    size: finiteNumber(media.file_size),
    checksum: optionalString(media.sha256),
    temporaryUrl: optionalString(media.link)
  }];
}

function timestampToIso(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) invalidResponse();
  const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) invalidResponse();
  return date.toISOString();
}

function stringArray(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) invalidResponse();
  return [...value];
}

function requiredString(value, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) invalidResponse();
  return value;
}

function requiredBoolean(value) {
  if (typeof value !== "boolean") invalidResponse();
  return value;
}

function optionalString(value) {
  return typeof value === "string" ? value : "";
}

function finiteNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidResponse() {
  throw new ChannelError(CHANNEL_ERROR_CODES.INVALID_PROVIDER_RESPONSE);
}
