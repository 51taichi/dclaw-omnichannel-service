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
    messages: [{ id: "message-1", chat_id: "123@s.whatsapp.net" }]
  };
  const send = (secret) => fetch(`http://127.0.0.1:${port}/webhooks/whapi/public-a`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dclaw-webhook-secret": secret },
    body: JSON.stringify(payload)
  });
  const invalid = await send("wrong-secret");
  assert.equal(invalid.status, 401);
  assert.deepEqual(await invalid.json(), { ok: false, message: "Webhook authentication failed" });
  const first = await send("valid-secret");
  const duplicate = await send("valid-secret");
  assert.equal(first.status, 200, stderr);
  assert.deepEqual(await first.json(), { ok: true, duplicate: false });
  assert.deepEqual(await duplicate.json(), { ok: true, duplicate: true });

  const inspect = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import { listChannelWebhookEvents } from "./src/db.js";
    console.log(JSON.stringify(listChannelWebhookEvents("bot-a")));
  `], { cwd: projectRoot, env: { ...process.env, DATABASE_PATH: databasePath }, encoding: "utf8" });
  assert.equal(inspect.status, 0, inspect.stderr);
  assert.equal(JSON.parse(inspect.stdout).length, 1);
});
