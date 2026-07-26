import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-agent-tag-audit-test-"));

const {
  insertAgentTagEvaluations,
  listRecords
} = await import("../src/db.js");

const audit = {
  invocationId: 42,
  botId: "bot-a",
  agentId: "agent-a",
  conversationKey: "bot-a:private:客户",
  incomingMessageId: "msg-1",
  evaluations: [
    { groupId: "intent", tagId: "c", matched: false, reason: "未命中" },
    {
      groupId: "intent",
      tagId: "b",
      matched: true,
      reason: "客户提问",
      evidenceMessageId: "1013",
      evidenceText: "如果请假会扣钱吗"
    }
  ],
  decision: {
    add: [{ groupId: "intent", tagId: "b" }],
    remove: []
  }
};

test("persists one final evaluation per invocation and tag", () => {
  const rows = insertAgentTagEvaluations(audit);

  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.tagId === "b").decisionAction, "add");

  const listed = listRecords("agent-tag-evaluations", {
    botId: "bot-a",
    limit: 10
  });
  assert.equal(listed.length, 2);
  assert.equal(listed.find((row) => row.tagId === "b").matched, true);
  assert.equal(listed.find((row) => row.tagId === "b").evidenceText, "如果请假会扣钱吗");
});

test("reinserting an invocation and tag is idempotent", () => {
  insertAgentTagEvaluations({
    ...audit,
    evaluations: [{
      groupId: "intent",
      tagId: "b",
      matched: true,
      reason: "更新后的判断",
      evidenceMessageId: "1013",
      evidenceText: "如果请假会扣钱吗"
    }]
  });

  const listed = listRecords("agent-tag-evaluations", {
    botId: "bot-a",
    limit: 10
  });
  assert.equal(listed.filter((row) => row.tagId === "b").length, 1);
  assert.equal(listed.find((row) => row.tagId === "b").reason, "更新后的判断");
});
