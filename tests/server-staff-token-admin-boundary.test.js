import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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

async function startOmnichannel(t, { databasePath, patchBaseUrl, patchSecret }) {
  const port = await reservePort();
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    DATABASE_PATH: databasePath,
    ADMIN_API_KEY: "omnichannel-admin-password",
    BOTS_CONFIG_JSON: '{"bots":[]}',
    PROACTIVE_WORKER_ENABLED: "false",
    ACTIVATION_WORKER_ENABLED: "false",
    TAG_ACTIVATION_WORKER_ENABLED: "false",
    GROUP_AUTOMATION_WORKER_ENABLED: "false",
    CONVERSATION_RESET_WORKER_ENABLED: "false",
    COCKPIT_WORKER_ENABLED: "false"
  };
  delete env.CONFIG_PATCH_ADMIN_BASE_URL;
  delete env.CONFIG_PATCH_ADMIN_SECRET;
  if (patchBaseUrl !== undefined) env.CONFIG_PATCH_ADMIN_BASE_URL = patchBaseUrl;
  if (patchSecret !== undefined) env.CONFIG_PATCH_ADMIN_SECRET = patchSecret;
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

async function login(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "omnichannel-admin-password" })
  });
  assert.equal(response.status, 200);
  return (await response.json()).session.token;
}

function adminFetch(port, session, pathname, options = {}) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-admin-session-token": session,
      ...(options.headers || {})
    }
  });
}

test("admin session proxies only the narrow staff-token contract", async (t) => {
  const upstreamRequests = [];
  const upstream = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    upstreamRequests.push({ method: req.method, url: req.url, headers: req.headers, body });
    res.setHeader("content-type", "application/json");
    if (req.url.endsWith("/rotate")) {
      res.end(JSON.stringify({ tokenId: "token-a", employeeName: "张三", tokenName: "Codex", token: "dclaw_staff_rotated" }));
    } else if (req.url.endsWith("/revoke")) {
      res.end(JSON.stringify({ tokenId: "token-a", employeeName: "张三", tokenName: "Codex", revokedAt: "2026-10-01T01:00:00Z" }));
    } else if (req.method === "POST") {
      res.statusCode = 201;
      res.end(JSON.stringify({ tokenId: "token-a", employeeName: "张三", tokenName: "Codex", token: "dclaw_staff_created" }));
    } else {
      res.end(JSON.stringify({ tokens: [] }));
    }
  });
  const upstreamPort = await reservePort();
  upstream.listen(upstreamPort, "127.0.0.1");
  t.after(() => new Promise((resolve) => upstream.close(resolve)));

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omnichannel-token-admin-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const server = await startOmnichannel(t, {
    databasePath: path.join(directory, "service.sqlite"),
    patchBaseUrl: `http://127.0.0.1:${upstreamPort}`,
    patchSecret: "patch-admin-service-secret"
  });
  const session = await login(server.port);

  const denied = await fetch(`http://127.0.0.1:${server.port}/api/admin/staff-tokens`);
  assert.equal(denied.status, 401);

  const listed = await adminFetch(server.port, session, "/api/admin/staff-tokens");
  const created = await adminFetch(server.port, session, "/api/admin/staff-tokens", {
    method: "POST",
    body: JSON.stringify({
      employeeName: "张三",
      tokenName: "Home Codex",
      expiresAt: null,
      baseUrl: "https://caller-controlled.invalid",
      adminSecret: "caller-controlled-secret"
    })
  });
  const revoked = await adminFetch(server.port, session, "/api/admin/staff-tokens/token-a/revoke", { method: "POST" });
  const rotated = await adminFetch(server.port, session, "/api/admin/staff-tokens/token-a/rotate", { method: "POST" });

  assert.equal(listed.status, 200, server.stderr());
  assert.equal(created.status, 201, server.stderr());
  assert.equal((await created.json()).token, "dclaw_staff_created");
  assert.equal(revoked.status, 200, server.stderr());
  assert.equal((await rotated.json()).token, "dclaw_staff_rotated");
  assert.deepEqual(upstreamRequests.map(({ method, url }) => [method, url]), [
    ["GET", "/internal/admin/v1/staff-tokens"],
    ["POST", "/internal/admin/v1/staff-tokens"],
    ["POST", "/internal/admin/v1/staff-tokens/token-a/revoke"],
    ["POST", "/internal/admin/v1/staff-tokens/token-a/rotate"]
  ]);
  for (const request of upstreamRequests) {
    assert.equal(request.headers["x-config-patch-admin-secret"], "patch-admin-service-secret");
    assert.equal(request.headers["x-admin-session-token"], undefined);
  }
  assert.deepEqual(JSON.parse(upstreamRequests[1].body), {
    employeeName: "张三",
    tokenName: "Home Codex",
    expiresAt: null
  });
});

test("unconfigured patch admin affects only token proxy routes", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omnichannel-token-admin-empty-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const server = await startOmnichannel(t, {
    databasePath: path.join(directory, "service.sqlite")
  });
  const session = await login(server.port);

  const tokens = await adminFetch(server.port, session, "/api/admin/staff-tokens");
  const workspaces = await adminFetch(server.port, session, "/api/admin/workspaces");
  const bots = await adminFetch(server.port, session, "/api/bots");
  const agents = await adminFetch(server.port, session, "/api/agents");

  assert.equal(tokens.status, 503, server.stderr());
  assert.deepEqual(await tokens.json(), {
    ok: false,
    code: "CONFIG_PATCH_ADMIN_NOT_CONFIGURED",
    message: "Codex Token service is not configured"
  });
  assert.equal(workspaces.status, 200, server.stderr());
  assert.equal(bots.status, 200, server.stderr());
  assert.equal(agents.status, 200, server.stderr());
});
