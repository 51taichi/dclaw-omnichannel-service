import assert from "node:assert/strict";
import test from "node:test";
import {
  extractInboundAttachments,
  hasAvailableInboundAttachment,
  inboundAttachmentPlaceholder
} from "../src/inbound-attachments.js";

test("normalizes public WorkTool file callbacks", () => {
  const message = {
    textType: 6,
    fileUrl: "https://cdn.example.test/resume.pdf",
    fileName: "张三简历.pdf"
  };

  assert.deepEqual(extractInboundAttachments(message), [
    {
      type: "file",
      url: "https://cdn.example.test/resume.pdf",
      name: "张三简历.pdf",
      textType: 6,
      source: "worktool_callback",
      available: true
    }
  ]);
  assert.equal(hasAvailableInboundAttachment(message), true);
  assert.equal(inboundAttachmentPlaceholder(message), "[文件] 张三简历.pdf");
});

test("keeps non-public WorkTool paths unavailable", () => {
  const message = {
    textType: 2,
    filePath: "/tmp/worktool/image.png",
    fileName: "截图.png"
  };

  assert.deepEqual(extractInboundAttachments(message), [
    {
      type: "image",
      url: "",
      name: "截图.png",
      textType: 2,
      source: "worktool_callback",
      available: false
    }
  ]);
  assert.equal(hasAvailableInboundAttachment(message), false);
  assert.equal(inboundAttachmentPlaceholder(message), "[图片] 截图.png");
});
