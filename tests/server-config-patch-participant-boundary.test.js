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

async function startServer(t, { databasePath, secret }) {
  const port = await reservePort();
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    DATABASE_PATH: databasePath,
    BOTS_CONFIG_JSON: '{"bots":[]}',
    PROACTIVE_WORKER_ENABLED: "false",
    ACTIVATION_WORKER_ENABLED: "false",
    TAG_ACTIVATION_WORKER_ENABLED: "false",
    GROUP_AUTOMATION_WORKER_ENABLED: "false",
    CONVERSATION_RESET_WORKER_ENABLED: "false",
    COCKPIT_WORKER_ENABLED: "false"
  };
  if (secret === undefined) delete env.OMNICHANNEL_CONFIG_PATCH_INTERNAL_SECRET;
  else env.OMNICHANNEL_CONFIG_PATCH_INTERNAL_SECRET = secret;

  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: projectRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
  });
  await waitForServer(port);
  return { port, stderr: () => stderr };
}

function request(port, pathname, secret) {
  const headers = secret === undefined
    ? {}
    : { "x-omnichannel-config-patch-secret": secret };
  return fetch(`http://127.0.0.1:${port}${pathname}`, { headers });
}

test("internal config patch routes fail closed when service authentication is unconfigured", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omnichannel-config-patch-http-empty-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const server = await startServer(t, { databasePath: path.join(directory, "service.sqlite") });

  const response = await request(server.port, "/internal/config-patch/v1/bots");
  assert.equal(response.status, 503, server.stderr());
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "CONFIG_PATCH_SERVICE_NOT_CONFIGURED",
    message: "config patch service authentication is not configured"
  });
});

test("internal config patch routes expose only readonly Bot snapshots", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omnichannel-config-patch-http-"));
  const databasePath = path.join(directory, "service.sqlite");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const seed = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import { upsertAgent, upsertBotBinding } from "./src/db.js";
    upsertAgent({
      agentId: "agent-http", agentName: "HTTP Agent",
      dclawBaseUrl: "https://dclaw.internal.example", dclawPublicId: "agent-public",
      agentApiKey: "agent-api-secret-value", enabled: true
    });
    upsertBotBinding({ botId: "bot-http", botName: "HTTP Bot", agentId: "agent-http", enabled: true });
  `], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_PATH: databasePath },
    encoding: "utf8"
  });
  assert.equal(seed.status, 0, seed.stderr);

  const server = await startServer(t, { databasePath, secret: "route-secret" });

  for (const supplied of [undefined, "wrong-secret"]) {
    const denied = await request(server.port, "/internal/config-patch/v1/bots", supplied);
    assert.equal(denied.status, 401, server.stderr());
    assert.equal((await denied.json()).code, "CONFIG_PATCH_SERVICE_UNAUTHORIZED");
  }

  const listResponse = await request(server.port, "/internal/config-patch/v1/bots", "route-secret");
  assert.equal(listResponse.status, 200, server.stderr());
  const listBody = await listResponse.json();
  assert.equal(listBody.ok, true);
  assert.deepEqual(listBody.bots.map(({ botId }) => botId), ["bot-http"]);

  const snapshotResponse = await request(
    server.port,
    "/internal/config-patch/v1/bots/bot-http/snapshot",
    "route-secret"
  );
  assert.equal(snapshotResponse.status, 200, server.stderr());
  const snapshotBody = await snapshotResponse.json();
  assert.equal(snapshotBody.snapshot.bot.botId, "bot-http");
  const serialized = JSON.stringify(snapshotBody);
  for (const forbidden of [
    "agentApiKey",
    "accessKeyHash",
    "tokenCiphertext",
    "webhookSecretHash",
    "agent-api-secret-value",
    "route-secret"
  ]) {
    assert.equal(serialized.includes(forbidden), false, `HTTP response leaked ${forbidden}`);
  }

  const missingResponse = await request(
    server.port,
    "/internal/config-patch/v1/bots/missing/snapshot",
    "route-secret"
  );
  assert.equal(missingResponse.status, 404, server.stderr());
  assert.equal((await missingResponse.json()).code, "CONFIG_PATCH_BOT_NOT_FOUND");

  const publicResponse = await request(server.port, "/api/public/bots");
  assert.equal(publicResponse.status, 200, server.stderr());
  assert.deepEqual((await publicResponse.json()).bots.map(({ botId }) => botId), ["bot-http"]);
});
