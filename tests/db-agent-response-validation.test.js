import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-agent-validation-test-"));

const {
  insertAgentInvocationStart,
  insertAgentResponseValidationFailure,
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
  assert.equal(row.rawResponseText, "{ bad json");
});
