import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");
const mockWhapiFetch = new URL("./fixtures/mock-whapi-fetch.js", import.meta.url).href;

function reservePort() {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("server did not start");
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  let timeout;
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => { timeout = setTimeout(resolve, 5_000); })
  ]);
  clearTimeout(timeout);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function startManualReplyServer(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dclaw-manual-delivery-route-"));
  const databasePath = path.join(directory, "service.sqlite");
  const encryptionKey = Buffer.alloc(32, 11).toString("base64");
  const conversationKey = "whapi:CHAN-MANUAL:private:15551234567@s.whatsapp.net";
  const seed = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import {
      createChannelAccount, getOrCreateFlowSession, updateChannelAccountHealth,
      updateFlowSessionHandoff, upsertAgent, upsertBotBinding
    } from "./src/db.js";
    import { encryptChannelToken, hashWebhookSecret, resolveTokenEncryptionKey } from "./src/channels/credentials.js";
    upsertAgent({
      agentId: "agent-manual", agentName: "Manual agent", dclawBaseUrl: "https://agent.example.test",
      dclawPublicId: "agent-public", agentApiKey: "agent-secret", enabled: true
    });
    upsertBotBinding({ botId: "bot-manual", botName: "Manual bot", agentId: "agent-manual", enabled: true });
    createChannelAccount({
      botId: "bot-manual", provider: "whapi", channelId: "CHAN-MANUAL", publicId: "public-manual",
      encryptedToken: encryptChannelToken({
        token: "whapi-test-token", key: resolveTokenEncryptionKey(process.env.CHANNEL_TOKEN_ENCRYPTION_KEY),
        provider: "whapi", channelAccountId: "CHAN-MANUAL"
      }),
      webhookSecretHash: hashWebhookSecret("webhook-manual-secret")
    });
    updateChannelAccountHealth({ botId: "bot-manual", healthStatus: "connected", providerStatus: "AUTH" });
    getOrCreateFlowSession({
      botId: "bot-manual",
      conversationKey: ${JSON.stringify(conversationKey)},
      machine: { entryNodeId: "manual-node" }
    });
    updateFlowSessionHandoff({
      botId: "bot-manual", conversationKey: ${JSON.stringify(conversationKey)}, handoffStatus: "human"
    });
  `], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_PATH: databasePath, CHANNEL_TOKEN_ENCRYPTION_KEY: encryptionKey },
    encoding: "utf8"
  });
  assert.equal(seed.status, 0, seed.stderr);

  const port = await reservePort();
  const child = spawn(process.execPath, ["--import", mockWhapiFetch, "src/server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      DATABASE_PATH: databasePath,
      CHANNEL_TOKEN_ENCRYPTION_KEY: encryptionKey,
      ADMIN_API_KEY: "admin-secret",
      BOTS_CONFIG_JSON: '{"bots":[]}',
      PROACTIVE_WORKER_ENABLED: "false",
      ACTIVATION_WORKER_ENABLED: "false",
      TAG_ACTIVATION_WORKER_ENABLED: "false",
      GROUP_AUTOMATION_WORKER_ENABLED: "false",
      CONVERSATION_RESET_WORKER_ENABLED: "false",
      COCKPIT_WORKER_ENABLED: "false",
      CHANNEL_WEBHOOK_WORKER_INTERVAL_MS: "100"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(async () => {
    await stopProcess(child);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await waitForServer(port);

  const request = (pathname, options = {}) => fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-api-key": "admin-secret",
      ...(options.headers || {})
    }
  });
  return { request, conversationKey, stderr: () => stderr };
}

async function waitForDeliveryStatus(request, conversationKey, expected) {
  let body;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await request(
      `/api/flow-sessions/${encodeURIComponent(conversationKey)}?botId=bot-manual`
    );
    assert.equal(response.status, 200);
    body = await response.json();
    if (body.messages[0]?.deliveryStatus === expected) return body;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return body;
}

test("a real manual reply persists provider metadata and refreshes after its Whapi callback", async (t) => {
  const { request, conversationKey, stderr } = await startManualReplyServer(t);
  const sent = await request(`/api/flow-sessions/${encodeURIComponent(conversationKey)}/manual-reply`, {
    method: "POST",
    body: JSON.stringify({ botId: "bot-manual", content: "hello from a human" })
  });
  assert.equal(sent.status, 200, stderr());
  const sentBody = await sent.json();
  assert.equal(sentBody.ok, true);
  assert.equal(sentBody.message.rawPayload.messageId, "manual-provider-message-1");
  assert.equal(sentBody.message.rawPayload.provider, "whapi");
  assert.equal(sentBody.message.rawPayload.channelAccountId, "CHAN-MANUAL");

  const logs = await request("/api/logs/outgoing-messages?botId=bot-manual&limit=10");
  assert.equal(logs.status, 200, stderr());
  const [outgoing] = (await logs.json()).logs;
  assert.equal(outgoing.message_id, "manual-provider-message-1");
  assert.equal(outgoing.provider, "whapi");
  assert.equal(outgoing.channel_account_id, "CHAN-MANUAL");
  assert.equal(outgoing.delivery_status, "pending");

  const initial = await waitForDeliveryStatus(request, conversationKey, "pending");
  assert.equal(initial.messages[0].deliveryStatus, "pending");

  const callback = await request("/webhooks/whapi/public-manual/statuses", {
    method: "POST",
    headers: { "x-dclaw-webhook-secret": "webhook-manual-secret" },
    body: JSON.stringify({
      channel_id: "CHAN-MANUAL",
      statuses: [
        { id: "deleted-provider-message", status: "deleted" },
        {
          id: "manual-provider-message-1",
          status: "delivered",
          recipient_id: "15551234567@s.whatsapp.net",
          timestamp: "1786000000"
        }
      ]
    })
  });
  assert.equal(callback.status, 200, stderr());

  const refreshed = await waitForDeliveryStatus(request, conversationKey, "delivered");
  assert.equal(refreshed.messages[0].deliveryStatus, "delivered");
});

test("a rejected manual send returns an HTTP error without persisting an outbound message", async (t) => {
  const { request, conversationKey, stderr } = await startManualReplyServer(t);
  const rejected = await request(`/api/flow-sessions/${encodeURIComponent(conversationKey)}/manual-reply`, {
    method: "POST",
    body: JSON.stringify({ botId: "bot-manual", content: "provider rejects this message" })
  });
  assert.equal(rejected.status, 422, stderr());
  assert.deepEqual(await rejected.json(), {
    ok: false,
    message: "Channel operation was rejected"
  });

  const logs = await request("/api/logs/outgoing-messages?botId=bot-manual&limit=10");
  assert.equal(logs.status, 200, stderr());
  assert.deepEqual((await logs.json()).logs, []);

  const detail = await request(
    `/api/flow-sessions/${encodeURIComponent(conversationKey)}?botId=bot-manual`
  );
  assert.equal(detail.status, 200, stderr());
  assert.deepEqual((await detail.json()).messages, []);
});
