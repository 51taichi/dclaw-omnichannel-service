import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("server exposes singleton global administrator sessions", () => {
  for (const route of [
    '"/api/admin/login"',
    '"/api/admin/logout"',
    '"/api/admin/session"',
    '"/api/admin/password"'
  ]) {
    assert.equal(source.includes(route), true, `missing ${route}`);
  }
  assert.equal(source.includes("x-admin-session-token"), true);
  assert.equal(source.includes("initializeAdminAuth({"), true);
  assert.equal(source.includes("verifyAdminPassword(getRequestAdminKey(req))"), true);
  assert.equal(source.includes("key === process.env.ADMIN_API_KEY"), false);
});

test("existing administrator guards accept the global admin session", () => {
  assert.equal(source.includes("getRequestAdminSession(req)"), true);
  assert.match(source, /function assertAdminAccess\(req\)[\s\S]*getRequestAdminSession\(req\)/);
  assert.match(source, /function assertAdminForBot\(req, botId\)[\s\S]*getRequestAdminSession\(req\)/);
});
