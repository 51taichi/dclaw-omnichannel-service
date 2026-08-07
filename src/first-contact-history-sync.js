import {
  claimFirstContactHistorySync,
  completeFirstContactHistorySync,
  ensureFirstDiscoveryDateTag,
  insertImportedConversationMessages
} from "./db.js";
import { normalizeWhapiHistoryMessage } from "./channels/whapi/mapper.js";

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 20;
const DEFAULT_MAX_MESSAGES = 2_000;

const ATTACHMENT_LABELS = Object.freeze({
  image: "[图片]",
  video: "[视频]",
  audio: "[音频]",
  voice: "[语音]",
  document: "[文件]",
  sticker: "[贴纸]"
});

export async function syncFirstContactHistory({
  botId,
  agentId,
  conversationKey,
  channelAccountId,
  chatId,
  currentMessage,
  client,
  owner,
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = DEFAULT_MAX_PAGES,
  maxMessages = DEFAULT_MAX_MESSAGES,
  leaseMs = 60_000,
  prepareConversation = async () => {},
  dependencies = {}
}) {
  const claimSync = dependencies.claimSync || claimFirstContactHistorySync;
  const completeSync = dependencies.completeSync || completeFirstContactHistorySync;
  const importMessages = dependencies.importMessages || insertImportedConversationMessages;
  const ensureDateTag = dependencies.ensureDateTag || ensureFirstDiscoveryDateTag;
  const claimed = claimSync({ botId, conversationKey, owner, leaseMs });
  if (!claimed?.claimed) {
    return { claimed: false, status: claimed?.record?.status || "processing" };
  }

  const liveOccurredAt = validIso(currentMessage?.occurredAt) || new Date().toISOString();
  let pageCount = 0;
  try {
    await prepareConversation();
    const normalized = [];
    for (let page = 0; page < maxPages && normalized.length < maxMessages; page += 1) {
      const response = await client.listMessagesByChat(chatId, {
        count: pageSize,
        offset: page * pageSize,
        sort: "asc"
      });
      if (!response || !Array.isArray(response.messages)) {
        const error = new Error("invalid history response");
        error.code = "invalid_provider_response";
        throw error;
      }
      pageCount += 1;
      for (const message of response.messages) {
        if (normalized.length >= maxMessages) break;
        if (message?.chat_id !== chatId || String(message.chat_id).endsWith("@g.us")) {
          const error = new Error("history chat mismatch");
          error.code = "invalid_provider_response";
          throw error;
        }
        normalized.push(normalizeWhapiHistoryMessage({ channelAccountId, message }));
      }
      const total = Number(response.total);
      if (response.messages.length === 0
        || response.messages.length < pageSize
        || (Number.isFinite(total) && normalized.length >= total)) break;
    }

    const rows = normalized
      .filter((event) => event.message.externalId !== currentMessage?.messageId)
      .map((event) => toImportedMessage(event, liveOccurredAt));
    const imported = importMessages({
      botId,
      conversationKey,
      source: "whapi_chat_history",
      messages: rows
    });
    const importedCount = Number(imported?.inserted ?? imported ?? 0);
    const earliestAt = earliestIso([
      liveOccurredAt,
      ...normalized.map((event) => event.occurredAt)
    ]);
    ensureDateTag({ botId, agentId, conversationKey, firstSeenAt: earliestAt });
    const status = rows.length > 0 ? "success" : "unavailable";
    const result = { status, pageCount, importedCount, earliestAt };
    completeSync({ botId, conversationKey, owner, ...result, errorMessage: "" });
    return result;
  } catch (error) {
    const errorMessage = safeErrorCode(error);
    ensureDateTag({ botId, agentId, conversationKey, firstSeenAt: liveOccurredAt });
    const result = {
      status: "failed",
      pageCount,
      importedCount: 0,
      earliestAt: liveOccurredAt,
      errorMessage
    };
    completeSync({ botId, conversationKey, owner, ...result });
    return result;
  }
}

function toImportedMessage(event, fallbackOccurredAt) {
  const type = event.message.type;
  return {
    sourceKey: event.message.externalId,
    direction: event.message.fromMe ? "outbound" : "inbound",
    senderName: event.sender.displayName,
    content: event.message.text || ATTACHMENT_LABELS[type] || `[${type || "消息"}]`,
    createdAt: validIso(event.occurredAt) || fallbackOccurredAt,
    rawPayload: {
      source: "whapi_chat_history",
      provider: "whapi",
      channelAccountId: event.channelAccountId,
      messageId: event.message.externalId,
      attachments: event.message.attachments,
      whapi: event.rawPayload
    }
  };
}

function validIso(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function earliestIso(values) {
  return values.map(validIso).filter(Boolean).sort()[0] || new Date().toISOString();
}

function safeErrorCode(error) {
  const code = String(error?.code || error?.name || "history_sync_failed").trim();
  return code.slice(0, 160) || "history_sync_failed";
}
