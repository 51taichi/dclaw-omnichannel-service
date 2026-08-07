import assert from "node:assert/strict";
import test from "node:test";
import { shouldRunFirstContactHistorySync } from "../src/first-contact-history-trigger.js";

test("unknown conversations run history sync", () => {
  assert.equal(shouldRunFirstContactHistorySync({ hadConversation: false, syncRecord: null }), true);
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
