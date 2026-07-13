import crypto from "node:crypto";

const keyHashPrefix = "scrypt";
const defaultSessionTtlMs = Number(process.env.BOT_SESSION_TTL_HOURS || 8) * 60 * 60 * 1000;
const botSessions = new Map();

export function hashAccessKey(accessKey) {
  const value = String(accessKey || "");
  if (!value) throw new Error("accessKey is required");
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(value, salt, 32).toString("hex");
  return `${keyHashPrefix}:${salt}:${hash}`;
}

export function verifyAccessKey(accessKey, storedHash) {
  const value = String(accessKey || "");
  const hashText = String(storedHash || "");
  if (!value || !hashText) return false;
  const [prefix, salt, expected] = hashText.split(":");
  if (prefix !== keyHashPrefix || !salt || !expected) return false;
  const actual = crypto.scryptSync(value, salt, 32);
  const expectedBuffer = Buffer.from(expected, "hex");
  if (actual.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actual, expectedBuffer);
}

export function createBotSession({ botId, role, ttlMs = defaultSessionTtlMs }) {
  const normalizedRole = role === "admin" ? "admin" : "bot";
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const session = {
    token,
    botId,
    role: normalizedRole,
    expiresAt
  };
  botSessions.set(token, session);
  return session;
}

export function getBotSession(token) {
  const session = botSessions.get(String(token || ""));
  if (!session) return null;
  if (Date.parse(session.expiresAt) <= Date.now()) {
    botSessions.delete(session.token);
    return null;
  }
  return session;
}

export function deleteBotSession(token) {
  return botSessions.delete(String(token || ""));
}

export function deleteBotSessionsForBot(botId) {
  const normalizedBotId = String(botId || "");
  let removed = 0;
  for (const [token, session] of botSessions.entries()) {
    if (session.botId === normalizedBotId) {
      botSessions.delete(token);
      removed += 1;
    }
  }
  return removed;
}

export function publicBotView(binding) {
  return {
    botId: binding.botId,
    botName: binding.botName || "",
    agentId: binding.agentId || "",
    agentName: binding.agentName || "",
    enabled: Boolean(binding.enabled),
    hasAccessKey: Boolean(binding.accessKeyHash)
  };
}
