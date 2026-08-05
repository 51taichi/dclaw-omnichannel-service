import { CHANNEL_CAPABILITY_KEYS, assertChannelAdapter, assertProviderId } from "./contract.js";
import { CHANNEL_ERROR_CODES, ChannelError } from "./errors.js";

const KNOWN_CAPABILITIES = new Set(CHANNEL_CAPABILITY_KEYS);

export function createChannelRegistry() {
  const adapters = new Map();

  const get = (provider) => {
    assertProviderId(provider);
    const adapter = adapters.get(provider);
    if (adapter === undefined) {
      throw new ChannelError(CHANNEL_ERROR_CODES.UNKNOWN_PROVIDER, "Channel provider is unknown", { provider });
    }
    return adapter;
  };

  return Object.freeze({
    register(adapter) {
      assertChannelAdapter(adapter);
      if (adapters.has(adapter.provider)) {
        throw new ChannelError(
          CHANNEL_ERROR_CODES.INVALID_CONTRACT,
          "Channel provider is already registered",
          { provider: adapter.provider }
        );
      }
      adapters.set(adapter.provider, adapter);
      return adapter;
    },

    unregister(provider) {
      assertProviderId(provider);
      return adapters.delete(provider);
    },

    get,

    resolve(request, requiredCapability) {
      const context = safeContext(request, requiredCapability);
      if (!isRecord(request) || typeof request.channelAccountId !== "string" || request.channelAccountId.length === 0) {
        throw new ChannelError(CHANNEL_ERROR_CODES.INVALID_CONTRACT, "Channel account identifier is invalid", context);
      }

      const adapter = get(request.provider);
      if (requiredCapability !== undefined && (!KNOWN_CAPABILITIES.has(requiredCapability) || !adapter.capabilities[requiredCapability])) {
        throw new ChannelError(
          CHANNEL_ERROR_CODES.UNSUPPORTED_CAPABILITY,
          "Channel capability is unsupported",
          context
        );
      }
      return adapter;
    },

    list() {
      return Object.freeze([...adapters.keys()].sort());
    }
  });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeContext(request, requiredCapability) {
  if (!isRecord(request)) {
    return typeof requiredCapability === "string" ? { operation: requiredCapability } : {};
  }
  return {
    ...(typeof request.provider === "string" ? { provider: request.provider } : {}),
    ...(typeof request.channelAccountId === "string" ? { channelAccountId: request.channelAccountId } : {}),
    ...(typeof requiredCapability === "string" ? { operation: requiredCapability } : {})
  };
}
