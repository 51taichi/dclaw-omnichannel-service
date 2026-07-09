import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-reset-test-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");

test("clearConversationForReset resets one flow conversation for a fresh agent run", () => {
  const botId = "bot_test";
  const conversationKey = `${botId}:private:张三`;
  const machine = db.upsertFlowMachine({
    botId,
    enabled: true,
    config: {
      name: "测试状态机",
      version: "1.0.0",
      entryNodeId: "node_1",
      nodes: [
        {
          id: "node_1",
          name: "发资料",
          goal: "发送资料",
          completionCriteria: "资料已发送",
          collectFields: [],
          conversationTips: [],
          nextNodeId: "node_2"
        },
        {
          id: "node_2",
          name: "邀约",
          goal: "邀约",
          completionCriteria: "客户同意",
          collectFields: ["phone"],
          conversationTips: [],
          nextNodeId: ""
        }
      ]
    }
  });

  db.upsertConversation({
    botId,
    agentId: "agent_test",
    conversationKey,
    message: {
      roomType: 2,
      receivedName: "张三",
      groupName: "张三"
    }
  });
  db.updateConversationSession(conversationKey, "dclaw-session-old");
  db.getOrCreateFlowSession({ botId, conversationKey, machine });
  db.mergeFlowSessionData({ conversationKey, patch: { phone: "13800000000" } });
  db.updateFlowSessionNode({
    botId,
    conversationKey,
    nextNodeId: "node_2",
    reason: "测试推进"
  });
  db.insertConversationMessage({
    botId,
    conversationKey,
    direction: "inbound",
    senderName: "张三",
    content: "我要资料",
    rawPayload: { spoken: "我要资料" }
  });

  const result = db.clearConversationForReset({
    botId,
    conversationKey,
    reason: "测试清空"
  });

  assert.equal(result.conversationKey, conversationKey);
  assert.equal(result.currentNodeId, "node_1");
  assert.deepEqual(result.collectedData, {});
  assert.equal(db.listConversationMessages({ conversationKey }).length, 0);
  assert.equal(db.listFlowStateEvents({ conversationKey }).length, 0);
  assert.equal(db.getConversation(conversationKey).dclawSessionId, null);
  assert.equal(db.getConversationResetPending(conversationKey), true);

  db.markConversationResetHandled(conversationKey);

  assert.equal(db.getConversationResetPending(conversationKey), false);
});
