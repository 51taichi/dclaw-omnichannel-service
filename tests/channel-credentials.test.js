import assert from "node:assert/strict";
import test from "node:test";

import {
  decryptChannelToken,
  encryptChannelToken,
  generateWebhookSecret,
  hashWebhookSecret,
  resolveTokenEncryptionKey,
  verifyWebhookSecret
} from "../src/channels/credentials.js";

const keyBytes = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1));

test("token encryption keys require exactly 32 decoded bytes", () => {
  assert.deepEqual(resolveTokenEncryptionKey(keyBytes.toString("base64")), keyBytes);
  assert.deepEqual(resolveTokenEncryptionKey(keyBytes.toString("hex")), keyBytes);
  assert.deepEqual(resolveTokenEncryptionKey(keyBytes), keyBytes);
  for (const value of [undefined, "", "not-a-key", Buffer.alloc(31), Buffer.alloc(33)]) {
    assert.throws(() => resolveTokenEncryptionKey(value), /32-byte/);
  }
});

test("tokens use fresh account-bound AES-256-GCM ciphertext", () => {
  const key = resolveTokenEncryptionKey(keyBytes);
  const input = {
    token: "whapi-secret-token-1234",
    key,
    provider: "whapi",
    channelAccountId: "account-1"
  };
  const first = encryptChannelToken(input);
  const second = encryptChannelToken(input);

  assert.equal(first.iv.length > 0, true);
  assert.notEqual(first.iv, second.iv);
  assert.equal(Buffer.from(first.iv, "base64").length, 12);
  assert.equal(JSON.stringify(first).includes(input.token), false);
  assert.equal(first.suffix, "1234");
  assert.equal(decryptChannelToken({ encrypted: first, key, provider: "whapi", channelAccountId: "account-1" }), input.token);
  assert.throws(
    () => decryptChannelToken({ encrypted: first, key, provider: "whapi", channelAccountId: "account-2" }),
    /decrypt channel token/
  );
});

test("webhook secrets are random and verified from non-reversible hashes", () => {
  const first = generateWebhookSecret();
  const second = generateWebhookSecret();
  assert.notEqual(first, second);
  assert.equal(first.length >= 40, true);

  const encodedHash = hashWebhookSecret(first);
  assert.equal(encodedHash.includes(first), false);
  assert.equal(verifyWebhookSecret(first, encodedHash), true);
  assert.equal(verifyWebhookSecret(second, encodedHash), false);
  assert.equal(verifyWebhookSecret(first, "malformed"), false);
});
