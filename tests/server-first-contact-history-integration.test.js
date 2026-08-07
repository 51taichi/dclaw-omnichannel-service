import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

async function waitForServer(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("server did not start");
}

test("first private Whapi webhook imports available history before the live message", async (t) => {
  const requests = [];
  const whapi = http.createServer((req, res) => {
    requests.push(req.url);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      messages: [{
        id: "historic-1", type: "text", chat_id: "123@s.whatsapp.net", from: "123",
        from_name: "Ada", from_me: false, timestamp: 1785718800, text: { body: "older hello" }
      }, {
        id: "live-1", type: "text", chat_id: "123@s.whatsapp.net", from: "123",
        from_name: "Ada", from_me: false, timestamp: 1786064400, text: { body: "live hello" }
      }],
      count: 2,
      total: 2
    }));
  });
  const whapiPort = await listen(whapi);
  t.after(() => whapi.close());

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dclaw-first-history-integration-"));
  const databasePath = path.join(directory, "service.sqlite");
  const encryptionKey = Buffer.alloc(32, 9).toString("base64");
  const seed = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import { createChannelAccount, upsertAgent, upsertAgentTagSchema, upsertBotBinding } from "./src/db.js";
    import { encryptChannelToken, hashWebhookSecret, resolveTokenEncryptionKey } from "./src/channels/credentials.js";
    upsertAgent({
      agentId: "agent-a", agentName: "Agent A", dclawBaseUrl: "https://agent.invalid",
      dclawPublicId: "agent-public-a", agentApiKey: "agent-key-a", enabled: false
    });
    upsertAgentTagSchema({ agentId: "agent-a", schema: { dateTag: { enabled: true, cutoffTime: "00:00" }, groups: [] } });
    upsertBotBinding({ botId: "bot-a", botName: "Bot A", agentId: "agent-a", enabled: false });
    createChannelAccount({
      botId: "bot-a", provider: "whapi", channelId: "CHAN-A", publicId: "public-a",
      encryptedToken: encryptChannelToken({
        token: "token-a", key: resolveTokenEncryptionKey(process.env.CHANNEL_TOKEN_ENCRYPTION_KEY),
        provider: "whapi", channelAccountId: "CHAN-A"
      }),
      webhookSecretHash: hashWebhookSecret("valid-secret")
    });
  `], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_PATH: databasePath, CHANNEL_TOKEN_ENCRYPTION_KEY: encryptionKey },
    encoding: "utf8"
  });
  assert.equal(seed.status, 0, seed.stderr);

  const servicePort = await new Promise((resolve) => {
    const temporary = http.createServer();
    temporary.listen(0, "127.0.0.1", () => {
      const port = temporary.address().port;
      temporary.close(() => resolve(port));
    });
  });
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(servicePort), HOST: "127.0.0.1", DATABASE_PATH: databasePath,
      CHANNEL_TOKEN_ENCRYPTION_KEY: encryptionKey,
      WHAPI_BASE_URL: `http://127.0.0.1:${whapiPort}`,
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
  await waitForServer(servicePort);

  const response = await fetch(`http://127.0.0.1:${servicePort}/webhooks/whapi/public-a/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dclaw-webhook-secret": "valid-secret" },
    body: JSON.stringify({
      channel_id: "CHAN-A",
      messages: [{
        id: "live-1", type: "text", chat_id: "123@s.whatsapp.net", from: "123",
        from_name: "Ada", from_me: false, timestamp: 1786064400, text: { body: "live hello" }
      }]
    })
  });
  assert.equal(response.status, 200, stderr);

  let inspected;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const inspect = spawnSync(process.execPath, ["--input-type=module", "--eval", `
      import { getFirstContactHistorySync, listConversationMessages, listConversationTags } from "./src/db.js";
      const scope = { botId: "bot-a", conversationKey: "whapi:CHAN-A:private:123@s.whatsapp.net" };
      console.log(JSON.stringify({
        sync: getFirstContactHistorySync(scope),
        messages: listConversationMessages(scope),
        tags: listConversationTags({ ...scope, agentId: "agent-a" })
      }));
    `], { cwd: projectRoot, env: { ...process.env, DATABASE_PATH: databasePath }, encoding: "utf8" });
    assert.equal(inspect.status, 0, inspect.stderr);
    inspected = JSON.parse(inspect.stdout);
    if (inspected.sync?.status === "success" && inspected.messages.length === 2) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.match(requests[0], /^\/messages\/list\/123%40s\.whatsapp\.net\?/);
  assert.deepEqual(inspected.messages.map((message) => message.content), ["older hello", "live hello"]);
  assert.deepEqual(inspected.messages.map((message) => message.source), ["whapi_chat_history", "local"]);
  assert.equal(inspected.tags.find((tag) => tag.tagType === "date")?.tagId, "20260803");
  assert.equal(inspected.sync.importedCount, 1);
});
