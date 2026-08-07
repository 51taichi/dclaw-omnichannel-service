import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");

function runScenario(source) {
  const directory = mkdtempSync(path.join(tmpdir(), "dclaw-first-history-sync-"));
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_PATH: path.join(directory, "service.sqlite") },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("first-contact history leases serialize workers and recover after expiry", () => {
  const result = runScenario(`
    import { claimFirstContactHistorySync, getFirstContactHistorySync } from "./src/db.js";
    const input = { botId: "bot-a", conversationKey: "whapi:chan:private:alice" };
    const first = claimFirstContactHistorySync({
      ...input, owner: "worker-a", leaseMs: 60000, nowIso: "2026-08-07T00:00:00.000Z"
    });
    const blocked = claimFirstContactHistorySync({
      ...input, owner: "worker-b", leaseMs: 60000, nowIso: "2026-08-07T00:00:30.000Z"
    });
    const recovered = claimFirstContactHistorySync({
      ...input, owner: "worker-b", leaseMs: 60000, nowIso: "2026-08-07T00:01:01.000Z"
    });
    console.log(JSON.stringify({ first, blocked, recovered, stored: getFirstContactHistorySync(input) }));
  `);

  assert.equal(result.first.claimed, true);
  assert.equal(result.first.record.attempts, 1);
  assert.equal(result.blocked.claimed, false);
  assert.equal(result.recovered.claimed, true);
  assert.equal(result.recovered.record.attempts, 2);
  assert.equal(result.stored.leaseOwner, "worker-b");
});

test("first-contact history completion enforces ownership and persists safe terminal state", () => {
  const result = runScenario(`
    import {
      claimFirstContactHistorySync,
      completeFirstContactHistorySync,
      getFirstContactHistorySync
    } from "./src/db.js";
    const input = { botId: "bot-a", conversationKey: "whapi:chan:private:alice" };
    claimFirstContactHistorySync({ ...input, owner: "worker-a", nowIso: "2026-08-07T00:00:00.000Z" });
    let wrongOwner = "";
    try {
      completeFirstContactHistorySync({ ...input, owner: "worker-b", status: "success" });
    } catch (error) { wrongOwner = error.message; }
    const completed = completeFirstContactHistorySync({
      ...input,
      owner: "worker-a",
      status: "failed",
      pageCount: 2,
      importedCount: 14,
      earliestAt: "2026-08-01T01:00:00.000Z",
      errorMessage: "x".repeat(300),
      nowIso: "2026-08-07T00:00:10.000Z"
    });
    const otherBot = getFirstContactHistorySync({ botId: "bot-b", conversationKey: input.conversationKey });
    console.log(JSON.stringify({ wrongOwner, completed, otherBot }));
  `);

  assert.match(result.wrongOwner, /lease is not owned/);
  assert.equal(result.completed.status, "failed");
  assert.equal(result.completed.pageCount, 2);
  assert.equal(result.completed.importedCount, 14);
  assert.equal(result.completed.earliestAt, "2026-08-01T01:00:00.000Z");
  assert.equal(result.completed.errorMessage.length, 160);
  assert.equal(result.completed.leaseOwner, "");
  assert.equal(result.otherBot, null);
});

test("first-contact history lease heartbeat extends only the current owner's lease", () => {
  const result = runScenario(`
    import { claimFirstContactHistorySync, renewFirstContactHistorySyncLease } from "./src/db.js";
    const input = { botId: "bot-a", conversationKey: "whapi:chan:private:heartbeat" };
    claimFirstContactHistorySync({
      ...input, owner: "worker-a", leaseMs: 60000, nowIso: "2026-08-07T00:00:00.000Z"
    });
    const renewed = renewFirstContactHistorySyncLease({
      ...input, owner: "worker-a", leaseMs: 60000, nowIso: "2026-08-07T00:00:30.000Z"
    });
    let wrongOwner = "";
    try {
      renewFirstContactHistorySyncLease({
        ...input, owner: "worker-b", leaseMs: 60000, nowIso: "2026-08-07T00:00:31.000Z"
      });
    } catch (error) { wrongOwner = error.message; }
    console.log(JSON.stringify({ renewed, wrongOwner }));
  `);
  assert.equal(result.renewed.leaseExpiresAt, "2026-08-07T00:01:30.000Z");
  assert.match(result.wrongOwner, /lease is not owned/);
});
