import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FRIEND_ADDED_SIGNAL_DEDUPE_MS,
  isFriendAddedSignalDuplicate,
  resolveFriendAddedSignal
} from "../src/friend-added-signals.js";

test("normalizes a WorkTool type 105 friend event into a private contact signal", () => {
  assert.deepEqual(
    resolveFriendAddedSignal({
      textType: 22,
      type: 105,
      friendName: "  知行合一  ",
      friendRemark: "",
      messageId: "friend-1"
    }),
    {
      trigger: "worktool_friend_event",
      friendName: "知行合一",
      message: {
        textType: 22,
        type: 105,
        friendName: "  知行合一  ",
        friendRemark: "",
        messageId: "friend-1",
        roomType: 2,
        receivedName: "知行合一",
        groupName: ""
      }
    }
  );
});

test("keeps the canonical system greeting as the primary private signal", () => {
  const message = {
    roomType: 2,
    textType: 1,
    receivedName: "易天缘",
    spoken: "我已经添加了你，现在我们可以开始聊天了。"
  };
  assert.deepEqual(resolveFriendAddedSignal(message), {
    trigger: "system_greeting",
    friendName: "易天缘",
    message
  });
});

test("rejects invalid friend events and missing friend names", () => {
  assert.equal(resolveFriendAddedSignal({ textType: 22, type: 999, friendName: "客户" }), null);
  assert.equal(resolveFriendAddedSignal({ textType: 22, type: 105, friendName: "  " }), null);
});

test("deduplicates signals inside the persisted 30 second window", () => {
  assert.equal(DEFAULT_FRIEND_ADDED_SIGNAL_DEDUPE_MS, 30_000);
  assert.equal(isFriendAddedSignalDuplicate({
    lastFriendAddedAt: "2026-07-29T09:45:00.000Z",
    occurredAt: "2026-07-29T09:45:29.999Z",
    dedupeMs: DEFAULT_FRIEND_ADDED_SIGNAL_DEDUPE_MS
  }), true);
  assert.equal(isFriendAddedSignalDuplicate({
    lastFriendAddedAt: "2026-07-29T09:45:00.000Z",
    occurredAt: "2026-07-29T09:45:30.000Z",
    dedupeMs: DEFAULT_FRIEND_ADDED_SIGNAL_DEDUPE_MS
  }), false);
});
