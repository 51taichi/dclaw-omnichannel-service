import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const serverSource = fs.readFileSync(path.join(currentDir, "../src/server.js"), "utf8");

test("server retries malformed agent replies once and never forwards the raw response", () => {
  assert.match(serverSource, /async function invokeStrictAgentReply/);
  assert.match(serverSource, /buildDclawReplyFormatRetryRequest\(request\)/);
  assert.match(serverSource, /getDclawFormatRetryTimeoutMs\(\)/);
  assert.match(serverSource, /agent\.reply\.format_retry/);
  assert.match(serverSource, /agent\.reply\.degraded/);
  assert.match(serverSource, /agent\.reply\.invalid_format/);
  assert.match(serverSource, /activation\.agent\.format_retry/);
  assert.match(serverSource, /activation\.agent\.degraded/);
  assert.match(serverSource, /activation\.agent\.invalid_format/);
});
