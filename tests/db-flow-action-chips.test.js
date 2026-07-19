import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-action-chip-db-"));
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

test("activation text chips are stored as actions and removed from message content", () => {
  ensureAgent("agent_action_chip");
  const machine = db.upsertFlowMachine({
    agentId: "agent_action_chip",
    name: "动作测试",
    enabled: true,
    config: {
      name: "动作测试",
      entryNodeId: "node_1",
      nodes: [
        {
          id: "node_1",
          name: "发资料",
          activation: {
            enabled: true,
            polishByAgent: false,
            messages: [
              {
                content: "我先拉你进直播课学习群。[动作：拉入 直播课学习群]",
                intervalMinutes: 5,
                maxTimes: 1
              }
            ]
          }
        }
      ]
    }
  });

  const message = machine.config.nodes[0].activation.messages[0];
  assert.equal(message.content, "我先拉你进直播课学习群。");
  assert.deepEqual(message.actionsAfterSend, [
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

test("action-only activation messages are preserved", () => {
  const normalized = db.normalizeActivationConfig({
    enabled: true,
    polishByAgent: false,
    messages: [{ content: "[动作：拉入 直播课学习群]", intervalMinutes: 1, maxTimes: 1 }]
  });

  assert.equal(normalized.messages[0].content, "");
  assert.equal(normalized.messages[0].intervalMinutes, 1);
  assert.equal(normalized.messages[0].maxTimes, 1);
  assert.deepEqual(normalized.messages[0].actionsAfterSend, [
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
