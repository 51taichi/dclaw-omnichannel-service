import crypto from "node:crypto";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const WEBHOOK_SECRET_BYTES = 32;
const WEBHOOK_SALT_BYTES = 16;
const WEBHOOK_HASH_BYTES = 32;

export function resolveTokenEncryptionKey(value) {
  let key;
  if (Buffer.isBuffer(value)) {
    key = Buffer.from(value);
  } else if (typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value)) {
    key = Buffer.from(value, "hex");
  } else if (typeof value === "string" && value.length > 0) {
    key = Buffer.from(value, "base64");
  }
  if (!key || key.length !== KEY_BYTES) {
    throw new Error("CHANNEL_TOKEN_ENCRYPTION_KEY must decode to a 32-byte key");
  }
  return key;
}

export function encryptChannelToken({ token, key, provider, channelAccountId }) {
  assertIdentity(provider, channelAccountId);
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("channel token is required");
  }
  const resolvedKey = resolveTokenEncryptionKey(key);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", resolvedKey, iv);
  cipher.setAAD(accountAad(provider, channelAccountId));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Object.freeze({
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    suffix: token.slice(-4)
  });
}

export function decryptChannelToken({ encrypted, key, provider, channelAccountId }) {
  assertIdentity(provider, channelAccountId);
  try {
    const resolvedKey = resolveTokenEncryptionKey(key);
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      resolvedKey,
      decodeExactBase64(encrypted?.iv, IV_BYTES)
    );
    decipher.setAAD(accountAad(provider, channelAccountId));
    decipher.setAuthTag(decodeExactBase64(encrypted?.authTag, 16));
    return Buffer.concat([
      decipher.update(decodeBase64(encrypted?.ciphertext)),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new Error("failed to decrypt channel token");
  }
}

export function generateWebhookSecret() {
  return crypto.randomBytes(WEBHOOK_SECRET_BYTES).toString("base64url");
}

export function hashWebhookSecret(secret) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("webhook secret is required");
  }
  const salt = crypto.randomBytes(WEBHOOK_SALT_BYTES);
  const hash = crypto.scryptSync(secret, salt, WEBHOOK_HASH_BYTES);
  return `scrypt-v1:${salt.toString("base64")}:${hash.toString("base64")}`;
}

export function verifyWebhookSecret(secret, encodedHash) {
  if (typeof secret !== "string" || typeof encodedHash !== "string") {
    return false;
  }
  const parts = encodedHash.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt-v1") {
    return false;
  }
  try {
    const salt = decodeExactBase64(parts[1], WEBHOOK_SALT_BYTES);
    const expected = decodeExactBase64(parts[2], WEBHOOK_HASH_BYTES);
    const actual = crypto.scryptSync(secret, salt, WEBHOOK_HASH_BYTES);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function accountAad(provider, channelAccountId) {
  return Buffer.from(`${provider}\0${channelAccountId}`, "utf8");
}

function assertIdentity(provider, channelAccountId) {
  if (typeof provider !== "string" || provider.length === 0
    || typeof channelAccountId !== "string" || channelAccountId.length === 0) {
    throw new Error("channel credential identity is required");
  }
}

function decodeBase64(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("invalid encrypted value");
  }
  return Buffer.from(value, "base64");
}

function decodeExactBase64(value, bytes) {
  const decoded = decodeBase64(value);
  if (decoded.length !== bytes) {
    throw new Error("invalid encrypted value");
  }
  return decoded;
}
