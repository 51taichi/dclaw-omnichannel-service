import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker ${endMarker}`);
  return source.slice(start, end);
}

test("tag sync APIs accept the current unlocked Bot session", () => {
  const routes = [
    [
      '"/api/bots/:botId/tag-sync/config"',
      '"/api/bots/:botId/tag-sync/status"'
    ],
    [
      '"/api/bots/:botId/tag-sync/status"',
      '"/api/bots/:botId/tag-sync/run"'
    ],
    [
      '"/api/bots/:botId/tag-sync/run"',
      '"/api/bots/:botId/settings/debug-reply"'
    ]
  ];
  for (const [start, end] of routes) {
    assert.match(section(start, end), /assertBotAccess\(req, req\.params\.botId\)/);
    assert.doesNotMatch(section(start, end), /assertAdminForBot\(req, req\.params\.botId\)/);
  }
  assert.equal(source.match(/"\/api\/bots\/:botId\/tag-sync\/config"/g)?.length, 2);
});

test("WorkTool command callback routes are removed", () => {
  assert.doesNotMatch(source, /app\.post\("\/worktool\/[^\"]*command-callback"/);
  assert.doesNotMatch(source, /tagSyncWorker\.handleCommandCallback/);
});

test("tag sync worker observes message processing without wrapping old sends", () => {
  assert.match(source, /createTagSyncWorker\(\{/);
  assert.match(source, /hasRecentBotMessageProcessing\(\{/);
  assert.match(source, /getSubmittedTagSyncCommand/);
  assert.doesNotMatch(source, /tagSync[^\n]*sendTextMessage/);
  assert.doesNotMatch(source, /tagSync[^\n]*processFlowActivationBatch/);
  assert.doesNotMatch(source, /tagSync[^\n]*processNextProactiveTarget/);
});

test("tag sync startup recovers leases and runs a non-overlapping timer", () => {
  assert.match(source, /migrateTagSyncNightlyDefaultEnabled\(\)/);
  assert.match(source, /tagSyncWorker\.recover\(new Date\(\)\)/);
  assert.match(source, /tagSyncWorker\.tick\(new Date\(\)\)/);
  assert.match(source, /TAG_SYNC_WORKER_INTERVAL_MS/);
  assert.match(source, /process\.env\.TAG_SYNC_WORKER_LEASE_MS/);
  assert.match(source, /process\.env\.TAG_SYNC_REALTIME_ACTIVITY_TTL_MS/);
  assert.match(source, /leaseMs:\s*TAG_SYNC_WORKER_LEASE_MS/);
});
