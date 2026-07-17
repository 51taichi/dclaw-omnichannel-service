import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("server does not alter agent replies with emoji fallbacks", () => {
  const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

  assert.equal(source.includes("ensureReplyEmoji"), false);
  assert.equal(source.includes("WORKTOOL_ENSURE_REPLY_EMOJI"), false);
  assert.equal(source.includes("WORKTOOL_REPLY_DEFAULT_EMOJI"), false);
});

test("server never sends WorkTool friend remark sync commands", () => {
  const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

  assert.equal(source.includes("sendFriendInfoUpdate"), false);
  assert.equal(source.includes("extractCustomerProfileForRemarkSync"), false);
  assert.equal(source.includes("patchContainsCustomerProfileField"), false);
  assert.equal(source.includes("formatFriendRemarkName"), false);
  assert.equal(source.includes("maybeSyncFriendRemarkFromFlowData"), false);
  assert.equal(source.includes("WORKTOOL_FRIEND_REMARK_SYNC_ENABLED"), false);
  assert.equal(source.includes("friend_remark.sync.success"), false);
  assert.equal(source.includes("friend_remark.sync.failed"), false);
});
