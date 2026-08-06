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

function readArtifact(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function parseExampleEnvironment(source) {
  return Object.fromEntries(source
    .split(/\r?\n/u)
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
}

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

function waitForStartupLog(child, pattern) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`startup log did not match ${pattern}`));
    }, 10_000);
    child.stdout.on("data", (chunk) => {
      if (pattern.test(chunk.toString())) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`server exited before startup log (code=${code}, signal=${signal})`));
    });
  });
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

test("compose identifies the omnichannel deployment service and container", () => {
  const compose = readArtifact("compose.yaml");
  const serviceMatch = compose.match(/^services:\s*\n {2}([^:\n]+):/mu);
  const containerMatch = compose.match(/^ {4}container_name:\s*([^\s#]+)/mu);

  assert.equal(serviceMatch?.[1], "dclaw-omnichannel-service");
  assert.equal(containerMatch?.[1], "dclaw-omnichannel-service");
});

test("example environment documents isolated data and encrypted channel credentials", () => {
  const source = readArtifact(".env.example");
  const environment = parseExampleEnvironment(source);

  assert.equal(environment.BOT_ID, "");
  assert.equal(environment.CHANNEL_TOKEN_ENCRYPTION_KEY, "");
  assert.equal(environment.DATA_DIR, "./data");
  assert.equal(environment.DATABASE_PATH, "");
  assert.equal("ROBOT_ID" in environment, false);
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
      BOT_ID: "runtime-bot",
      ROBOT_ID: "",
      CALLBACK_SECRET: "test-callback-secret",
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
  const startupLog = waitForStartupLog(child, /DClaw omnichannel service/);
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(async () => {
    await stopProcess(child);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await startupLog;
  const health = await waitForHealth(port);
  assert.deepEqual(health.ok, true);
  assert.equal(health.service, "dclaw-omnichannel-service");
  assert.match(stdout, /DClaw omnichannel service/);
  const callback = await fetch(
    `http://127.0.0.1:${port}/worktool/command-callback?secret=test-callback-secret`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
  );
  assert.equal(callback.status, 404);
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
