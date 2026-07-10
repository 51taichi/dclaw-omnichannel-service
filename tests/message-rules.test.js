import assert from "node:assert/strict";
import test from "node:test";
import { shouldProcessInboundForAgent } from "../src/message-rules.js";

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
