import { dedupeConversationMessages } from "./conversation-message-dedupe.js";

export const DEFAULT_HISTORY_CUSTOMER_TEXT_MAX_CHARS = 4000;
export const MIN_HISTORY_CUSTOMER_TEXT_MAX_CHARS = 1000;
export const MAX_HISTORY_CUSTOMER_TEXT_MAX_CHARS = 6000;

function unicodeLength(value) {
  return Array.from(String(value || "")).length;
}

function historyEvidenceLine(message) {
  const id = String(message?.id || "").trim();
  return id ? `[${id}] ${message.content}` : message.content;
}

export function normalizeHistoryAnalysisConfig(config = {}) {
  const rawValue = config.historyCustomerTextMaxChars;
  const isNumericValue = typeof rawValue === "number";
  const isNumericString = typeof rawValue === "string"
    && /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(rawValue.trim());
  const requested = isNumericValue || isNumericString
    ? Number(rawValue)
    : Number.NaN;
  const value = Number.isFinite(requested)
    ? Math.round(requested / 100) * 100
    : DEFAULT_HISTORY_CUSTOMER_TEXT_MAX_CHARS;
  return {
    historyCustomerTextMaxChars: Math.min(
      MAX_HISTORY_CUSTOMER_TEXT_MAX_CHARS,
      Math.max(MIN_HISTORY_CUSTOMER_TEXT_MAX_CHARS, value)
    )
  };
}

export function buildBoundedCustomerHistoryText({
  messages = [],
  maxChars = DEFAULT_HISTORY_CUSTOMER_TEXT_MAX_CHARS
} = {}) {
  const configuredLimit = Math.max(1, Math.floor(Number(maxChars) || DEFAULT_HISTORY_CUSTOMER_TEXT_MAX_CHARS));
  const normalizedCustomerMessages = (Array.isArray(messages) ? messages : [])
    .filter((message) => (
      message?.direction === "inbound"
      && message?.source === "worktool_customer_history"
    ))
    .map((message) => ({
      ...message,
      content: String(message?.content || "").trim(),
      createdAt: String(message?.createdAt || "").trim()
    }))
    .filter((message) => message.content);
  const customerMessages = dedupeConversationMessages(normalizedCustomerMessages);
  const validDates = customerMessages
    .map((message) => ({ value: message.createdAt, time: new Date(message.createdAt).getTime() }))
    .filter((item) => Number.isFinite(item.time))
    .sort((left, right) => left.time - right.time);
  const newestFirst = [...customerMessages].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime();
    const rightTime = new Date(right.createdAt).getTime();
    const safeLeft = Number.isFinite(leftTime) ? leftTime : Number.NEGATIVE_INFINITY;
    const safeRight = Number.isFinite(rightTime) ? rightTime : Number.NEGATIVE_INFINITY;
    return safeRight - safeLeft;
  });
  const selectedNewestFirst = [];
  let selectedChars = 0;
  for (const message of newestFirst) {
    const separatorChars = selectedNewestFirst.length ? 1 : 0;
    const nextChars = separatorChars + unicodeLength(historyEvidenceLine(message));
    if (selectedChars + nextChars > configuredLimit) break;
    selectedNewestFirst.push(message);
    selectedChars += nextChars;
  }
  const selectedMessages = selectedNewestFirst.reverse();
  return {
    text: selectedMessages.map(historyEvidenceLine).join("\n"),
    selectedMessages,
    selectedCount: selectedMessages.length,
    omittedCount: customerMessages.length - selectedMessages.length,
    selectedChars,
    importedCustomerCount: customerMessages.length,
    earliestCustomerAt: validDates[0]?.value || "",
    configuredLimit
  };
}
