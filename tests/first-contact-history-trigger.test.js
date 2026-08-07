import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldRunFirstContactHistorySync,
  waitForActiveFirstContactHistorySync
} from "../src/first-contact-history-trigger.js";

test("unknown conversations run history sync", () => {
  assert.equal(shouldRunFirstContactHistorySync({ hadConversation: false, syncRecord: null }), true);
  assert.equal(shouldRunFirstContactHistorySync({
    hadConversation: false, syncRecord: { status: "success" }
  }), false);
});

test("concurrent messages wait for the active history lease owner", async () => {
  let currentTime = Date.parse("2026-08-08T00:00:00.000Z");
  let reads = 0;
  const result = await waitForActiveFirstContactHistorySync({
    syncRecord: { status: "processing", leaseExpiresAt: "2026-08-08T00:01:00.000Z" },
    readSync: () => {
      reads += 1;
      return reads < 2
        ? { status: "processing", leaseExpiresAt: "2026-08-08T00:01:00.000Z" }
        : { status: "success", leaseExpiresAt: "" };
    },
    now: () => currentTime,
    sleep: async (delayMs) => { currentTime += delayMs; }
  });
  assert.equal(result.status, "success");
  assert.equal(reads, 2);
});

test("existing conversations only retry an expired processing lease", () => {
  const nowIso = "2026-08-08T00:01:00.000Z";
  assert.equal(shouldRunFirstContactHistorySync({
    hadConversation: true,
    syncRecord: { status: "processing", leaseExpiresAt: "2026-08-08T00:00:59.000Z" },
    nowIso
  }), true);
  assert.equal(shouldRunFirstContactHistorySync({
    hadConversation: true,
    syncRecord: { status: "processing", leaseExpiresAt: "2026-08-08T00:01:01.000Z" },
    nowIso
  }), false);
  for (const status of ["success", "failed", "unavailable"]) {
    assert.equal(shouldRunFirstContactHistorySync({
      hadConversation: true, syncRecord: { status }, nowIso
    }), false);
  }
  assert.equal(shouldRunFirstContactHistorySync({ hadConversation: true, syncRecord: null, nowIso }), false);
});
