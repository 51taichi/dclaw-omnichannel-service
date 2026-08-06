import crypto from "node:crypto";
import { CHANNEL_ERROR_CODES, ChannelError } from "./errors.js";

export function createChannelSender({
  findAccount,
  delivery,
  idempotencyKey = () => crypto.randomUUID()
}) {
  if (typeof findAccount !== "function" || typeof delivery?.send !== "function") {
    throw new Error("channel sender dependencies are required");
  }
  return Object.freeze({
    async sendText({ botId, target, content, mentions = [], replyToExternalMessageId = "", metadata = {} }) {
      const account = await findAccount(botId);
      if (!account) {
        missingAccount(botId, "send_text");
      }
      if (!account.enabled || account.healthStatus !== "connected") {
        throw new ChannelError(CHANNEL_ERROR_CODES.AUTHENTICATION_REQUIRED, undefined, {
          provider: account.provider,
          channelAccountId: account.channelId,
          operation: "send_text",
          retryable: false
        });
      }
      const result = await delivery.send({
        channelAccountId: account.channelId,
        externalChatId: target,
        messageType: "text",
        text: content,
        attachments: [],
        mentions: [...mentions],
        replyToExternalMessageId,
        idempotencyKey: idempotencyKey(),
        metadata: { botId, source: "core", ...metadata }
      });
      return Object.freeze({
        data: result.externalMessageId || "",
        accepted: result.accepted,
        status: result.status,
        channelResult: result
      });
    },
    async sendMedia({ botId, target, fileUrl, fileName = "", fileType, caption = "", mentions = [] }) {
      const account = await findAccount(botId);
      if (!account) {
        missingAccount(botId, "send_media");
      }
      assertConnected(account);
      const result = await delivery.send({
        channelAccountId: account.channelId,
        externalChatId: target,
        messageType: fileType === "file" ? "document" : fileType,
        text: caption,
        attachments: [{ url: fileUrl, fileName }],
        mentions: [...mentions],
        replyToExternalMessageId: "",
        idempotencyKey: idempotencyKey(),
        metadata: { botId, source: "core" }
      });
      return Object.freeze({
        data: result.externalMessageId || "",
        accepted: result.accepted,
        status: result.status,
        channelResult: result
      });
    }
  });
}

function missingAccount(botId, operation) {
  throw new ChannelError(CHANNEL_ERROR_CODES.AUTHENTICATION_REQUIRED, undefined, {
    channelAccountId: String(botId || ""),
    operation,
    retryable: false
  });
}

function assertConnected(account) {
  if (!account.enabled || account.healthStatus !== "connected") {
    throw new ChannelError(CHANNEL_ERROR_CODES.AUTHENTICATION_REQUIRED, undefined, {
      provider: account.provider,
      channelAccountId: account.channelId,
      operation: "send",
      retryable: false
    });
  }
}
