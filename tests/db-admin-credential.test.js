import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-admin-credential-test-"));
process.env.DATA_DIR = dataDir;

const auth = await import("../src/auth.js");
const db = await import("../src/db.js");

test("global admin credential initializes once without storing plaintext", () => {
  const first = db.initializeGlobalAdminCredential({
    passwordHash: auth.hashAccessKey("first-secret")
  });
  const second = db.initializeGlobalAdminCredential({
    passwordHash: auth.hashAccessKey("replacement-secret")
  });

  assert.equal(first.initialized, true);
  assert.equal(second.initialized, false);
  assert.equal(first.credential.username, "admin");
  assert.equal(first.credential.passwordHash.includes("first-secret"), false);
  assert.equal(
    auth.verifyAccessKey("first-secret", db.getGlobalAdminCredential().passwordHash),
    true
  );
  assert.equal(
    auth.verifyAccessKey("replacement-secret", db.getGlobalAdminCredential().passwordHash),
    false
  );
});

test("global admin credential update replaces only the password hash", () => {
  const updated = db.updateGlobalAdminCredential({
    passwordHash: auth.hashAccessKey("database-secret")
  });

  assert.equal(updated.username, "admin");
  assert.equal(auth.verifyAccessKey("database-secret", updated.passwordHash), true);
  assert.equal(auth.verifyAccessKey("first-secret", updated.passwordHash), false);
});
