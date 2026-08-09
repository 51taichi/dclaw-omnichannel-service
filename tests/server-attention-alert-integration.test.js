import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");
const mockFetch = new URL("./fixtures/mock-attention-alert-fetch.js", import.meta.url).href;

function reservePort() {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(check, message, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 5_000))
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

test("HTTP workflow keeps attention alerts idempotent and evidence-addressable", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dclaw-attention-http-"));
  const databasePath = path.join(directory, "service.sqlite");
  const encryptionKey = Buffer.alloc(32, 13).toString("base64");
  const conversationKey = "whapi:CHAN-ATTENTION:private:15550001111@s.whatsapp.net";
  const seed = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import {
      completeFirstContactHistorySync, createChannelAccount, claimFirstContactHistorySync,
      setSetting, updateChannelAccountHealth, upsertAgent, upsertBotBinding, upsertConversation
    } from "./src/db.js";
    import { encryptChannelToken, hashWebhookSecret, resolveTokenEncryptionKey } from "./src/channels/credentials.js";
    upsertAgent({
      agentId: "agent-attention", agentName: "Attention agent",
      dclawBaseUrl: "https://agent.example.test", dclawPublicId: "attention-public",
      agentApiKey: "agent-secret", enabled: true
    });
    upsertBotBinding({ botId: "bot-attention", botName: "Attention bot", agentId: "agent-attention", enabled: true });
    createChannelAccount({
      botId: "bot-attention", provider: "whapi", channelId: "CHAN-ATTENTION", publicId: "public-attention",
      encryptedToken: encryptChannelToken({
        token: "whapi-test-token", key: resolveTokenEncryptionKey(process.env.CHANNEL_TOKEN_ENCRYPTION_KEY),
        provider: "whapi", channelAccountId: "CHAN-ATTENTION"
      }),
      webhookSecretHash: hashWebhookSecret("attention-webhook-secret")
    });
    updateChannelAccountHealth({ botId: "bot-attention", healthStatus: "connected", providerStatus: "AUTH" });
    upsertConversation({
      botId: "bot-attention", agentId: "agent-attention", conversationKey: ${JSON.stringify(conversationKey)},
      message: { roomType: 2, receivedName: "Ada", groupName: "Ada" }
    });
    claimFirstContactHistorySync({ botId: "bot-attention", conversationKey: ${JSON.stringify(conversationKey)}, owner: "seed" });
    completeFirstContactHistorySync({
      botId: "bot-attention", conversationKey: ${JSON.stringify(conversationKey)}, owner: "seed", status: "success"
    });
    setSetting("reply_wait:bot-attention", { baseSeconds: 1, incrementSeconds: 0, fallbackReply: "稍后回复" });
  `], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_PATH: databasePath, CHANNEL_TOKEN_ENCRYPTION_KEY: encryptionKey },
    encoding: "utf8"
  });
  assert.equal(seed.status, 0, seed.stderr);

  const port = await reservePort();
  const child = spawn(process.execPath, ["--import", mockFetch, "src/server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port), HOST: "127.0.0.1", DATABASE_PATH: databasePath,
      CHANNEL_TOKEN_ENCRYPTION_KEY: encryptionKey, ADMIN_API_KEY: "admin-secret",
      ATTENTION_TEST_FAIL_FIRST_SEND: "true", BOTS_CONFIG_JSON: '{"bots":[]}',
      PROACTIVE_WORKER_ENABLED: "false", ACTIVATION_WORKER_ENABLED: "false",
      TAG_ACTIVATION_WORKER_ENABLED: "false", GROUP_AUTOMATION_WORKER_ENABLED: "false",
      CONVERSATION_RESET_WORKER_ENABLED: "false", COCKPIT_WORKER_ENABLED: "false",
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

  await waitFor(async () => {
    try { return (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch { return false; }
  }, "server did not start");

  const api = (pathname, options = {}) => fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-api-key": "admin-secret",
      ...(options.headers || {})
    }
  });
  const webhook = (id, text) => fetch(
    `http://127.0.0.1:${port}/webhooks/whapi/public-attention/messages`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-dclaw-webhook-secret": "attention-webhook-secret" },
      body: JSON.stringify({
        channel_id: "CHAN-ATTENTION",
        messages: [{
          id, type: "text", chat_id: "15550001111@s.whatsapp.net", from: "15550001111",
          from_name: "Ada", from_me: false, timestamp: 1786200000, text: { body: text }
        }]
      })
    }
  );
  const unread = async () => (await (await api("/api/attention-alerts?botId=bot-attention")).json()).alerts;

  assert.equal((await webhook("attention-1", "请确认运费")).status, 200, stderr);
  const first = await waitFor(async () => (await unread())[0] || null, "first alert was not created");
  assert.equal(first.occurrenceCount, 1);

  // The first provider send fails after alert persistence. Replaying the same inbound job must be inert.
  await waitFor(async () => {
    const detail = await (await api(`/api/flow-sessions/${encodeURIComponent(conversationKey)}?botId=bot-attention`)).json();
    return detail.messages.some((message) => message.direction === "inbound");
  }, "inbound evidence was not persisted");
  assert.equal((await webhook("attention-1", "请确认运费")).status, 200, stderr);
  await new Promise((resolve) => setTimeout(resolve, 1_400));
  assert.equal((await unread())[0].occurrenceCount, 1);

  assert.equal((await webhook("attention-2", "再确认一下库存")).status, 200, stderr);
  const merged = await waitFor(async () => {
    const [alert] = await unread();
    return alert?.occurrenceCount === 2 ? alert : null;
  }, "second trigger did not merge");
  assert.equal(merged.id, first.id);

  const evidence = await (await api(
    `/api/flow-sessions/${encodeURIComponent(conversationKey)}?botId=bot-attention&anchorMessageId=${merged.evidenceMessageId}`
  )).json();
  assert.equal(evidence.evidenceFound, true);
  assert.ok(evidence.messages.some((message) => message.id === merged.evidenceMessageId));
  assert.ok(evidence.messages.some((message) => (
    message.direction === "outbound" && message.content === "我先给您参考，稍后再确认。"
  )));
  assert.notEqual(evidence.session?.handoffStatus, "human");

  const read = await api(`/api/attention-alerts/${merged.id}/read`, {
    method: "POST",
    body: JSON.stringify({ botId: "bot-attention" })
  });
  assert.equal(read.status, 200, stderr);
  assert.equal((await unread()).length, 0);

  assert.equal((await webhook("attention-3", "还需要确认税费")).status, 200, stderr);
  const afterRead = await waitFor(async () => (await unread())[0] || null, "new alert after read was not created");
  assert.notEqual(afterRead.id, merged.id);
  assert.equal(afterRead.occurrenceCount, 1);
});
