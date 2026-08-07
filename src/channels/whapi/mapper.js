import { assertInboundEvents } from "../contract.js";
import { CHANNEL_ERROR_CODES, ChannelError } from "../errors.js";

const MEDIA_TYPES = new Set([
  "image", "video", "gif", "short", "audio", "voice", "document", "documentWithCaption", "sticker"
]);

export function normalizeWhapiWebhook({ channelAccountId, payload }) {
  if (!isRecord(payload) || typeof channelAccountId !== "string" || channelAccountId.length === 0) {
    invalidResponse();
  }
  if (typeof payload.channel_id === "string" && payload.channel_id !== channelAccountId) {
    invalidResponse();
  }
  const type = payload.event?.type;
  const action = payload.event?.method || payload.event?.event;
  if (typeof type !== "string" || typeof action !== "string") invalidResponse();

  let events;
  if (type === "messages") {
    if (action === "delete") {
      const removedIdsValid = Array.isArray(payload.messages_removed)
        && payload.messages_removed.every((id) => typeof id === "string" && id.length > 0);
      const removedAllValid = typeof payload.messages_removed_all === "string"
        && payload.messages_removed_all.length > 0;
      if (!removedIdsValid && !removedAllValid) invalidResponse();
      return Object.freeze([]);
    }
    if (!Array.isArray(payload.messages)) invalidResponse();
    events = payload.messages.map((message) => normalizeMessage(channelAccountId, action, message));
  } else if (type === "statuses") {
    if (!Array.isArray(payload.statuses)) invalidResponse();
    events = payload.statuses
      .map((status) => normalizeStatus(channelAccountId, action, status))
      .filter(Boolean);
  } else if (type === "channel" && isRecord(payload.health)) {
    events = [normalizeHealth(channelAccountId, action, payload.health)];
  } else if (type === "channel" && action === "patch" && isRecord(payload.qr)) {
    events = [normalizeQr(channelAccountId, action, payload.qr)];
  } else if (type === "groups") {
    if (action === "post") {
      if (!Array.isArray(payload.groups)) invalidResponse();
      events = payload.groups.map((group) => normalizeGroup(channelAccountId, action, group));
    } else if (action === "put") {
      if (!Array.isArray(payload.groups_participants)) invalidResponse();
      events = payload.groups_participants.map((change) => normalizeGroupParticipants(channelAccountId, action, change));
    } else if (action === "patch") {
      if (Array.isArray(payload.groups_updates)) {
        events = payload.groups_updates.map((update) => {
          if (!isRecord(update) || !isRecord(update.after_update)) invalidResponse();
          return normalizeGroup(channelAccountId, action, update.after_update);
        });
      } else if (Array.isArray(payload.groups)) {
        events = payload.groups.map((group) => normalizeGroup(channelAccountId, action, group));
      } else invalidResponse();
    } else {
      return Object.freeze([]);
    }
  } else {
    return Object.freeze([]);
  }
  return assertInboundEvents(events);
}

function normalizeGroupParticipants(channelAccountId, action, change) {
  if (!isRecord(change)) invalidResponse();
  const externalId = requiredString(change.group_id);
  if (!Array.isArray(change.participants)
    || change.participants.some((id) => typeof id !== "string" || id.length === 0)) invalidResponse();
  const participantAction = requiredString(change.action);
  return {
    provider: "whapi",
    channelAccountId,
    eventId: `groups.${action}:${externalId}:${participantAction}:${change.participants.join(",")}`,
    eventType: "group.updated",
    occurredAt: new Date().toISOString(),
    chat: { externalId, type: "group", displayName: "" },
    sender: { externalId: "system", displayName: "" },
    message: null,
    rawPayload: {
      ...change,
      participant_delta: ["add", "remove", "promote", "demote"].includes(participantAction)
    }
  };
}

function normalizeGroup(channelAccountId, action, group) {
  if (!isRecord(group)) invalidResponse();
  const externalId = requiredString(group.id || group.chat_id);
  const displayName = optionalString(group.name || group.subject || group.chat_name);
  const eventType = action === "post" ? "group.created" : "group.updated";
  return {
    provider: "whapi",
    channelAccountId,
    eventId: `groups.${action}:${externalId}`,
    eventType,
    occurredAt: timestampToIso(group.timestamp ?? group.updated_at ?? Math.floor(Date.now() / 1000)),
    chat: { externalId, type: "group", displayName },
    sender: { externalId: "system", displayName: "" },
    message: null,
    rawPayload: group
  };
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
  if (state === "deleted") return null;
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

function normalizeQr(channelAccountId, action, qr) {
  const status = requiredString(qr.status);
  const occurredAt = new Date().toISOString();
  return {
    provider: "whapi",
    channelAccountId,
    eventId: `channel.${action}:${channelAccountId}:qr:${status}:${qr.expire ?? ""}`,
    eventType: "account.health",
    occurredAt,
    chat: { externalId: channelAccountId, type: "account", displayName: "" },
    sender: { externalId: "system", displayName: "" },
    message: null,
    rawPayload: { status: { text: "QR" }, qr }
  };
}

function messageText(message, type) {
  if (type === "text") return requiredString(message.text?.body, true);
  if (MEDIA_TYPES.has(type)) return optionalString(message[mediaContentKey(type)]?.caption);
  return optionalString(message[type]?.body || message.text?.body);
}

function mediaAttachments(message, type) {
  if (!MEDIA_TYPES.has(type)) return [];
  const media = message[mediaContentKey(type)];
  if (!isRecord(media)) invalidResponse();
  return [{
    externalId: requiredString(media.id),
    type: type === "documentWithCaption" ? "document" : type,
    mimeType: optionalString(media.mime_type),
    fileName: optionalString(media.file_name),
    size: finiteNumber(media.file_size),
    checksum: optionalString(media.sha256),
    temporaryUrl: optionalString(media.link)
  }];
}

function mediaContentKey(type) {
  return type === "documentWithCaption" ? "document" : type;
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
