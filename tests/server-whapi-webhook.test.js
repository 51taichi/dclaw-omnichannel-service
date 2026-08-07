import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");

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

test("Whapi webhook route authenticates and durably deduplicates before acknowledging", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dclaw-whapi-webhook-"));
  const databasePath = path.join(directory, "service.sqlite");
  const seed = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import { createChannelAccount } from "./src/db.js";
    import { hashWebhookSecret } from "./src/channels/credentials.js";
    createChannelAccount({
      botId: "bot-a", provider: "whapi", channelId: "CHAN-A", publicId: "public-a",
      encryptedToken: { ciphertext: "cipher", iv: "iv", authTag: "tag", suffix: "1234" },
      webhookSecretHash: hashWebhookSecret("valid-secret")
    });
  `], { cwd: projectRoot, env: { ...process.env, DATABASE_PATH: databasePath }, encoding: "utf8" });
  assert.equal(seed.status, 0, seed.stderr);

  const port = await reservePort();
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port), HOST: "127.0.0.1", DATABASE_PATH: databasePath,
      BOTS_CONFIG_JSON: '{"bots":[]}', PROACTIVE_WORKER_ENABLED: "false",
      ACTIVATION_WORKER_ENABLED: "false", TAG_ACTIVATION_WORKER_ENABLED: "false",
      GROUP_AUTOMATION_WORKER_ENABLED: "false", CONVERSATION_RESET_WORKER_ENABLED: "false",
      COCKPIT_WORKER_ENABLED: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await waitForServer(port);

  const payload = {
    channel_id: "CHAN-A",
    event: { type: "messages", event: "post" },
    messages: [{
      id: "message-1", type: "text", chat_id: "123@s.whatsapp.net", from: "123",
      from_name: "Ada", from_me: false, timestamp: 1786000000, text: { body: "hello" }
    }]
  };
  const send = (secret, body = payload, eventType = "", method = "POST") => fetch(
    `http://127.0.0.1:${port}/webhooks/whapi/public-a${eventType ? `/${eventType}` : ""}`,
    {
      method,
      headers: { "content-type": "application/json", "x-dclaw-webhook-secret": secret },
      body: JSON.stringify(body)
    }
  );
  const invalid = await send("wrong-secret");
  assert.equal(invalid.status, 401);
  assert.deepEqual(await invalid.json(), { ok: false, message: "Webhook authentication failed" });
  const { event: _event, ...methodModePayload } = payload;
  const first = await send("valid-secret", methodModePayload, "messages");
  const duplicate = await send("valid-secret", methodModePayload, "messages");
  assert.equal(first.status, 200, stderr);
  assert.deepEqual(await first.json(), { ok: true, duplicate: false });
  assert.deepEqual(await duplicate.json(), { ok: true, duplicate: true });

  let inspected;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const inspect = spawnSync(process.execPath, ["--input-type=module", "--eval", `
      import { getConversation, listChannelWebhookEvents } from "./src/db.js";
      console.log(JSON.stringify({
        events: listChannelWebhookEvents("bot-a"),
        conversation: getConversation("whapi:CHAN-A:private:123@s.whatsapp.net")
      }));
    `], { cwd: projectRoot, env: { ...process.env, DATABASE_PATH: databasePath }, encoding: "utf8" });
    assert.equal(inspect.status, 0, inspect.stderr);
    inspected = JSON.parse(inspect.stdout);
    if (inspected.events[0]?.state === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(inspected.events.length, 1);
  assert.equal(inspected.events[0].eventKind, "messages.post");
  assert.equal(inspected.events[0].state, "completed");
  assert.equal(inspected.conversation.conversationKey, "whapi:CHAN-A:private:123@s.whatsapp.net");

  const groupPayload = {
    channel_id: "CHAN-A",
    event: { type: "messages", event: "post" },
    messages: [{
      id: "group-message-1", type: "text", chat_id: "12001@g.us", chat_name: "Support",
      from: "15550001", from_name: "Grace", from_me: false, timestamp: 1786000001,
      text: { body: "hello group" }
    }]
  };
  const groupResponse = await send("valid-secret", groupPayload);
  assert.equal(groupResponse.status, 200, stderr);

  let groupInspected;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const inspect = spawnSync(process.execPath, ["--input-type=module", "--eval", `
      import { getConversation, getGroupByExternalId, listChannelWebhookEvents } from "./src/db.js";
      console.log(JSON.stringify({
        events: listChannelWebhookEvents("bot-a"),
        conversation: getConversation("whapi:CHAN-A:group:12001@g.us"),
        group: getGroupByExternalId({ botId: "bot-a", provider: "whapi", channelAccountId: "CHAN-A", externalGroupId: "12001@g.us" })
      }));
    `], { cwd: projectRoot, env: { ...process.env, DATABASE_PATH: databasePath }, encoding: "utf8" });
    assert.equal(inspect.status, 0, inspect.stderr);
    groupInspected = JSON.parse(inspect.stdout);
    if (groupInspected.events.find((event) => event.externalId === "group-message-1")?.state === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(groupInspected.conversation.conversationKey, "whapi:CHAN-A:group:12001@g.us");
  assert.equal(groupInspected.group.currentName, "Support");
  assert.equal(groupInspected.group.externalGroupId, "12001@g.us");

  const participantResponse = await send("valid-secret", {
    channel_id: "CHAN-A",
    groups_participants: [{
      group_id: "12001@g.us",
      participants: ["15550003@s.whatsapp.net"],
      action: "add"
    }]
  }, "groups", "PUT");
  assert.equal(participantResponse.status, 200, stderr);

  let participantInspected;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const inspect = spawnSync(process.execPath, ["--input-type=module", "--eval", `
      import { getGroupByExternalId, listManagedGroupMembers } from "./src/db.js";
      const group = getGroupByExternalId({ botId: "bot-a", provider: "whapi", channelAccountId: "CHAN-A", externalGroupId: "12001@g.us" });
      console.log(JSON.stringify({ members: group ? listManagedGroupMembers({ botId: "bot-a", groupId: group.id }) : [] }));
    `], { cwd: projectRoot, env: { ...process.env, DATABASE_PATH: databasePath }, encoding: "utf8" });
    assert.equal(inspect.status, 0, inspect.stderr);
    participantInspected = JSON.parse(inspect.stdout);
    if (participantInspected.members.length === 1) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(participantInspected.members[0].externalId, "15550003@s.whatsapp.net");
});

