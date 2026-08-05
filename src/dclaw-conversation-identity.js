import crypto from "node:crypto";

function digest(value, length = 32) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex")
    .slice(0, length);
}

export function buildDclawGroupHistoryId({ botId, groupId }) {
  const scope = [
    "worktool-dclaw-group-history-v1",
    String(botId || "").trim(),
    String(groupId || "").trim()
  ].join("\n");
  if (!String(botId || "").trim()) throw new Error("botId is required");
  if (!String(groupId || "").trim()) throw new Error("groupId is required");
  return `wt-g-${digest(scope, 32)}`;
}

export function buildDclawConversationIdentity({
  botId,
  conversationKey,
  conversationEpoch,
  purpose = "conversation"
}) {
  const localScope = [
    "worktool-dclaw-identity-v1",
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
    externalUserId: `wt-u-${digest(localScope, 24)}`,
    runtimeConversationId: `wt-c-${digest(epochScope, 32)}`,
    externalSessionId: `wt-s-${digest(purposeScope, 32)}`
  };
}
