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

const VALID_CODES = new Set(Object.values(CHANNEL_ERROR_CODES));
const SAFE_CONTEXT_FIELDS = ["provider", "channelAccountId", "operation"];

export class ChannelError extends Error {
  constructor(code, message, context = {}) {
    if (!VALID_CODES.has(code)) {
      throw new TypeError("Unknown channel error code");
    }

    const safeContext = isRecord(context) ? context : {};
    super(message);
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
        value: safeContext.cause,
        configurable: true,
        writable: true
      });
    }
  }
}

export function toChannelError(value, context = {}) {
  if (value instanceof ChannelError) {
    return value;
  }

  const safeContext = isRecord(context) ? context : {};
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
  return Object.hasOwn(record, key) && typeof record[key] === "string"
    ? record[key]
    : undefined;
}

function ownBoolean(record, key) {
  return Object.hasOwn(record, key) && typeof record[key] === "boolean"
    ? record[key]
    : undefined;
}
