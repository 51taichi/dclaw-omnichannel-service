import assert from "node:assert/strict";
import test from "node:test";
import {
  isSystemFriendGreeting,
  shouldProcessInboundForAgent
} from "../src/message-rules.js";

test("skips empty non-text WorkTool callbacks before invoking agent", () => {
  assert.equal(
    shouldProcessInboundForAgent({
      textType: 22,
      spoken: "",
      rawSpoken: "",
      rawMessage: "",
      filePath: ""
    }),
    false
  );
});

test("allows text callbacks with customer content", () => {
  assert.equal(
    shouldProcessInboundForAgent({
      textType: 1,
      spoken: "你好",
      rawSpoken: "你好"
    }),
    true
  );
});

test("does not treat WorkTool friend-added callbacks as ordinary Agent messages", () => {
  assert.equal(
    shouldProcessInboundForAgent({
      textType: 22,
      type: 105,
      friendName: "新客户"
    }),
    false
  );
});

test("recognizes the WeCom automatic friend greeting but not similar customer text", () => {
  assert.equal(
    isSystemFriendGreeting({
      textType: 1,
      roomType: 2,
      spoken: "我已经添加了你，现在我们可以开始聊天了。"
    }),
    true
  );
  assert.equal(
    isSystemFriendGreeting({
      textType: 1,
      roomType: 2,
      spoken: "我已经添加了你，现在可以聊聊产品了"
    }),
    false
  );
  assert.equal(
    isSystemFriendGreeting({
      textType: 1,
      roomType: 1,
      spoken: "我已经添加了你，现在我们可以开始聊天了。"
    }),
    false
  );
});
