import crypto from "node:crypto";

function digest(value, length = 32) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex")
    .slice(0, length);
}

export function buildDclawConversationIdentity({
  botId,
  conversationKey,
  conversationEpoch,
  purpose = "conversation"
}) {
  const localScope = [
    "channel-dclaw-identity-v1",
    String(botId || "").trim(),
    String(conversationKey || "").trim()
  ].join("\n");
  const epochScope = [
    localScope,
    String(conversationEpoch || "legacy").trim() || "legacy"
  ].join("\n");
  const purposeScope = [
    epochScope,
    String(purpose || "conversation").trim() || "conversation"
  ].join("\n");

  return {
    externalUserId: `ch-u-${digest(localScope, 24)}`,
    runtimeConversationId: `ch-c-${digest(epochScope, 32)}`,
    externalSessionId: `ch-s-${digest(purposeScope, 32)}`
  };
}
