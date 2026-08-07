import assert from "node:assert/strict";
import test from "node:test";

import { normalizeManualReply } from "../src/manual-reply.js";

test("manual replies accept text, attachments, or both", () => {
  assert.deepEqual(normalizeManualReply({ content: " hello " }), {
    content: "hello",
    attachments: [],
    conversationContent: "hello"
  });

  assert.deepEqual(normalizeManualReply({
    content: "",
    attachments: [{ fileUrl: " https://example.com/a.pdf ", objectName: " a.pdf ", fileType: "file" }]
  }), {
    content: "",
    attachments: [{ fileUrl: "https://example.com/a.pdf", objectName: "a.pdf", fileType: "file" }],
    conversationContent: "[文件] a.pdf"
  });

  assert.deepEqual(normalizeManualReply({
    content: "caption",
    attachments: [{ fileUrl: "https://example.com/a.jpg", objectName: "a.jpg", fileType: "image" }]
  }).conversationContent, "caption");
});

test("manual replies reject invalid attachment collections", () => {
  assert.throws(() => normalizeManualReply({ content: "", attachments: [] }), /content or attachments is required/);
  assert.throws(() => normalizeManualReply({
    attachments: Array.from({ length: 6 }, (_, index) => ({
      fileUrl: `https://example.com/${index}.pdf`, objectName: `${index}.pdf`, fileType: "file"
    }))
  }), /up to 5/);
  assert.throws(() => normalizeManualReply({
    attachments: [{ fileUrl: "", objectName: "a.pdf", fileType: "file" }]
  }), /fileUrl is required/);
  assert.throws(() => normalizeManualReply({
    attachments: [{ fileUrl: "https://example.com/a.exe", objectName: "a.exe", fileType: "binary" }]
  }), /fileType must be image, video, audio, or file/);
});
