import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const readme = read("../README.md");
const server = read("../src/server.js");
const adminClient = read("../src/config-patch-admin-client.js");

test("phase one documentation keeps omnichannel responsibilities narrow", () => {
  for (const name of [
    "OMNICHANNEL_CONFIG_PATCH_INTERNAL_SECRET",
    "CONFIG_PATCH_ADMIN_BASE_URL",
    "CONFIG_PATCH_ADMIN_SECRET"
  ]) {
    assert.equal(readme.includes(name), true, `missing ${name}`);
  }
  assert.match(readme, /Codex Token[\s\S]*创建、查询、撤销和轮换/);
  assert.match(readme, /不提供[\s\S]*上传[\s\S]*预检[\s\S]*发布/);
});

test("phase one omnichannel surface contains only readonly participant routes and token proxy routes", () => {
  const participantRoutes = [...server.matchAll(/app\.(get|post|put|delete)\(\s*"(\/internal\/config-patch\/v1\/[^"]+)"/g)]
    .map((match) => [match[1], match[2]]);
  assert.deepEqual(participantRoutes, [
    ["get", "/internal/config-patch/v1/bots"],
    ["get", "/internal/config-patch/v1/bots/:botId/snapshot"]
  ]);

  const adminPaths = [...adminClient.matchAll(/#request\("([^"]+)"|#request\(\s*`([^`]+)`/g)]
    .map((match) => match[1] || match[2]);
  assert.deepEqual(adminPaths, [
    "internal/admin/v1/staff-tokens",
    "internal/admin/v1/staff-tokens",
    "internal/admin/v1/staff-tokens/${encodeURIComponent(String(tokenId))}/revoke",
    "internal/admin/v1/staff-tokens/${encodeURIComponent(String(tokenId))}/rotate"
  ]);
  assert.doesNotMatch(server, /\/staff\/v1/);
});
