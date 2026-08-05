import { normalizeSendCommand, assertSendResult } from "./contract.js";
import { CHANNEL_ERROR_CODES, ChannelError, toChannelError } from "./errors.js";

export function createChannelDelivery({ registry, resolveAccount } = {}) {
  return Object.freeze({
    async send(command) {
      let normalized;
      let provider;
      let operation = "send";

      try {
        normalized = normalizeSendCommand(command);
        const account = await resolveAccount(normalized.channelAccountId);
        if (!isMatchingAccount(account, normalized.channelAccountId)) {
          throw new ChannelError(
            CHANNEL_ERROR_CODES.INVALID_CONTRACT,
            "Channel account is invalid",
            { channelAccountId: normalized.channelAccountId }
          );
        }

        provider = account.provider;
        const isText = normalized.messageType === "text";
        if (isText ? normalized.text.length === 0 : normalized.attachments.length === 0) {
          throw new ChannelError(
            CHANNEL_ERROR_CODES.INVALID_CONTRACT,
            "Send command content is invalid",
            { provider, channelAccountId: normalized.channelAccountId }
          );
        }

        const capability = isText ? "text" : "media";
        operation = isText ? "sendText" : "sendMedia";
        const adapter = registry.resolve({ provider, channelAccountId: normalized.channelAccountId }, capability);
        return assertSendResult(await adapter[operation](normalized));
      } catch (error) {
        throw toChannelError(error, {
          provider,
          channelAccountId: normalized?.channelAccountId,
          operation
        });
      }
    }
  });
}

function isMatchingAccount(account, channelAccountId) {
  return account !== null
    && typeof account === "object"
    && !Array.isArray(account)
    && account.channelAccountId === channelAccountId
    && typeof account.provider === "string"
    && account.provider.length > 0;
}