test("masked Bot edits preserve encrypted Whapi credentials", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dclaw-whapi-preserve-"));
  const databasePath = path.join(directory, "service.sqlite");
  const encryptionKey = Buffer.alloc(32, 7).toString("base64");
  const seed = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import { createChannelAccount, upsertAgent, upsertBotBinding } from "./src/db.js";
    import { encryptChannelToken, hashWebhookSecret, resolveTokenEncryptionKey } from "./src/channels/credentials.js";
    upsertAgent({
      agentId: "agent-a", agentName: "Agent A", dclawBaseUrl: "https://api.example.com",
      dclawPublicId: "public-agent-a", agentApiKey: "agent-secret", enabled: true
    });
    upsertBotBinding({ botId: "bot-a", botName: "Bot A", agentId: "agent-a", enabled: true });
    createChannelAccount({
      botId: "bot-a", provider: "whapi", channelId: "CHAN-A", publicId: "public-a",
      encryptedToken: encryptChannelToken({
        token: "whapi-original-token", key: resolveTokenEncryptionKey(process.env.CHANNEL_TOKEN_ENCRYPTION_KEY),
        provider: "whapi", channelAccountId: "CHAN-A"
      }),
      webhookSecretHash: hashWebhookSecret("webhook-original-secret")
    });
  `], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_PATH: databasePath, CHANNEL_TOKEN_ENCRYPTION_KEY: encryptionKey },
    encoding: "utf8"
  });
  assert.equal(seed.status, 0, seed.stderr);

  const port = await reservePort();
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port), HOST: "127.0.0.1", DATABASE_PATH: databasePath,
      CHANNEL_TOKEN_ENCRYPTION_KEY: encryptionKey, ADMIN_API_KEY: "admin-secret",
      BOTS_CONFIG_JSON: '{"bots":[]}', PROACTIVE_WORKER_ENABLED: "false",
      ACTIVATION_WORKER_ENABLED: "false", TAG_ACTIVATION_WORKER_ENABLED: "false",
      GROUP_AUTOMATION_WORKER_ENABLED: "false", CONVERSATION_RESET_WORKER_ENABLED: "false",
      COCKPIT_WORKER_ENABLED: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await waitForServer(port);

  const response = await fetch(`http://127.0.0.1:${port}/api/bots/bot-a`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-api-key": "admin-secret" },
    body: JSON.stringify({
      botName: "Bot A edited", agentId: "agent-a", channelId: "CHAN-A",
      apiToken: "*****", webhookSecret: "*****", enabled: true
    })
  });
  assert.equal(response.status, 200, stderr);
  const responseBody = await response.json();
  assert.equal(JSON.stringify(responseBody).includes("agent-secret"), false);

  const inspect = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import { getChannelAccountCredentials } from "./src/db.js";
    import { decryptChannelToken, verifyWebhookSecret, resolveTokenEncryptionKey } from "./src/channels/credentials.js";
    const credentials = getChannelAccountCredentials("bot-a");
    console.log(JSON.stringify({
      token: decryptChannelToken({
        encrypted: credentials.encryptedToken,
        key: resolveTokenEncryptionKey(process.env.CHANNEL_TOKEN_ENCRYPTION_KEY),
        provider: "whapi", channelAccountId: "CHAN-A"
      }),
      originalWebhookSecretStillValid: verifyWebhookSecret("webhook-original-secret", credentials.webhookSecretHash)
    }));
  `], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_PATH: databasePath, CHANNEL_TOKEN_ENCRYPTION_KEY: encryptionKey },
    encoding: "utf8"
  });
  assert.equal(inspect.status, 0, inspect.stderr);
  assert.deepEqual(JSON.parse(inspect.stdout), {
    token: "whapi-original-token",
    originalWebhookSecretStillValid: true
  });
});
