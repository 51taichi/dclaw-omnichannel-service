import assert from "node:assert/strict";
import test from "node:test";

import { createWhapiAdapter } from "../src/channels/whapi/adapter.js";
import { buildWhapiWebhookSettings, buildWhapiWebhookUrl } from "../src/channels/whapi/webhook.js";

test("Whapi webhook URLs are HTTPS account paths without query credentials", () => {
  assert.equal(
    buildWhapiWebhookUrl({ publicBaseUrl: "https://chat.example.com/base/", publicId: "public/id" }),
    "https://chat.example.com/base/webhooks/whapi/public%2Fid"
  );
  assert.throws(() => buildWhapiWebhookUrl({ publicBaseUrl: "http://chat.example.com", publicId: "id" }), /HTTPS/);
  assert.throws(() => buildWhapiWebhookUrl({ publicBaseUrl: "https://chat.example.com", publicId: "" }), /publicId/);
});

test("Whapi webhook settings enable durable required events and a custom secret header", () => {
  const url = "https://chat.example.com/webhooks/whapi/public-1";
  const settings = buildWhapiWebhookSettings({ url, secret: "webhook-secret" });
  assert.deepEqual(settings, {
    callback_backoff_delay_ms: 3000,
    max_callback_backoff_delay_ms: 900000,
    callback_persist: true,
    webhooks: [{
      url,
      mode: "method",
      headers: { "X-DClaw-Webhook-Secret": "webhook-secret" },
      events: [
        { type: "messages", method: "post" },
        { type: "messages", method: "put" },
        { type: "messages", method: "delete" },
        { type: "statuses", method: "post" },
        { type: "statuses", method: "put" },
        { type: "groups", method: "post" },
        { type: "groups", method: "put" },
        { type: "groups", method: "patch" },
        { type: "users", method: "post" },
        { type: "users", method: "delete" },
        { type: "channel", method: "post" },
        { type: "channel", method: "patch" }
      ]
    }]
  });
  assert.equal(url.includes("webhook-secret"), false);
});

test("Whapi adapter configures settings but does not return secret-bearing provider data", async () => {
  let received;
  const adapter = createWhapiAdapter({ resolveAccountClient: async () => ({
    updateSettings: async (settings) => {
      received = settings;
      return { changes: ["webhooks"], after_update: settings };
    }
  }) });
  const webhookSettings = buildWhapiWebhookSettings({
    url: "https://chat.example.com/webhooks/whapi/public-1",
    secret: "webhook-secret"
  });
  const result = await adapter.configureWebhook({ channelAccountId: "CHAN-A", webhookSettings });
  assert.equal(received, webhookSettings);
  assert.deepEqual(result, { configured: true, changes: ["webhooks"] });
  assert.equal(JSON.stringify(result).includes("webhook-secret"), false);
});
