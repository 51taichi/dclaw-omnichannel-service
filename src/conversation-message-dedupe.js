const importedSources = new Set([
  "worktool_customer_history",
  "worktool_api_history"
]);

const sourceRank = new Map([
  ["local", 0],
  ["worktool_customer_history", 1],
  ["worktool_api_history", 2]
]);

export function normalizeConversationMessageContent(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function messageTime(message) {
  const value = Date.parse(message?.createdAt || "");
  return Number.isFinite(value) ? value : null;
}

function stableId(message) {
  const value = Number(message?.id);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function compareChronologically(left, right) {
  const leftTime = messageTime(left);
  const rightTime = messageTime(right);
  if (leftTime !== null && rightTime !== null) {
    return leftTime - rightTime || stableId(left) - stableId(right);
  }
  const textOrder = String(left?.createdAt || "")
    .localeCompare(String(right?.createdAt || ""));
  return textOrder || stableId(left) - stableId(right);
}

function candidateWins(candidate, existing, preferredMessageId) {
  if (stableId(candidate) === preferredMessageId) return true;
  if (stableId(existing) === preferredMessageId) return false;
  const candidateRank = sourceRank.get(candidate?.source) ?? 3;
  const existingRank = sourceRank.get(existing?.source) ?? 3;
  return candidateRank < existingRank
    || (candidateRank === existingRank && stableId(candidate) < stableId(existing));
}

export function areConversationMessagesDuplicates(left, right) {
  if (!left || !right) return false;
  if (String(left.botId || "") !== String(right.botId || "")) return false;
  if (
    String(left.conversationKey || "")
    !== String(right.conversationKey || "")
  ) return false;
  if (left.direction !== right.direction) return false;
  if (
    normalizeConversationMessageContent(left.content)
    !== normalizeConversationMessageContent(right.content)
  ) return false;

  const leftImported = importedSources.has(left.source);
  const rightImported = importedSources.has(right.source);
  if (!leftImported && !rightImported) return false;

  const leftTime = messageTime(left);
  const rightTime = messageTime(right);
  if (leftTime === null || rightTime === null) return false;

  const delta = Math.abs(leftTime - rightTime);
  if (leftImported && rightImported) {
    return left.source === right.source ? delta === 0 : delta <= 3_000;
  }
  return delta <= 10_000;
}

export function dedupeConversationMessages(
  messages,
  { preferredMessageId = null } = {}
) {
  const canonical = [];
  const preferredId = Number(preferredMessageId);
  for (const candidate of [...(messages || [])].sort(compareChronologically)) {
    const duplicateIndex = canonical.findIndex(
      (existing) => areConversationMessagesDuplicates(existing, candidate)
    );
    if (duplicateIndex < 0) {
      canonical.push(candidate);
      continue;
    }
    if (candidateWins(candidate, canonical[duplicateIndex], preferredId)) {
      canonical[duplicateIndex] = candidate;
    }
  }
  return canonical.sort(compareChronologically);
}
