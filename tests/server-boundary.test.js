import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("server does not alter agent replies with emoji fallbacks", () => {
  const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

  assert.equal(source.includes("ensureReplyEmoji"), false);
  assert.equal(source.includes("WORKTOOL_ENSURE_REPLY_EMOJI"), false);
  assert.equal(source.includes("WORKTOOL_REPLY_DEFAULT_EMOJI"), false);
});

test("server keeps WorkTool friend remark sync disabled unless explicitly enabled", () => {
  const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

  assert.equal(source.includes("sendFriendInfoUpdate"), true);
  assert.equal(source.includes("extractCustomerProfileForRemarkSync"), true);
  assert.equal(source.includes("patchContainsCustomerProfileField"), true);
  assert.equal(source.includes("formatFriendRemarkName"), true);
  assert.equal(source.includes("maybeSyncFriendRemarkFromFlowData({"), true);
  assert.equal(source.includes("WORKTOOL_FRIEND_REMARK_SYNC_ENABLED"), true);
  assert.match(source, /const friendRemarkSyncEnabled\s*=[\s\S]*WORKTOOL_FRIEND_REMARK_SYNC_ENABLED[\s\S]*===\s*"true"/);
  assert.match(source, /if \(!friendRemarkSyncEnabled\) return null;/);
  assert.equal(source.includes("friend_remark.sync.success"), true);
  assert.equal(source.includes("friend_remark.sync.failed"), true);
  assert.match(source, /applyFlowDecision\(\{[\s\S]*message[\s\S]*binding/);
});
