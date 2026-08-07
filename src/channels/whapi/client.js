import { CHANNEL_ERROR_CODES, ChannelError } from "../errors.js";

const DEFAULT_BASE_URL = "https://gate.whapi.cloud";
const DEFAULT_TIMEOUT_MS = 15_000;
const MEDIA_TYPES = new Set(["image", "video", "audio", "voice", "document"]);

export function createWhapiClient({
  token,
  fetchImpl = fetch,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  channelAccountId = ""
}) {
  if (typeof token !== "string" || token.length === 0) throw new Error("Whapi token is required");
  if (typeof fetchImpl !== "function") throw new Error("fetchImpl is required");
  const normalizedBaseUrl = String(baseUrl).replace(/\/$/, "");

  const request = async (operation, path, { method = "GET", body, query } = {}) => {
    const url = new URL(`${normalizedBaseUrl}${path}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await fetchImpl(url.toString(), {
        method,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch (cause) {
      throw channelFailure(CHANNEL_ERROR_CODES.TEMPORARY_PROVIDER_FAILURE, operation, channelAccountId, true, cause);
    }

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (cause) {
      throw channelFailure(CHANNEL_ERROR_CODES.INVALID_PROVIDER_RESPONSE, operation, channelAccountId, false, cause);
    }
    if (!response.ok) {
      const [code, retryable] = classifyStatus(response.status);
      throw channelFailure(code, operation, channelAccountId, retryable);
    }
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      throw channelFailure(CHANNEL_ERROR_CODES.INVALID_PROVIDER_RESPONSE, operation, channelAccountId, false);
    }
    return data;
  };

  return Object.freeze({
    getHealth: () => request("health", "/health"),
    getSettings: () => request("get_webhook", "/settings"),
    updateSettings: (settings) => request("configure_webhook", "/settings", { method: "PATCH", body: settings }),
    sendText: (message) => request("send_text", "/messages/text", { method: "POST", body: message }),
    sendMedia(type, message) {
      if (!MEDIA_TYPES.has(type)) throw new Error("unsupported Whapi media type");
      return request(`send_${type}`, `/messages/${type}`, { method: "POST", body: message });
    },
    listChats: (options = {}) => request("list_chats", "/chats", { query: pagination(options) }),
    listMessagesByChat: (chatId, options = {}) => request(
      "list_messages_by_chat",
      `/messages/list/${encodeURIComponent(requiredId(chatId, "chatId"))}`,
      { query: { ...pagination(options), sort: options.sort } }
    ),
    listGroups: (options = {}) => request("list_groups", "/groups", { query: pagination(options) }),
    getGroup: (groupId) => request("get_group", `/groups/${encodeURIComponent(requiredId(groupId, "groupId"))}`),
    createGroup: (group) => request("create_group", "/groups", { method: "POST", body: group }),
    addGroupParticipants: (groupId, participants) => request(
      "add_group_participants",
      `/groups/${encodeURIComponent(requiredId(groupId, "groupId"))}/participants`,
      { method: "POST", body: { participants } }
    )
  });
}

function pagination(options) {
  return { count: options.count, offset: options.offset };
}

function requiredId(value, name) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function classifyStatus(status) {
  if (status === 401) return [CHANNEL_ERROR_CODES.AUTHENTICATION_REQUIRED, false];
  if (status === 429) return [CHANNEL_ERROR_CODES.RATE_LIMITED, true];
  if (status >= 500) return [CHANNEL_ERROR_CODES.TEMPORARY_PROVIDER_FAILURE, true];
  return [CHANNEL_ERROR_CODES.PERMANENT_PROVIDER_REJECTION, false];
}

function channelFailure(code, operation, channelAccountId, retryable, cause) {
  return new ChannelError(code, undefined, {
    provider: "whapi",
    ...(channelAccountId ? { channelAccountId } : {}),
    operation,
    retryable,
    ...(cause === undefined ? {} : { cause })
  });
}
