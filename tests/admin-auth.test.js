import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-admin-auth-test-"));
process.env.DATA_DIR = dataDir;

const adminAuth = await import("../src/admin-auth.js");

test("admin auth bootstraps once and preserves the database password", () => {
  const first = adminAuth.initializeAdminAuth({ bootstrapPassword: "env-secret" });
  const second = adminAuth.initializeAdminAuth({ bootstrapPassword: "other-env-secret" });

  assert.equal(first.ready, true);
  assert.equal(first.initialized, true);
  assert.equal(second.ready, true);
  assert.equal(second.initialized, false);
  assert.equal(adminAuth.verifyAdminPassword("env-secret"), true);
  assert.equal(adminAuth.verifyAdminPassword("other-env-secret"), false);
});

test("admin sessions expire and password changes invalidate active sessions", () => {
  const expiring = adminAuth.createAdminSession({ ttlMs: 1000, nowMs: 100 });
  assert.equal(adminAuth.getAdminSession(expiring.token, { nowMs: 500 }).role, "admin");
  assert.equal(adminAuth.getAdminSession(expiring.token, { nowMs: 1101 }), null);

  const active = adminAuth.createAdminSession({ nowMs: 200 });
  adminAuth.changeAdminPassword("database-secret");

  assert.equal(adminAuth.getAdminSession(active.token), null);
  assert.equal(adminAuth.verifyAdminPassword("database-secret"), true);
  assert.equal(adminAuth.verifyAdminPassword("env-secret"), false);
});

test("admin password recovery can initialize an empty database", async () => {
  const emptyDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-admin-recovery-test-"));
  const scriptUrl = new URL("../scripts/reset-admin-password.js", import.meta.url);
  const source = fs.readFileSync(scriptUrl, "utf8");

  assert.match(source, /initializeOrChangeAdminPassword/);
  assert.doesNotMatch(source, /console\.log\([^)]*password/i);
  assert.equal(typeof adminAuth.initializeOrChangeAdminPassword, "function");

  process.env.DATA_DIR = emptyDataDir;
});
