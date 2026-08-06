import crypto from "node:crypto";
import { CHANNEL_ERROR_CODES, ChannelError } from "./errors.js";

export function createChannelSender({
  findAccount,
  delivery,
  legacySendText,
  legacySendMedia = null,
  idempotencyKey = () => crypto.randomUUID()
}) {
  if (typeof findAccount !== "function" || typeof delivery?.send !== "function" || typeof legacySendText !== "function") {
    throw new Error("channel sender dependencies are required");
  }
  return Object.freeze({
    async sendText({ botId, target, content, mentions = [], replyToExternalMessageId = "", metadata = {} }) {
      const account = await findAccount(botId);
      if (!account) {
        return legacySendText({ robotId: botId, targets: [target], content, atList: mentions });
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
        if (typeof legacySendMedia !== "function") throw new Error("legacy media sender is required");
        return legacySendMedia({
          robotId: botId,
          targets: [target],
          fileUrl,
          objectName: fileName,
          fileType,
          extraText: caption
        });
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
