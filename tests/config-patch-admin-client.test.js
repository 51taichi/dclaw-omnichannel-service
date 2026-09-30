import assert from "node:assert/strict";
import test from "node:test";

import {
  ConfigPatchAdminClient,
  ConfigPatchAdminError
} from "../src/config-patch-admin-client.js";

function tokenView(overrides = {}) {
  return {
    tokenId: "token-id-a",
    employeeName: "张三",
    tokenName: "Home Codex",
    tokenPrefix: "dclaw_staff_abcd",
    tokenSuffix: "wxyz",
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    ...overrides
  };
}

test("admin client forwards exact paths and dedicated server credential", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    const pathname = new URL(url).pathname;
    if (pathname.endsWith("/rotate")) {
      return new Response(JSON.stringify({ ...tokenView(), token: "dclaw_staff_rotated" }), { status: 200 });
    }
    if (pathname.endsWith("/revoke")) {
      return new Response(JSON.stringify(tokenView({ revokedAt: "2026-10-01T01:00:00Z" })), { status: 200 });
    }
    if (options.method === "POST") {
      return new Response(JSON.stringify({ ...tokenView(), token: "dclaw_staff_created" }), { status: 201 });
    }
    return new Response(JSON.stringify({ tokens: [tokenView()] }), { status: 200 });
  };
  const client = new ConfigPatchAdminClient({
    baseUrl: "https://patch.internal.example/root/",
    adminSecret: "service-admin-secret",
    fetchImpl
  });

  const listed = await client.listTokens();
  const created = await client.createToken({
    employeeName: "张三",
    tokenName: "Home Codex",
    expiresAt: null,
    baseUrl: "https://caller-controlled.invalid",
    adminSecret: "caller-secret"
  });
  await client.revokeToken("token-id-a");
  const rotated = await client.rotateToken("token-id-a");

  assert.equal(listed.tokens[0].tokenId, "token-id-a");
  assert.equal(created.token, "dclaw_staff_created");
  assert.equal(rotated.token, "dclaw_staff_rotated");
  assert.deepEqual(requests.map(({ url }) => new URL(url).pathname), [
    "/root/internal/admin/v1/staff-tokens",
    "/root/internal/admin/v1/staff-tokens",
    "/root/internal/admin/v1/staff-tokens/token-id-a/revoke",
    "/root/internal/admin/v1/staff-tokens/token-id-a/rotate"
  ]);
  for (const { options } of requests) {
    assert.equal(options.headers["X-Config-Patch-Admin-Secret"], "service-admin-secret");
    assert.equal(options.headers["x-admin-session-token"], undefined);
  }
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    employeeName: "张三",
    tokenName: "Home Codex",
    expiresAt: null
  });
});

test("admin client fails closed when unconfigured and sanitizes upstream failures", async () => {
  const unconfigured = new ConfigPatchAdminClient({ baseUrl: "", adminSecret: "" });
  await assert.rejects(
    () => unconfigured.listTokens(),
    (error) => error instanceof ConfigPatchAdminError
      && error.status === 503
      && error.code === "CONFIG_PATCH_ADMIN_NOT_CONFIGURED"
  );

  const responseSecret = "response-body-secret-must-not-leak";
  const configuredSecret = "configured-secret-must-not-leak";
  const unavailable = new ConfigPatchAdminClient({
    baseUrl: "https://patch.internal.example",
    adminSecret: configuredSecret,
    fetchImpl: async () => new Response(responseSecret, { status: 502 })
  });
  await assert.rejects(
    () => unavailable.listTokens(),
    (error) => {
      assert.equal(error.code, "CONFIG_PATCH_ADMIN_UNAVAILABLE");
      assert.equal(error.status, 503);
      assert.equal(String(error).includes(responseSecret), false);
      assert.equal(String(error).includes(configuredSecret), false);
      return true;
    }
  );
});
