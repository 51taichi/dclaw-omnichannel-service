import { isSystemFriendGreeting } from "./message-rules.js";

export function isLegacyCustomerCandidate({
  message,
  binding,
  hadConversation = false,
  hadFlowSession = false
}) {
  const roomType = Number(message?.roomType);
  return Boolean(
    binding?.enabled &&
    (roomType === 2 || roomType === 4) &&
    !hadConversation &&
    !hadFlowSession &&
    !isSystemFriendGreeting(message)
  );
}

export function createKeyedSingleFlight() {
  const flights = new Map();
  return {
    has(key) {
      return flights.has(key);
    },
    run(key, task) {
      if (flights.has(key)) return flights.get(key);
      let operation;
      try {
        operation = Promise.resolve(task());
      } catch (error) {
        operation = Promise.reject(error);
      }
      const tracked = operation.finally(() => {
        if (flights.get(key) === tracked) flights.delete(key);
      });
      flights.set(key, tracked);
      return tracked;
    }
  };
}

function normalizeContextMessage(message) {
  const content = String(message?.content || "").trim();
  const createdAt = String(message?.createdAt || "").trim();
  if (!content || !createdAt) return null;
  return {
    direction: message?.direction === "outbound" ? "outbound" : "inbound",
    senderName: String(message?.senderName || message?.targetName || ""),
    content,
    createdAt,
    source: String(message?.source || "")
  };
}

export function buildLegacyHistoryContext({
  customerMessages = [],
  localMessages = [],
  cachedApiMessages = [],
  maxMessages = 200,
  maxChars = 30_000
}) {
  const seen = new Set();
  const groups = [customerMessages, localMessages, cachedApiMessages];
  const uniqueGroups = groups.map((group) => {
    const normalized = [];
    for (const raw of group) {
      const message = normalizeContextMessage(raw);
      if (!message) continue;
      const key = `${message.direction}\u0000${message.createdAt}\u0000${message.content}`;
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push(message);
    }
    return normalized.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  const selected = [];
  let chars = 0;
  const normalizedMaxMessages = Math.max(1, Number(maxMessages) || 200);
  const normalizedMaxChars = Math.max(1, Number(maxChars) || 30_000);
  for (const group of uniqueGroups) {
    for (const message of group) {
      if (selected.length >= normalizedMaxMessages) break;
      if (chars + message.content.length > normalizedMaxChars) continue;
      selected.push(message);
      chars += message.content.length;
    }
  }
  selected.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    messages: selected,
    importedCustomerCount: uniqueGroups[0].length,
    includedCount: selected.length,
    truncated: selected.length < seen.size
  };
}
