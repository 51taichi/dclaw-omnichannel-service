import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-group-automation-cleanup-test-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");

function tableNames() {
  const sqlite = new DatabaseSync(path.join(dataDir, "worktool-bot-service.sqlite"));
  const names = sqlite.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `).all().map((row) => row.name);
  sqlite.close();
  return names;
}

test("obsolete full-history tables are removed idempotently without deleting task audit", () => {
  const before = tableNames();
  assert.equal(before.includes("managed_group_history_sync_states"), true);
  assert.equal(before.includes("managed_group_automation_chunks"), true);
  assert.equal(before.includes("managed_group_automation_tasks"), true);
  assert.equal(before.includes("managed_group_automation_occurrences"), true);
  assert.equal(before.includes("managed_group_automation_attempts"), true);
  assert.equal(before.includes("conversation_messages"), true);

  assert.deepEqual(db.finalizeObsoleteGroupHistoryRemoval(), { removed: true });
  assert.deepEqual(db.finalizeObsoleteGroupHistoryRemoval(), { removed: false });

  const after = tableNames();
  assert.equal(after.includes("managed_group_history_sync_states"), false);
  assert.equal(after.includes("managed_group_automation_chunks"), false);
  assert.equal(after.includes("managed_group_automation_tasks"), true);
  assert.equal(after.includes("managed_group_automation_occurrences"), true);
  assert.equal(after.includes("managed_group_automation_attempts"), true);
  assert.equal(after.includes("conversation_messages"), true);
});
