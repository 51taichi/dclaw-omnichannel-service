import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TAG_SYNC_CONFIG,
  getTagSyncWindowState,
  normalizeTagSyncConfig,
  validateTagSyncNightWindow
} from "../src/tag-sync.js";

test("tag sync defaults are enabled with a 03:00-06:00 window", () => {
  assert.deepEqual(normalizeTagSyncConfig({}), DEFAULT_TAG_SYNC_CONFIG);
  assert.deepEqual(DEFAULT_TAG_SYNC_CONFIG, {
    nightlyEnabled: true,
    syncDateTags: false,
    windowStart: "03:00",
    windowEnd: "06:00"
  });
});

test("night window accepts same-side and cross-midnight ranges", () => {
  assert.deepEqual(
    validateTagSyncNightWindow({ windowStart: "03:00", windowEnd: "06:00" }),
    { startMinute: 1620, endMinute: 1800 }
  );
  assert.deepEqual(
    validateTagSyncNightWindow({ windowStart: "23:30", windowEnd: "04:00" }),
    { startMinute: 1410, endMinute: 1680 }
  );
});

test("night window rejects daytime reverse and zero-length ranges", () => {
  for (const input of [
    { windowStart: "21:00", windowEnd: "03:00" },
    { windowStart: "03:00", windowEnd: "10:00" },
    { windowStart: "07:00", windowEnd: "23:00" },
    { windowStart: "03:00", windowEnd: "03:00" },
    { windowStart: "invalid", windowEnd: "04:00" }
  ]) {
    assert.throws(() => validateTagSyncNightWindow(input), /night window/i);
  }
});

test("window state uses Beijing time and one date key across midnight", () => {
  const config = {
    nightlyEnabled: true,
    windowStart: "23:30",
    windowEnd: "04:00"
  };
  const beforeMidnight = getTagSyncWindowState(
    config,
    new Date("2026-08-01T16:00:00.000Z")
  );
  const afterMidnight = getTagSyncWindowState(
    config,
    new Date("2026-08-01T18:00:00.000Z")
  );
  const afterWindow = getTagSyncWindowState(
    config,
    new Date("2026-08-01T21:00:00.000Z")
  );

  assert.equal(beforeMidnight.inside, true);
  assert.equal(beforeMidnight.windowKey, "2026-08-01");
  assert.equal(afterMidnight.inside, true);
  assert.equal(afterMidnight.windowKey, "2026-08-01");
  assert.equal(afterWindow.inside, false);
});
