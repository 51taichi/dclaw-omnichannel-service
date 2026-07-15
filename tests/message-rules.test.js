import assert from "node:assert/strict";
import test from "node:test";
import {
  friendAddedName,
  isFriendAddedEvent,
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

test("recognizes WorkTool friend-added callbacks without treating them as text", () => {
  const event = { textType: 22, type: 105, friendName: "  新客户  " };
  assert.equal(isFriendAddedEvent(event), true);
  assert.equal(friendAddedName(event), "新客户");
  assert.equal(shouldProcessInboundForAgent(event), false);
});

test("does not confuse other empty WorkTool callbacks with friend additions", () => {
  assert.equal(isFriendAddedEvent({ textType: 22, type: 999, friendName: "客户" }), false);
  assert.equal(friendAddedName({ textType: 22, type: 105, friendName: "   " }), "");
});
