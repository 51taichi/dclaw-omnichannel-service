import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("server sends supported agent attachments as Channel media and links as text", () => {
  assert.equal(source.includes("sendAgentAttachments({"), true);
  assert.equal(source.includes("sendMediaMessage({"), true);
  assert.equal(source.includes("formatLinkAttachmentsForText"), true);
  assert.equal(source.includes("normalizeAgentAttachment"), true);
  assert.match(source, /supportedAgentMediaTypes\s*=\s*new Set\(\[[\s\S]*"image"[\s\S]*"file"[\s\S]*"video"[\s\S]*"audio"/);
  assert.match(source, /content:\s*replyWithLinkAttachments/);
});

test("server stores agent reply sources in conversation message raw payload", () => {
  assert.equal(source.includes("const sources = Array.isArray(agentReply.sources) ? agentReply.sources : []"), true);
  assert.equal(source.includes("sourceCount: sources.length"), true);
  assert.equal(source.includes("sources,"), true);
});

test("server logs agent attachment urls on Channel send success", () => {
  assert.equal(source.includes("attachmentUrls:"), true);
  assert.match(source, /sentAttachments\.map\(\(part\) => part\.attachment\?\.url/);
});

test("server supports multiple proactive media attachments per target", () => {
  assert.equal(source.includes("normalizeProactiveAttachments"), true);
  assert.match(source, /if \(attachments\.length > 5\) throw new Error\("attachments supports up to 5 files"\)/);
  assert.equal(source.includes("sendProactiveTargetMediaAttachments"), true);
  assert.match(source, /for \(const \[index, attachment\] of attachments\.entries\(\)\)/);
  assert.match(source, /extraText:\s*index === 0 \? payload\.extraText : ""/);
  assert.equal(source.includes("const messagePayload = { ...payload, attachments }"), true);
});
