import assert from "node:assert/strict";
import test from "node:test";
import { shouldProcessInboundForAgent } from "../src/message-rules.js";

test("skips empty non-text channel webhooks before invoking agent", () => {
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

test("allows non-text callbacks with readable inbound attachments", () => {
  assert.equal(
    shouldProcessInboundForAgent({
      textType: 6,
      spoken: "",
      rawSpoken: "",
      fileUrl: "https://cdn.example.test/resume.pdf",
      fileName: "张三简历.pdf"
    }),
    true
  );
});

test("skips non-text callbacks with only unavailable local attachment paths", () => {
  assert.equal(
    shouldProcessInboundForAgent({
      textType: 2,
      spoken: "",
      rawSpoken: "",
      filePath: "/tmp/worktool/image.png",
      fileName: "截图.png"
    }),
    false
  );
});
