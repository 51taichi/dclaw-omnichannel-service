import { buildDclawGroupHistoryId } from "./dclaw-conversation-identity.js";

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_ATTEMPTS = 2;
const MAX_BATCH_MESSAGES = 200;
const MAX_BATCH_BYTES = 1_000_000;
const MAX_CONTENT_CHARS = 20000;
const SAFE_METADATA_KEYS = new Set([
  "sourceMessageId",
  "fileName",
  "fileType",
  "textType",
  "ocrText",
  "transcript"
]);

export { buildDclawGroupHistoryId };

export function buildDclawGroupHistoryUrl(binding, externalGroupId) {
  const agentApiUrl = requiredText(binding?.agentApiUrl, "DClaw agentApiUrl");
  const groupId = requiredText(externalGroupId, "externalGroupId");
  const url = new URL(agentApiUrl);
  if (!/\/messages\/?$/.test(url.pathname)) {
    throw new Error("DClaw agentApiUrl must end with /messages");
  }
  url.pathname = `${url.pathname.replace(/\/messages\/?$/, "")}/group-histories/${encodeURIComponent(groupId)}/messages`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function probeDclawGroupHistoryCapability({
  binding,
  fetchImpl = globalThis.fetch,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
}) {
  const url = new URL(buildDclawGroupHistoryUrl(binding, "__worktool_capability_probe__"));
  url.searchParams.set("limit", "1");
  const response = await requestWithRetry({
    binding,
    url: url.toString(),
    method: "GET",
    fetchImpl,
    signal,
    timeoutMs,
    maxAttempts
  });
  if (response.status === 401) return { ready: false, status: 401, reason: "unauthorized" };
  if (response.status === 403) return { ready: false, status: 403, reason: "forbidden" };
  if (response.status === 404) return { ready: false, status: 404, reason: "unavailable" };
  const data = await requireJsonResponse(response);
  if (!response.ok) throw responseError(response, data);
  normalizeHistoryPage(data);
  return { ready: true, status: response.status, reason: "" };
}

export async function appendDclawGroupHistory({
  binding,
  externalGroupId,
  messages,
  fetchImpl = globalThis.fetch,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
}) {
  requireBinding(binding);
  const normalized = normalizeHistoryMessages(messages);
  const batches = packAppendBatches(normalized);
  const url = buildDclawGroupHistoryUrl(binding, externalGroupId);
  let historyId = "";
  let inserted = 0;
  let duplicates = 0;
  for (const batch of batches) {
    const response = await requestWithRetry({
      binding,
      url,
      method: "POST",
      body: JSON.stringify({ messages: batch }),
      fetchImpl,
      signal,
      timeoutMs,
      maxAttempts
    });
    const data = await requireJsonResponse(response);
    if (!response.ok) throw responseError(response, data);
    const nextHistoryId = requiredText(data?.history_id, "history_id");
    if (historyId && historyId !== nextHistoryId) {
      throw new Error("DClaw group history response changed history_id across batches");
    }
    historyId = nextHistoryId;
    inserted += nonNegativeInteger(data?.inserted, "inserted");
    duplicates += nonNegativeInteger(data?.duplicates, "duplicates");
  }
  return { historyId, inserted, duplicates, batches: batches.length };
}

export async function listDclawGroupHistory({
  binding,
  externalGroupId,
  from = "",
  until = "",
  after = "",
  limit = 500,
  fetchImpl = globalThis.fetch,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
}) {
  requireBinding(binding);
  const pageLimit = Number(limit);
  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 500) {
    throw new Error("limit must be between 1 and 500");
  }
  const url = new URL(buildDclawGroupHistoryUrl(binding, externalGroupId));
  if (from) url.searchParams.set("from", new Date(from).toISOString());
  if (until) url.searchParams.set("until", new Date(until).toISOString());
  if (after) url.searchParams.set("after", String(after));
  url.searchParams.set("limit", String(pageLimit));
  const response = await requestWithRetry({
    binding,
    url: url.toString(),
    method: "GET",
    fetchImpl,
    signal,
    timeoutMs,
    maxAttempts
  });
  const data = await requireJsonResponse(response);
  if (!response.ok) throw responseError(response, data);
  return normalizeHistoryPage(data);
}

function packAppendBatches(messages) {
  const batches = [];
  let current = [];
  for (const message of messages) {
    const candidate = [...current, message];
    const candidateBody = JSON.stringify({ messages: candidate });
    if (
      current.length &&
      (candidate.length > MAX_BATCH_MESSAGES || Buffer.byteLength(candidateBody, "utf8") > MAX_BATCH_BYTES)
    ) {
      batches.push(current);
      current = [message];
    } else {
      current = candidate;
    }
    const currentBytes = Buffer.byteLength(JSON.stringify({ messages: current }), "utf8");
    if (currentBytes > MAX_BATCH_BYTES) {
      throw new Error("one DClaw group history message exceeds the append batch limit");
    }
  }
  if (current.length) batches.push(current);
  return batches;
}

function normalizeHistoryMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    throw new Error("messages must be a non-empty array");
  }
  return messages.map((message) => {
    const direction = requiredText(message?.direction, "direction");
    if (!new Set(["inbound", "outbound"]).has(direction)) {
      throw new Error("direction must be inbound or outbound");
    }
    const content = String(message?.content || "");
    if (content.length > MAX_CONTENT_CHARS) throw new Error("content is too long");
    const occurredAt = new Date(message?.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) throw new Error("occurredAt must be a valid datetime");
    return {
      external_message_id: boundedRequiredText(message?.externalMessageId, "externalMessageId", 160),
      occurred_at: occurredAt.toISOString(),
      sender_id: boundedText(message?.senderId, 200),
      sender_name: boundedRequiredText(message?.senderName, "senderName", 300),
      participant_role_id: boundedText(message?.participantRoleId, 160),
      direction,
      source: boundedRequiredText(message?.source, "source", 100),
      message_type: boundedRequiredText(message?.messageType, "messageType", 80),
      content,
      metadata: safeMetadata(message?.metadata)
    };
  });
}

function safeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (!SAFE_METADATA_KEYS.has(key)) continue;
    if (typeof item === "string") result[key] = item.slice(0, MAX_CONTENT_CHARS);
    else if (typeof item === "number" || typeof item === "boolean" || item === null) result[key] = item;
  }
  return result;
}

function normalizeHistoryPage(data) {
  if (!Array.isArray(data?.messages)) throw new Error("DClaw group history messages must be an array");
  return {
    messages: data.messages.map((message) => ({
      externalMessageId: requiredText(message?.external_message_id, "external_message_id"),
      occurredAt: requiredText(message?.occurred_at, "occurred_at"),
      senderId: String(message?.sender_id || ""),
      senderName: requiredText(message?.sender_name, "sender_name"),
      participantRoleId: String(message?.participant_role_id || ""),
      direction: requiredText(message?.direction, "direction"),
      source: requiredText(message?.source, "source"),
      messageType: requiredText(message?.message_type, "message_type"),
      content: String(message?.content || ""),
      metadata: message?.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
        ? message.metadata
        : {}
    })),
    nextCursor: data?.next_cursor ? String(data.next_cursor) : "",
    hasMore: data?.has_more === true
  };
}

async function requestWithRetry({
  binding,
  url,
  method,
  body,
  fetchImpl,
  signal,
  timeoutMs,
  maxAttempts
}) {
  requireBinding(binding);
  const attempts = Math.max(1, Math.floor(Number(maxAttempts) || 1));
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const requestSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs);
      const response = await fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${binding.agentApiKey}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {})
        },
        ...(body ? { body } : {}),
        signal: requestSignal
      });
      if (isRetryableStatus(response.status) && attempt < attempts) continue;
      return response;
    } catch (error) {
      lastError = error;
      if (!isRetryableTransportError(error) || attempt >= attempts) throw error;
    }
  }
  throw lastError;
}

async function requireJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`DClaw group history returned invalid JSON (${response.status})`);
  }
}

function responseError(response, data) {
  const detail = typeof data?.detail === "string" ? data.detail : JSON.stringify(data);
  const error = new Error(`DClaw group history failed: ${response.status} ${detail}`);
  error.status = response.status;
  return error;
}

function isRetryableStatus(status) {
  return new Set([502, 503, 504]).has(Number(status));
}

function isRetryableTransportError(error) {
  const name = String(error?.name || "");
  const message = String(error?.message || "").toLowerCase();
  return error instanceof TypeError || name === "AbortError" || name === "TimeoutError" || message.includes("timeout") || message.includes("network");
}

function requireBinding(binding) {
  requiredText(binding?.agentApiUrl, "DClaw agentApiUrl");
  requiredText(binding?.agentApiKey, "DClaw agentApiKey");
}

function requiredText(value, field) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function boundedRequiredText(value, field, maxLength) {
  const text = requiredText(value, field);
  if (text.length > maxLength) throw new Error(`${field} is too long`);
  return text;
}

function boundedText(value, maxLength) {
  const text = String(value || "");
  if (text.length > maxLength) throw new Error("history field is too long");
  return text;
}

function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${field} must be a non-negative integer`);
  return number;
}
