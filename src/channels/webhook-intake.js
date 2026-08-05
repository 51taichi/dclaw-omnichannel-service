import crypto from "node:crypto";

const SECRET_HEADER = "x-dclaw-webhook-secret";

export function createWebhookIntake({ resolveAccount, verifySecret, recordEvent }) {
  if (typeof resolveAccount !== "function" || typeof verifySecret !== "function" || typeof recordEvent !== "function") {
    throw new Error("webhook intake dependencies are required");
  }
  return Object.freeze({
    handle({ publicId, method, headers = {}, body }) {
      const account = resolveAccount(publicId);
      const suppliedSecret = headerValue(headers, SECRET_HEADER);
      if (!account || !verifySecret(suppliedSecret, account.webhookSecretHash)) {
        throw authenticationFailure();
      }
      if (!account.enabled) {
        return Object.freeze({ accepted: true, duplicate: false, disabled: true });
      }
      if (!isRecord(body)) throw invalidPayload();
      if (typeof body.channel_id === "string" && body.channel_id !== account.channelId) {
        throw authenticationFailure();
      }
      const identity = webhookIdentityParts({
        provider: account.provider,
        channelAccountId: account.channelId,
        method,
        body
      });
      const result = recordEvent({
        provider: account.provider,
        botId: account.botId,
        channelAccountId: account.channelId,
        eventKind: identity.eventKind,
        method: String(method || "").toUpperCase(),
        externalId: identity.externalId,
        idempotencyKey: identity.idempotencyKey,
        payload: body
      });
      return Object.freeze({ accepted: true, duplicate: !result.inserted });
    }
  });
}

export function deriveWebhookIdentity({ provider, channelAccountId, method, body }) {
  return webhookIdentityParts({ provider, channelAccountId, method, body }).idempotencyKey;
}

function webhookIdentityParts({ provider, channelAccountId, method, body }) {
  const type = stringValue(body?.event?.type) || "unknown";
  const action = stringValue(body?.event?.event) || String(method || "unknown").toLowerCase();
  const eventKind = `${type}.${action}`;
  const externalId = firstExternalId(body, type);
  const stableId = externalId || crypto.createHash("sha256").update(stableJson(body)).digest("hex");
  return {
    eventKind,
    externalId,
    idempotencyKey: `${provider}:${channelAccountId}:${eventKind}:${stableId}`
  };
}

function firstExternalId(body, type) {
  const candidates = [body?.[type], body?.messages, body?.statuses, body?.groups];
  for (const candidate of candidates) {
    const value = Array.isArray(candidate) ? candidate[0] : candidate;
    for (const key of ["id", "message_id", "group_id"]) {
      const id = stringValue(value?.[key]);
      if (id) return id;
    }
  }
  return "";
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function headerValue(headers, name) {
  if (typeof headers.get === "function") return headers.get(name) || "";
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  const value = key ? headers[key] : "";
  return Array.isArray(value) ? value[0] || "" : String(value || "");
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function authenticationFailure() {
  return Object.assign(new Error("Webhook authentication failed"), { status: 401 });
}

function invalidPayload() {
  return Object.assign(new Error("Webhook payload is invalid"), { status: 400 });
}
