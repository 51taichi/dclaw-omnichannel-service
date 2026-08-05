import { CHANNEL_ERROR_CODES, ChannelError } from "../errors.js";
import { assertChannelAdapter } from "../contract.js";
import { WHAPI_CAPABILITIES } from "./capabilities.js";
import { mapWhapiHealth } from "./health.js";
import { normalizeWhapiWebhook } from "./mapper.js";

const MEDIA_TYPES = new Set(["image", "video", "audio", "voice", "document"]);

export function createWhapiAdapter({ resolveAccountClient }) {
  if (typeof resolveAccountClient !== "function") throw new Error("resolveAccountClient is required");

  const clientFor = (account) => resolveAccountClient(accountId(account));
  const adapter = {
    provider: "whapi",
    capabilities: WHAPI_CAPABILITIES,
    normalizeWebhook: normalizeWhapiWebhook,
    async sendText(command) {
      const client = await clientFor(command);
      return standardSendResult(await client.sendText(messageBase(command, { body: command.text })));
    },
    async sendMedia(command) {
      if (!MEDIA_TYPES.has(command.messageType)) {
        throw new ChannelError(CHANNEL_ERROR_CODES.INVALID_CONTRACT);
      }
      const attachment = command.attachments?.[0];
      const media = attachment?.url || attachment?.media || attachment?.externalUrl;
      if (typeof media !== "string" || media.length === 0) {
        throw new ChannelError(CHANNEL_ERROR_CODES.INVALID_CONTRACT);
      }
      const client = await clientFor(command);
      return standardSendResult(await client.sendMedia(command.messageType, messageBase(command, {
        media,
        ...(command.text ? { caption: command.text } : {}),
        ...(attachment.fileName ? { filename: attachment.fileName } : {}),
        ...(attachment.mimeType ? { mime_type: attachment.mimeType } : {})
      })));
    },
    async getAccountHealth(account) {
      const client = await clientFor(account);
      return mapWhapiHealth(await client.getHealth(), { transitionAgeMs: account.transitionAgeMs || 0 });
    },
    async configureWebhook(account) {
      const client = await clientFor(account);
      const response = await client.updateSettings(account.webhookSettings);
      return Object.freeze({
        configured: true,
        changes: Array.isArray(response.changes)
          ? Object.freeze(response.changes.filter((value) => typeof value === "string"))
          : Object.freeze([])
      });
    },
    async listChats(account, options) {
      const client = await clientFor(account);
      const result = await client.listChats(options);
      return result.chats || [];
    },
    async listGroups(account, options) {
      const client = await clientFor(account);
      const result = await client.listGroups(options);
      return result.groups || [];
    },
    async getGroup(account, externalGroupId) {
      const client = await clientFor(account);
      return client.getGroup(externalGroupId);
    },
    async listGroupParticipants(account, externalGroupId) {
      const group = await adapter.getGroup(account, externalGroupId);
      return Array.isArray(group.participants) ? group.participants : [];
    }
  };
  assertChannelAdapter(adapter);
  return Object.freeze(adapter);
}

function accountId(value) {
  const id = value?.channelAccountId || value?.channelId;
  if (typeof id !== "string" || id.length === 0) throw new ChannelError(CHANNEL_ERROR_CODES.INVALID_CONTRACT);
  return id;
}

function messageBase(command, content) {
  return {
    to: command.externalChatId,
    ...content,
    ...(command.mentions?.length ? { mentions: [...command.mentions] } : {}),
    ...(command.replyToExternalMessageId ? { quoted: command.replyToExternalMessageId } : {})
  };
}

function standardSendResult(response) {
  if (typeof response?.sent !== "boolean") {
    throw new ChannelError(CHANNEL_ERROR_CODES.INVALID_PROVIDER_RESPONSE);
  }
  const externalMessageId = response.message?.id;
  if (response.sent && (typeof externalMessageId !== "string" || externalMessageId.length === 0)) {
    throw new ChannelError(CHANNEL_ERROR_CODES.INVALID_PROVIDER_RESPONSE);
  }
  return {
    accepted: response.sent,
    ...(typeof externalMessageId === "string" ? { externalMessageId } : {}),
    status: typeof response.message?.status === "string"
      ? response.message.status.toLowerCase()
      : response.sent ? "pending" : "rejected",
    providerResponse: response
  };
}
