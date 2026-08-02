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

test("night window accepts only forward ranges between midnight and 06:00", () => {
  assert.deepEqual(
    validateTagSyncNightWindow({ windowStart: "03:00", windowEnd: "06:00" }),
    { startMinute: 180, endMinute: 360 }
  );
  assert.deepEqual(
    validateTagSyncNightWindow({ windowStart: "00:00", windowEnd: "00:15" }),
    { startMinute: 0, endMinute: 15 }
  );
});

test("night window rejects values outside 00:00-06:00 and non-forward ranges", () => {
  for (const input of [
    { windowStart: "23:30", windowEnd: "04:00" },
    { windowStart: "03:00", windowEnd: "06:15" },
    { windowStart: "06:00", windowEnd: "06:00" },
    { windowStart: "03:00", windowEnd: "03:00" },
    { windowStart: "invalid", windowEnd: "04:00" }
  ]) {
    assert.throws(() => validateTagSyncNightWindow(input), /night window/i);
  }
});

test("window state uses the same Beijing calendar date inside the daily window", () => {
  const config = {
    nightlyEnabled: true,
    windowStart: "00:00",
    windowEnd: "04:00"
  };
  const midnight = getTagSyncWindowState(
    config,
    new Date("2026-08-01T16:00:00.000Z")
  );
  const afterWindow = getTagSyncWindowState(
    config,
    new Date("2026-08-01T21:00:00.000Z")
  );

  assert.equal(midnight.inside, true);
  assert.equal(midnight.windowKey, "2026-08-02");
  assert.equal(afterWindow.inside, false);
});
