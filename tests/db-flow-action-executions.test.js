import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-flow-actions-test-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");

function ensureAgent(agentId) {
  db.upsertAgent({
    agentId,
    agentName: `${agentId} 测试 Agent`,
    dclawBaseUrl: "https://dclaw.example.com",
    dclawPublicId: agentId,
    enabled: true
  });
}

test("normalizeFlowActions keeps valid invite actions only", () => {
  assert.deepEqual(db.normalizeFlowActions([
    {
      id: "action_1",
      type: "invite_to_group",
      groupName: "直播课学习群",
      target: "current_contact",
      showMessageHistory: true
    },
    { id: "bad", type: "unknown", groupName: "忽略" },
    { id: "empty", type: "invite_to_group", groupName: "   " }
  ]), [
    {
      id: "action_1",
      type: "invite_to_group",
      groupName: "直播课学习群",
      target: "current_contact",
      showMessageHistory: true,
      runOnce: true
    }
  ]);
});

test("flow machine normalization preserves node and activation actions", () => {
  ensureAgent("agent_flow_action_config");
  const machine = db.upsertFlowMachine({
    agentId: "agent_flow_action_config",
    enabled: true,
    config: {
      name: "动作测试状态机",
      entryNodeId: "node_1",
      nodes: [
        {
          id: "node_1",
          name: "邀约",
          goal: "",
          completionCriteria: "",
          collectFields: [],
          conversationTips: [],
          nextNodeId: "",
          actionsOnComplete: [
            { id: "action_1", type: "invite_to_group", groupName: "直播课学习群" }
          ],
          activation: {
            enabled: true,
            polishByAgent: false,
            messages: [
              {
                content: "道友在吗？",
                intervalMinutes: 5,
                maxTimes: 1,
                actionsAfterSend: [
                  { id: "action_2", type: "invite_to_group", groupName: "直播课学习群" }
                ]
              }
            ]
          }
        }
      ]
    }
  });

  assert.deepEqual(machine.config.nodes[0].actionsOnComplete, [
    {
      id: "action_1",
      type: "invite_to_group",
      groupName: "直播课学习群",
      target: "current_contact",
      showMessageHistory: true,
      runOnce: true
    }
  ]);
  assert.deepEqual(machine.config.nodes[0].activation.messages[0].actionsAfterSend, [
    {
      id: "action_2",
      type: "invite_to_group",
      groupName: "直播课学习群",
      target: "current_contact",
      showMessageHistory: true,
      runOnce: true
    }
  ]);
});

test("flow action execution reservation is idempotent by action scope", () => {
  const action = {
    id: "action_1",
    type: "invite_to_group",
    groupName: "直播课学习群",
    target: "current_contact",
    showMessageHistory: true,
    runOnce: true
  };

  const first = db.reserveFlowActionExecution({
    botId: "bot_action",
    agentId: "agent_action",
    conversationKey: "bot_action:private:张三",
    source: "node_complete",
    nodeId: "node_1",
    activationTaskId: "",
    action
  });
  const second = db.reserveFlowActionExecution({
    botId: "bot_action",
    agentId: "agent_action",
    conversationKey: "bot_action:private:张三",
    source: "node_complete",
    nodeId: "node_1",
    activationTaskId: "",
    action
  });

  assert.equal(first.reserved, true);
  assert.equal(second.reserved, false);
  assert.equal(second.execution.id, first.execution.id);

  const succeeded = db.markFlowActionExecutionSucceeded({
    id: first.execution.id,
    worktoolMessageId: "wt_1",
    worktoolResponse: { code: 200, data: "wt_1" }
  });
  assert.equal(succeeded.status, "success");
  assert.equal(succeeded.worktoolMessageId, "wt_1");
  assert.deepEqual(succeeded.worktoolResponse, { code: 200, data: "wt_1" });
});

test("activation action reservations are scoped by activation task id", () => {
  const action = {
    id: "action_1",
    type: "invite_to_group",
    groupName: "直播课学习群",
    target: "current_contact",
    showMessageHistory: true,
    runOnce: true
  };

  const first = db.reserveFlowActionExecution({
    botId: "bot_action_activation",
    agentId: "agent_action_activation",
    conversationKey: "bot_action_activation:private:李四",
    source: "activation_sent",
    nodeId: "node_1",
    activationTaskId: "101",
    action
  });
  const second = db.reserveFlowActionExecution({
    botId: "bot_action_activation",
    agentId: "agent_action_activation",
    conversationKey: "bot_action_activation:private:李四",
    source: "activation_sent",
    nodeId: "node_1",
    activationTaskId: "102",
    action
  });

  assert.equal(first.reserved, true);
  assert.equal(second.reserved, true);
  assert.notEqual(second.execution.id, first.execution.id);
});
