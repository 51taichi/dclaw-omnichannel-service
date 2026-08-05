export const CHANNEL_ERROR_CODES = Object.freeze({
  INVALID_CONTRACT: "invalid_contract",
  UNKNOWN_PROVIDER: "unknown_provider",
  UNSUPPORTED_CAPABILITY: "unsupported_capability",
  AUTHENTICATION_REQUIRED: "authentication_required",
  RATE_LIMITED: "rate_limited",
  TEMPORARY_PROVIDER_FAILURE: "temporary_provider_failure",
  PERMANENT_PROVIDER_REJECTION: "permanent_provider_rejection",
  INVALID_PROVIDER_RESPONSE: "invalid_provider_response"
});

const VALID_CODES = Object.freeze(Object.values(CHANNEL_ERROR_CODES));
const SAFE_CONTEXT_FIELDS = ["provider", "channelAccountId", "operation"];
const PUBLIC_MESSAGES = Object.freeze({
  [CHANNEL_ERROR_CODES.INVALID_CONTRACT]: "Channel contract is invalid",
  [CHANNEL_ERROR_CODES.UNKNOWN_PROVIDER]: "Channel provider is unknown",
  [CHANNEL_ERROR_CODES.UNSUPPORTED_CAPABILITY]: "Channel capability is unsupported",
  [CHANNEL_ERROR_CODES.AUTHENTICATION_REQUIRED]: "Channel authentication is required",
  [CHANNEL_ERROR_CODES.RATE_LIMITED]: "Channel rate limit exceeded",
  [CHANNEL_ERROR_CODES.TEMPORARY_PROVIDER_FAILURE]: "Channel operation failed",
  [CHANNEL_ERROR_CODES.PERMANENT_PROVIDER_REJECTION]: "Channel operation was rejected",
  [CHANNEL_ERROR_CODES.INVALID_PROVIDER_RESPONSE]: "Channel provider response is invalid"
});

export class ChannelError extends Error {
  constructor(code, _message, context = {}) {
    if (!VALID_CODES.includes(code)) {
      throw new TypeError("Unknown channel error code");
    }

    const safeContext = isRecord(context) ? context : {};
    super(PUBLIC_MESSAGES[code]);
    this.name = "ChannelError";
    this.code = code;

    for (const field of SAFE_CONTEXT_FIELDS) {
      const value = ownString(safeContext, field);
      if (value !== undefined) {
        this[field] = value;
      }
    }
    const retryable = ownBoolean(safeContext, "retryable");
    if (retryable !== undefined) {
      this.retryable = retryable;
    }
    if (Object.hasOwn(safeContext, "cause")) {
      Object.defineProperty(this, "cause", {
        value: safeCause(),
        configurable: false,
        enumerable: false,
        writable: false
      });
    }
  }
}

export function toChannelError(value, context = {}) {
  const safeContext = isRecord(context) ? context : {};
  if (value instanceof ChannelError) {
    return new ChannelError(value.code, undefined, {
      provider: ownString(value, "provider") ?? ownString(safeContext, "provider"),
      channelAccountId: ownString(value, "channelAccountId") ?? ownString(safeContext, "channelAccountId"),
      operation: ownString(value, "operation") ?? ownString(safeContext, "operation"),
      retryable: ownBoolean(value, "retryable") ?? ownBoolean(safeContext, "retryable"),
      cause: value
    });
  }

  return new ChannelError(
    CHANNEL_ERROR_CODES.TEMPORARY_PROVIDER_FAILURE,
    "Channel operation failed",
    {
      provider: ownString(safeContext, "provider"),
      channelAccountId: ownString(safeContext, "channelAccountId"),
      operation: ownString(safeContext, "operation"),
      retryable: true,
      cause: value
    }
  );
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ownString(record, key) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && Object.hasOwn(descriptor, "value") && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}

function ownBoolean(record, key) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && Object.hasOwn(descriptor, "value") && typeof descriptor.value === "boolean"
    ? descriptor.value
    : undefined;
}

function safeCause() {
  return Object.freeze(new Error("Channel failure cause withheld"));
}
