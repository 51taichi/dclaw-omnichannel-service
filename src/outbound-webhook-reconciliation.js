import { channelConversationKey } from "./channels/core-message-bridge.js";

const DELIVERY_STATUSES = new Set([
  "pending",
  "sent",
  "delivered",
  "read",
  "played",
  "failed"
]);

const ATTACHMENT_LABELS = Object.freeze({
  image: "图片",
  video: "视频",
  gif: "视频",
  short: "视频",
  audio: "音频",
  voice: "音频",
  document: "文件",
  sticker: "文件"
});

function readableAttachmentPlaceholder(attachments = []) {
  const attachment = Array.isArray(attachments) ? attachments[0] : null;
  if (!attachment) return "";
  const label = ATTACHMENT_LABELS[attachment.type] || "附件";
  const name = String(attachment.fileName || "").trim();
  return `[${label}]${name ? ` ${name}` : ""}`;
}

function normalizedInitialStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return DELIVERY_STATUSES.has(status) ? status : "sent";
}

export function outboundWebhookRecord({ botId, event }) {
  if (event?.eventType !== "message.sent" || event?.message?.fromMe !== true) return null;
  const content = String(event.message.text || "").trim()
    || readableAttachmentPlaceholder(event.message.attachments);
  if (!content) return null;
  return {
    botId: String(botId || "").trim(),
    provider: event.provider,
    channelAccountId: event.channelAccountId,
    conversationKey: channelConversationKey(event),
    messageId: event.message.externalId,
    content,
    occurredAt: event.occurredAt,
    deliveryStatus: normalizedInitialStatus(event.rawPayload?.status),
    rawPayload: event.rawPayload
  };
}

export function reconcileOutboundWebhookMessage({ botId, event, senderName, persist }) {
  const record = outboundWebhookRecord({ botId, event });
  if (!record) {
    return {
      outcome: "ignored",
      conversationMessageId: null,
      outgoingInserted: false
    };
  }
  return persist({ ...record, senderName });
}
