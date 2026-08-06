import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("production removes external contact tag synchronization", () => {
  assert.doesNotMatch(source, /\/tag-sync\//);
  assert.doesNotMatch(source, /createTagSyncWorker/);
  assert.doesNotMatch(source, /tagSyncWorker/);
  assert.doesNotMatch(source, /syncFriendTags/);
});
