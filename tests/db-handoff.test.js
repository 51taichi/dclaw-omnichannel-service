import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-handoff-test-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");

function createMachine(botId) {
  const agentId = `${botId}_agent`;
  db.upsertAgent({
    agentId,
    agentName: `${botId} 测试 Agent`,
    dclawBaseUrl: "https://dclaw.example.com",
    dclawPublicId: agentId,
    enabled: true
  });
  db.upsertBotBinding({ botId, botName: botId, agentId, enabled: true });
  return db.upsertFlowMachine({
    agentId,
    enabled: true,
    config: {
      name: "人工接手测试",
      version: "1.0.0",
      entryNodeId: "node_1",
      nodes: [
        {
          id: "node_1",
          name: "基础沟通",
          goal: "沟通",
          completionCriteria: "完成",
          collectFields: [],
          conversationTips: [],
          nextNodeId: ""
        }
      ]
    }
  });
}

test("flow sessions default to AI handoff status", () => {
  const botId = "bot_handoff_default";
  const conversationKey = `${botId}:private:张三`;
  const machine = createMachine(botId);

  const session = db.getOrCreateFlowSession({ botId, conversationKey, machine });

  assert.equal(session.handoffStatus, "ai");
  assert.equal(session.handoffAt, "");
  assert.equal(session.handoffBy, "");
  assert.equal(session.handoffReason, "");
});

test("updateFlowSessionHandoff toggles a private conversation to human and back to ai", () => {
  const botId = "bot_handoff_toggle";
  const conversationKey = `${botId}:private:李四`;
  const machine = createMachine(botId);
  db.getOrCreateFlowSession({ botId, conversationKey, machine });

  const human = db.updateFlowSessionHandoff({
    botId,
    conversationKey,
    handoffStatus: "human",
    handoffBy: "console",
    reason: "客户意向明确"
  });

  assert.equal(human.handoffStatus, "human");
  assert.equal(human.handoffBy, "console");
  assert.equal(human.handoffReason, "客户意向明确");
  assert.equal(Boolean(human.handoffAt), true);

  const ai = db.updateFlowSessionHandoff({
    botId,
    conversationKey,
    handoffStatus: "ai",
    handoffBy: "console",
    reason: "恢复 AI"
  });

  assert.equal(ai.handoffStatus, "ai");
  assert.equal(ai.handoffReason, "恢复 AI");
});
