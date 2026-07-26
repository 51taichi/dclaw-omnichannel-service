import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const serverSource = fs.readFileSync(path.join(currentDir, "../src/server.js"), "utf8");

test("server retries malformed agent replies once and never forwards the raw response", () => {
  assert.match(serverSource, /async function invokeStrictAgentReply/);
  assert.match(serverSource, /validateAndRetryAgentResponse\(\{/);
  assert.match(serverSource, /validateAgentResponseText/);
  assert.match(serverSource, /recordAgentResponseValidationFailures/);
  assert.match(serverSource, /getDclawFormatRetryTimeoutMs\(\)/);
  assert.match(serverSource, /agent\.reply\.format_retry/);
  assert.match(serverSource, /agent\.reply\.validation_failed/);
  assert.match(serverSource, /agent\.reply\.invalid_format/);
  assert.match(serverSource, /activation\.agent\.format_retry/);
  assert.match(serverSource, /activation\.agent\.validation_failed/);
  assert.match(serverSource, /activation\.agent\.invalid_format/);
});

test("server retries agent replies when media attachments do not have trusted sources", () => {
  assert.match(serverSource, /buildDclawAttachmentSourceRetryRequest\(request,\s*sendabilityIssue\)/);
  assert.match(serverSource, /getAgentReplySendabilityIssue\(agentReply\)/);
  assert.match(serverSource, /agent\.reply\.attachment_source_retry/);
  assert.match(serverSource, /agent\.reply\.invalid_attachment_source/);
});

test("agent failures are persisted and use the customer fallback reply", () => {
  assert.match(serverSource, /function recordAgentFailure/);
  assert.match(serverSource, /recordAgentFailure\(\{/);
  assert.match(serverSource, /stage:\s*"fallback"/);
  assert.match(serverSource, /error\.response \|\| null/);
  assert.match(serverSource, /throw failure/);
});

test("fallback reply is loaded from the selected Bot reply-wait setting", () => {
  assert.match(serverSource, /DEFAULT_AGENT_FAILURE_FALLBACK_REPLY/);
  assert.match(serverSource, /fallbackReply/);
  assert.match(serverSource, /function getAgentFailureFallbackReply\(botId\)/);
  assert.match(serverSource, /getAgentFailureFallbackReply\(botId\)/);
});

test("server persists and logs deterministic validation retry outcomes", () => {
  assert.match(serverSource, /updateAgentResponseValidationRetryOutcome/);
  assert.match(serverSource, /onValidationRetryOutcome/);
  assert.match(serverSource, /validation_retry_/);
});

test("invalid Agent reply placeholders cannot carry tag evaluations", () => {
  assert.match(
    serverSource,
    /function invalidValidationAgentReply[\s\S]*tagEvaluation:\s*\[\]/
  );
});
