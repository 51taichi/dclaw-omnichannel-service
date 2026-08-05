import { CHANNEL_ERROR_CODES, ChannelError } from "../errors.js";

const TRANSITION_TIMEOUT_MS = 50_000;

export function mapWhapiHealth(payload, { transitionAgeMs = 0 } = {}) {
  const providerStatus = payload?.status?.text;
  if (typeof providerStatus !== "string" || providerStatus.length === 0) {
    throw new ChannelError(CHANNEL_ERROR_CODES.INVALID_PROVIDER_RESPONSE);
  }
  if (providerStatus === "AUTH") {
    return Object.freeze({ status: "connected", providerStatus });
  }
  if (providerStatus === "QR") {
    return Object.freeze({ status: "auth-required", providerStatus });
  }
  if (providerStatus === "INIT" || providerStatus === "LAUNCH") {
    return Object.freeze({
      status: transitionAgeMs >= TRANSITION_TIMEOUT_MS ? "disconnected" : "degraded",
      providerStatus
    });
  }
  if (providerStatus === "SYNC_ERROR") {
    return Object.freeze({ status: "degraded", providerStatus });
  }
  return Object.freeze({ status: "disconnected", providerStatus });
}
