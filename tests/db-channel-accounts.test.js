import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");

function runDatabaseScenario(source) {
  const directory = mkdtempSync(path.join(tmpdir(), "dclaw-channel-account-"));
  const databasePath = path.join(directory, "accounts.sqlite");
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_PATH: databasePath },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("channel accounts expose redacted identity while credentials require an internal read", () => {
  const result = runDatabaseScenario(`
    import {
      createChannelAccount,
      getChannelAccount,
      getChannelAccountCredentials,
      getChannelAccountByPublicId,
      listChannelAccounts
    } from "./src/db.js";
    const encryptedToken = { ciphertext: "cipher", iv: "iv", authTag: "tag", suffix: "1234" };
    const created = createChannelAccount({
      botId: "bot-a", provider: "whapi", channelId: "CHAN-A", encryptedToken,
      webhookSecretHash: "hash-a", enabled: true
    });
    console.log(JSON.stringify({
      created,
      direct: getChannelAccount("bot-a"),
      byPublic: getChannelAccountByPublicId(created.publicId),
      listed: listChannelAccounts(),
      credentials: getChannelAccountCredentials("bot-a")
    }));
  `);

  for (const account of [result.created, result.direct, result.byPublic, result.listed[0]]) {
    assert.equal(account.botId, "bot-a");
    assert.equal(account.provider, "whapi");
    assert.equal(account.channelId, "CHAN-A");
    assert.equal(account.tokenConfigured, true);
    assert.equal(account.tokenSuffix, "1234");
    assert.equal(JSON.stringify(account).includes("cipher"), false);
    assert.equal(JSON.stringify(account).includes("hash-a"), false);
  }
  assert.deepEqual(result.credentials.encryptedToken, {
    ciphertext: "cipher",
    iv: "iv",
    authTag: "tag",
    suffix: "1234"
  });
  assert.equal(result.credentials.webhookSecretHash, "hash-a");
});

test("channel accounts enforce provider-channel uniqueness and isolate health by Bot", () => {
  const result = runDatabaseScenario(`
    import {
      createChannelAccount,
      getChannelAccount,
      markChannelAccountWebhookSuccess,
      updateChannelAccountHealth,
      updateChannelAccountToken
    } from "./src/db.js";
    const token = (suffix) => ({ ciphertext: "cipher-" + suffix, iv: "iv-" + suffix, authTag: "tag-" + suffix, suffix });
    createChannelAccount({ botId: "bot-a", provider: "whapi", channelId: "CHAN-A", encryptedToken: token("1111"), webhookSecretHash: "hash-a" });
    createChannelAccount({ botId: "bot-b", provider: "whapi", channelId: "CHAN-B", encryptedToken: token("2222"), webhookSecretHash: "hash-b" });
    let duplicateRejected = false;
    try {
      createChannelAccount({ botId: "bot-c", provider: "whapi", channelId: "CHAN-A", encryptedToken: token("3333"), webhookSecretHash: "hash-c" });
    } catch { duplicateRejected = true; }
    updateChannelAccountHealth({ botId: "bot-a", healthStatus: "connected", providerStatus: "AUTH", checkedAt: "2026-08-06T10:00:00.000Z", lastError: "" });
    markChannelAccountWebhookSuccess({ botId: "bot-a", receivedAt: "2026-08-06T10:01:00.000Z" });
    updateChannelAccountToken({ botId: "bot-b", encryptedToken: token("9999") });
    console.log(JSON.stringify({ duplicateRejected, a: getChannelAccount("bot-a"), b: getChannelAccount("bot-b") }));
  `);

  assert.equal(result.duplicateRejected, true);
  assert.equal(result.a.healthStatus, "connected");
  assert.equal(result.a.providerStatus, "AUTH");
  assert.equal(result.a.lastWebhookAt, "2026-08-06T10:01:00.000Z");
  assert.equal(result.a.tokenSuffix, "1111");
  assert.equal(result.b.healthStatus, "disconnected");
  assert.equal(result.b.tokenSuffix, "9999");
});

test("channel webhook envelopes are durable and idempotent per account", () => {
  const result = runDatabaseScenario(`
    import { listChannelWebhookEvents, recordChannelWebhookEvent } from "./src/db.js";
    const event = {
      provider: "whapi", botId: "bot-a", channelAccountId: "CHAN-A",
      eventKind: "messages.post", method: "POST", externalId: "message-1",
      idempotencyKey: "whapi:CHAN-A:messages.post:message-1",
      payload: { messages: [{ id: "message-1" }] }
    };
    const first = recordChannelWebhookEvent(event);
    const duplicate = recordChannelWebhookEvent(event);
    const isolated = recordChannelWebhookEvent({ ...event, botId: "bot-b" });
    console.log(JSON.stringify({ first, duplicate, isolated, a: listChannelWebhookEvents("bot-a"), b: listChannelWebhookEvents("bot-b") }));
  `);
  assert.equal(result.first.inserted, true);
  assert.equal(result.duplicate.inserted, false);
  assert.equal(result.isolated.inserted, true);
  assert.equal(result.a.length, 1);
  assert.equal(result.b.length, 1);
  assert.deepEqual(result.a[0].payload, { messages: [{ id: "message-1" }] });
  assert.equal(result.a[0].state, "pending");
});

test("channel webhook leases support completion, retry, and expired recovery", () => {
  const result = runDatabaseScenario(`
    import {
      claimChannelWebhookEvents, completeChannelWebhookEvent, failChannelWebhookEvent,
      listChannelWebhookEvents, recordChannelWebhookEvent, recoverExpiredChannelWebhookLeases
    } from "./src/db.js";
    const add = (id) => recordChannelWebhookEvent({
      provider: "whapi", botId: "bot-a", channelAccountId: "CHAN-A", eventKind: "messages.post",
      method: "POST", externalId: id, idempotencyKey: "key-" + id, payload: { id },
      receivedAt: "2026-08-06T10:00:00.000Z"
    });
    add("one"); add("two");
    const claimed = claimChannelWebhookEvents({ owner: "worker-a", limit: 2, leaseMs: 1000, nowIso: "2026-08-06T10:00:01.000Z" });
    completeChannelWebhookEvent({ id: claimed[0].id, owner: "worker-a", processedAt: "2026-08-06T10:00:01.100Z" });
    failChannelWebhookEvent({ id: claimed[1].id, owner: "worker-a", retryable: true, nextRetryAt: "2026-08-06T10:00:02.000Z", errorMessage: "temporary" });
    const retried = claimChannelWebhookEvents({ owner: "worker-b", limit: 2, leaseMs: 1000, nowIso: "2026-08-06T10:00:02.000Z" });
    const recovered = recoverExpiredChannelWebhookLeases({ nowIso: "2026-08-06T10:00:04.000Z" });
    console.log(JSON.stringify({ claimed, retried, recovered, rows: listChannelWebhookEvents("bot-a") }));
  `);
  assert.equal(result.claimed.length, 2);
  assert.equal(result.retried.length, 1);
  assert.equal(result.retried[0].attempts, 2);
  assert.equal(result.recovered, 1);
  assert.deepEqual(result.rows.map((row) => row.state), ["completed", "pending"]);
});
