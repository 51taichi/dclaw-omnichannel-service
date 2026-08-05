import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(port) {
  const deadline = Date.now() + 10_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return response.json();
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error("health endpoint did not become ready");
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

test("package metadata identifies the omnichannel service", () => {
  const result = spawnSync("npm", ["pkg", "get", "name", "description"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    name: "dclaw-omnichannel-service",
    description: "Channel-neutral DClaw customer service and sales platform"
  });
});

test("health endpoint identifies the running omnichannel service", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dclaw-service-identity-"));
  const port = await reservePort();
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      DATABASE_PATH: path.join(dataDir, "service.sqlite"),
      BOTS_CONFIG_JSON: '{"bots":[]}',
      PROACTIVE_WORKER_ENABLED: "false",
      ACTIVATION_WORKER_ENABLED: "false",
      TAG_ACTIVATION_WORKER_ENABLED: "false",
      GROUP_AUTOMATION_WORKER_ENABLED: "false",
      CONVERSATION_RESET_WORKER_ENABLED: "false",
      COCKPIT_WORKER_ENABLED: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(async () => {
    await stopProcess(child);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const health = await waitForHealth(port);
  assert.deepEqual(health.ok, true);
  assert.equal(health.service, "dclaw-omnichannel-service");
  assert.match(stdout, /DClaw omnichannel service/);
  assert.equal(child.exitCode, null, stderr);
});

test("single-bot configuration prefers BOT_ID and falls back to ROBOT_ID", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dclaw-service-config-"));
  const configUrl = new URL("../src/config.js", import.meta.url).href;
  const runConfig = (env) => spawnSync(process.execPath, ["--input-type=module", "--eval", `
    const { loadBotBindingsFromConfig } = await import(${JSON.stringify(configUrl)});
    console.log(JSON.stringify(await loadBotBindingsFromConfig()));
  `], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
      BOTS_CONFIG_PATH: "",
      BOTS_CONFIG_JSON: "",
      DATABASE_PATH: path.join(dataDir, `${env.BOT_ID || env.ROBOT_ID}.sqlite`)
    },
    encoding: "utf8"
  });

  try {
    const common = {
      DCLAW_BASE_URL: "https://dclaw.example.test",
      DCLAW_PUBLIC_ID: "sales-agent"
    };
    const preferred = runConfig({ ...common, BOT_ID: "new-bot", ROBOT_ID: "legacy-bot" });
    const fallback = runConfig({ ...common, ROBOT_ID: "legacy-bot" });

    assert.equal(preferred.status, 0, preferred.stderr);
    assert.equal(fallback.status, 0, fallback.stderr);
    assert.equal(JSON.parse(preferred.stdout)[0].botId, "new-bot");
    assert.equal(JSON.parse(fallback.stdout)[0].botId, "legacy-bot");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
