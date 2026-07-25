import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-agent-validation-test-"));

const {
  insertAgentInvocationStart,
  insertAgentResponseValidationFailure,
  updateAgentResponseValidationRetryOutcome,
  listRecords
} = await import("../src/db.js");

test("agent response validation failures are persisted for later diagnosis", () => {
  const invocationId = insertAgentInvocationStart({
    botId: "bot-a",
    agentId: "agent-a",
    conversationKey: "bot-a:private:客户",
    incomingMessageId: "message-a",
    request: { message: "hello" }
  });

  insertAgentResponseValidationFailure({
    invocationId,
    botId: "bot-a",
    agentId: "agent-a",
    conversationKey: "bot-a:private:客户",
    incomingMessageId: "message-a",
    attemptNumber: 1,
    stage: "initial",
    errorType: "json_syntax",
    errorPath: "",
    errorMessage: "Expected ',' after property",
    line: 3,
    column: 4,
    rawResponseText: "{ bad json",
    retryRequested: true
  });

  const [row] = listRecords("agent-response-validation-failures", { botId: "bot-a", limit: 10 });
  assert.equal(row.invocationId, invocationId);
  assert.equal(row.errorType, "json_syntax");
  assert.equal(row.line, 3);
  assert.equal(row.column, 4);
  assert.equal(row.retryRequested, true);
  assert.equal(row.retryOutcome, "pending");
  assert.equal(row.rawResponseText, "{ bad json");
});

test("validation failure records whether its retry succeeded", () => {
  const invocationId = insertAgentInvocationStart({
    botId: "bot-a",
    agentId: "agent-a",
    conversationKey: "bot-a:private:客户-b",
    incomingMessageId: "message-b",
    request: { message: "hello" }
  });

  insertAgentResponseValidationFailure({
    invocationId,
    botId: "bot-a",
    agentId: "agent-a",
    conversationKey: "bot-a:private:客户-b",
    incomingMessageId: "message-b",
    attemptNumber: 1,
    stage: "initial",
    errorType: "json_syntax",
    errorMessage: "invalid JSON",
    rawResponseText: "不是 JSON"
  });

  updateAgentResponseValidationRetryOutcome({
    invocationId,
    outcome: "succeeded"
  });

  const [row] = listRecords("agent-response-validation-failures", { botId: "bot-a", limit: 10 });
  assert.equal(row.retryOutcome, "succeeded");
  assert.equal(row.retryErrorMessage, "");
  assert.ok(row.retryFinishedAt);
});

test("legacy history text is omitted from Agent invocation audit records", () => {
  insertAgentInvocationStart({
    botId: "bot-a",
    agentId: "agent-a",
    conversationKey: "bot-a:private:客户-c",
    incomingMessageId: "message-c",
    request: {
      external_session_id: "bot-a:private:客户-c",
      message: "客户历史发言（纯文本）：\n不应进入审计的历史正文",
      stream: true,
      metadata: {
        historyAnalysis: {
          selectedCount: 3,
          selectedChars: 20,
          configuredLimit: 4000
        }
      }
    }
  });

  const [row] = listRecords("agent-invocations", { botId: "bot-a", limit: 1 });
  assert.doesNotMatch(row.request.message, /不应进入审计的历史正文/);
  assert.match(row.request.message, /历史客户发言已从审计记录中省略/);
  assert.equal(row.request.metadata.historyAnalysis.selectedCount, 3);
});
