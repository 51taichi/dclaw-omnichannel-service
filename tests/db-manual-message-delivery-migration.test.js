import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("database startup upgrades legacy outgoing messages before creating delivery indexes", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dclaw-manual-delivery-migration-"));
  const databasePath = path.join(directory, "legacy.sqlite");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE outgoing_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id TEXT NOT NULL,
      agent_id TEXT,
      conversation_key TEXT,
      message_id TEXT,
      target_name TEXT,
      content TEXT NOT NULL,
      channel_response_json TEXT,
      callback_error_code INTEGER,
      callback_error_reason TEXT,
      callback_payload_json TEXT,
      callback_at TEXT,
      created_at TEXT NOT NULL
    );
  `);
  legacy.close();

  try {
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `
      await import("./src/db.js");
    `], {
      cwd: projectRoot,
      env: { ...process.env, DATABASE_PATH: databasePath },
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);

    const upgraded = new DatabaseSync(databasePath);
    const columns = upgraded.prepare("PRAGMA table_info(outgoing_messages)").all()
      .map((column) => column.name);
    const indexes = upgraded.prepare("PRAGMA index_list(outgoing_messages)").all()
      .map((index) => index.name);
    upgraded.close();

    for (const column of [
      "provider",
      "channel_account_id",
      "delivery_status",
      "delivery_error",
      "delivery_updated_at"
    ]) {
      assert.ok(columns.includes(column), `${column} is added before delivery indexes`);
    }
    assert.ok(indexes.includes("idx_outgoing_messages_manual_delivery_lookup"));
    assert.ok(indexes.includes("idx_outgoing_messages_callback_lookup"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
