import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(file) {
  return fs.readFileSync(new URL(file, import.meta.url), "utf8");
}

const runtimeSource = [
  "../src/server.js",
  "../src/group-automation-worker.js",
  "../src/group-automation-agent.js",
  "../src/dclaw.js",
  "../src/dclaw-conversation-identity.js",
  "../README.md",
  "../.env.example"
].map(source).join("\n");

const dbSource = source("../src/db.js");

test("group automation runtime cannot restore a second full-history pipeline", () => {
  assert.doesNotMatch(runtimeSource, /GROUP_HISTORY_SYNC_/u);
  assert.doesNotMatch(runtimeSource, /group-history-analysis/u);
  assert.doesNotMatch(runtimeSource, /createGroupHistorySyncWorker/u);
  assert.doesNotMatch(runtimeSource, /buildCompactGroupTranscript/u);
  assert.doesNotMatch(runtimeSource, /packTranscriptChunks/u);

  for (const file of [
    "../src/dclaw-group-history.js",
    "../src/group-history-sync-worker.js",
    "../src/group-history-transcript.js"
  ]) {
    assert.equal(fs.existsSync(new URL(file, import.meta.url)), false, file);
  }
});

test("database keeps cleanup compatibility but cannot recreate obsolete history or chunk state", () => {
  assert.match(dbSource, /finalizeObsoleteGroupHistoryRemoval/u);
  assert.doesNotMatch(
    dbSource,
    /CREATE TABLE IF NOT EXISTS managed_group_history_sync_states/u
  );
  assert.doesNotMatch(
    dbSource,
    /CREATE TABLE IF NOT EXISTS managed_group_automation_chunks/u
  );
  assert.doesNotMatch(dbSource, /export function getGroupHistorySyncState/u);
  assert.doesNotMatch(dbSource, /export function saveGroupAutomationChunkCheckpoint/u);
  assert.doesNotMatch(dbSource, /export function claimPreparatoryGroupAutomationOccurrences/u);
  assert.doesNotMatch(dbSource, /export function claimTargetGroupAutomationOccurrences/u);
});
