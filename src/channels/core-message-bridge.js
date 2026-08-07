import { CHANNEL_ERROR_CODES, ChannelError } from "./errors.js";

const TEXT_TYPES = Object.freeze({
  text: 1,
  image: 2,
  audio: 3,
  voice: 3,
  video: 4,
  gif: 4,
  short: 4,
  document: 5,
  sticker: 5
});

export function channelConversationKey(event) {
  const provider = requiredString(event?.provider);
  const accountId = requiredString(event?.channelAccountId);
  const chatType = event?.chat?.type;
  if (chatType !== "private" && chatType !== "group") invalid();
  const chatId = requiredString(event.chat.externalId);
  return `${provider}:${accountId}:${chatType}:${chatId}`;
}

export function toCoreMessage(event) {
  if (!event?.message || event.message.fromMe || !event.eventType?.startsWith("message.")) return null;
  const conversationKey = channelConversationKey(event);
  const attachment = event.message.attachments?.[0] || {};
  const group = event.chat.type === "group";
  const displayName = event.sender.displayName || event.sender.externalId;
  const type = event.message.type;
  return {
    messageId: event.message.externalId,
    roomType: group ? 1 : 2,
    textType: TEXT_TYPES[type] || 1,
    receivedName: displayName,
    groupName: group ? event.chat.displayName : "",
    spoken: event.message.text || "",
    rawSpoken: event.message.text || "",
    fileType: mediaCoreType(type),
    fileUrl: attachment.temporaryUrl || "",
    fileName: attachment.fileName || "",
    atMe: event.message.mentions?.length ? "true" : "false",
    metadata: {
      provider: event.provider,
      channelAccountId: event.channelAccountId,
      externalChatId: event.chat.externalId,
      externalSenderId: event.sender.externalId,
      conversationKey,
      occurredAt: event.occurredAt,
      quotedMessageId: event.message.quotedMessageId,
      mentions: [...event.message.mentions]
    },
    channelEvent: event
  };
}

function mediaCoreType(type) {
  if (type === "document" || type === "sticker") return "file";
  return ["image", "audio", "voice", "video", "gif", "short"].includes(type)
    ? type === "voice" ? "audio" : ["gif", "short"].includes(type) ? "video" : type
    : "";
}

function requiredString(value) {
  if (typeof value !== "string" || value.length === 0) invalid();
  return value;
}

function invalid() {
  throw new ChannelError(CHANNEL_ERROR_CODES.INVALID_CONTRACT);
}
