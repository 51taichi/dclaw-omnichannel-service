import assert from "node:assert/strict";
import test from "node:test";

import { createWebhookIntake, deriveWebhookIdentity } from "../src/channels/webhook-intake.js";

test("webhook intake authenticates, records once, and accepts duplicates", () => {
  const recorded = [];
  const intake = createWebhookIntake({
    resolveAccount: (publicId) => publicId === "known" ? {
      botId: "bot-a",
      provider: "whapi",
      channelId: "CHAN-A",
      enabled: true,
      webhookSecretHash: "stored-hash"
    } : null,
    verifySecret: (secret, hash) => secret === "valid-secret" && hash === "stored-hash",
    recordEvent: (event) => {
      const duplicate = recorded.some((item) => item.idempotencyKey === event.idempotencyKey);
      if (!duplicate) recorded.push(event);
      return { inserted: !duplicate };
    }
  });
  const request = {
    publicId: "known",
    method: "POST",
    headers: { "x-dclaw-webhook-secret": "valid-secret", authorization: "must-not-persist" },
    body: {
      channel_id: "CHAN-A",
      event: { type: "messages", event: "post" },
      messages: [{ id: "message-1", chat_id: "123@s.whatsapp.net" }]
    }
  };

  assert.deepEqual(intake.handle(request), { accepted: true, duplicate: false });
  assert.deepEqual(intake.handle(request), { accepted: true, duplicate: true });
  assert.equal(recorded.length, 1);
  assert.match(recorded[0].idempotencyKey, /^whapi:CHAN-A:messages\.post:[a-f0-9]{64}$/);
  assert.equal(recorded[0].externalId, "message-1");
  assert.equal(JSON.stringify(recorded[0]).includes("valid-secret"), false);
  assert.equal(JSON.stringify(recorded[0]).includes("must-not-persist"), false);
});

test("webhook intake does not reveal unknown accounts or invalid secrets", () => {
  const intake = createWebhookIntake({
    resolveAccount: () => null,
    verifySecret: () => false,
    recordEvent: () => assert.fail("must not record")
  });
  for (const publicId of ["unknown-a", "unknown-b"]) {
    assert.throws(() => intake.handle({ publicId, method: "POST", headers: {}, body: {} }), (error) => {
      assert.equal(error.status, 401);
      assert.equal(error.message, "Webhook authentication failed");
      return true;
    });
  }
});

test("disabled accounts acknowledge without enqueueing and fallback identity is stable", () => {
  let records = 0;
  const intake = createWebhookIntake({
    resolveAccount: () => ({ botId: "bot-a", provider: "whapi", channelId: "CHAN-A", enabled: false, webhookSecretHash: "hash" }),
    verifySecret: () => true,
    recordEvent: () => { records += 1; }
  });
  assert.deepEqual(intake.handle({ publicId: "id", method: "PATCH", headers: {}, body: { event: { type: "channel", event: "patch" } } }), {
    accepted: true,
    duplicate: false,
    disabled: true
  });
  assert.equal(records, 0);
  assert.equal(
    deriveWebhookIdentity({ provider: "whapi", channelAccountId: "CHAN-A", method: "PATCH", body: { b: 2, a: 1 } }),
    deriveWebhookIdentity({ provider: "whapi", channelAccountId: "CHAN-A", method: "PATCH", body: { a: 1, b: 2 } })
  );
});

test("Whapi identities deduplicate exact retries without losing later entity transitions", () => {
  const identity = (body) => deriveWebhookIdentity({
    provider: "whapi", channelAccountId: "CHAN-A", method: "PUT", body
  });
  const delivered = {
    event: { type: "statuses", method: "put" },
    statuses: [{ id: "message-1", status: "delivered", timestamp: "1786000000" }]
  };
  const read = {
    event: { type: "statuses", method: "put" },
    statuses: [{ id: "message-1", status: "read", timestamp: "1786000001" }]
  };
  assert.equal(identity(delivered), identity({ statuses: delivered.statuses, event: delivered.event }));
  assert.notEqual(identity(delivered), identity(read));
});

test("Whapi body mode uses the official event.method field in its identity", () => {
  assert.match(deriveWebhookIdentity({
    provider: "whapi", channelAccountId: "CHAN-A", method: "POST",
    body: {
      event: { type: "groups", method: "patch" },
      groups_updates: [{ after_update: { id: "12001@g.us" } }]
    }
  }), /^whapi:CHAN-A:groups\.patch:[a-f0-9]{64}$/);
});
