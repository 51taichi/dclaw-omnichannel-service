import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-activation-test-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");

test("normalizeActivationConfig defaults and filters messages", () => {
  assert.deepEqual(db.normalizeActivationConfig({}), {
    enabled: false,
    intervalMinutes: 30,
    maxTimes: 1,
    polishByAgent: true,
    messages: []
  });

  assert.deepEqual(db.normalizeActivationConfig({
    enabled: true,
    intervalMinutes: "15",
    maxTimes: "2",
    polishByAgent: false,
    messages: ["  第一条  ", "", "第二条"]
  }), {
    enabled: true,
    intervalMinutes: 15,
    maxTimes: 2,
    polishByAgent: false,
    messages: ["第一条", "第二条"]
  });
});

test("activation tasks can be scheduled, claimed, sent, failed, and canceled", () => {
  const botId = "bot_activation";
  const conversationKey = `${botId}:private:张三`;
  const machine = db.upsertFlowMachine({
    botId,
    enabled: true,
    config: {
      name: "激活状态机",
      version: "1.0.0",
      entryNodeId: "node_1",
      nodes: [{ id: "node_1", name: "邀约", goal: "", completionCriteria: "", collectFields: [], conversationTips: [], nextNodeId: "" }]
    }
  });
  const session = db.getOrCreateFlowSession({ botId, conversationKey, machine });
  assert.equal(session.activationGeneration, 0);

  const task = db.scheduleFlowActivationTask({
    botId,
    agentId: "agent_activation",
    conversationKey,
    nodeId: "node_1",
    generation: session.activationGeneration,
    anchorAt: "2026-07-11T09:59:00.000Z",
    activation: {
      enabled: true,
      intervalMinutes: 30,
      maxTimes: 2,
      polishByAgent: false,
      messages: ["提醒一", "提醒二"]
    },
    dueAt: "2026-07-11T10:00:00.000Z"
  });
  assert.equal(task.status, "pending");
  assert.equal(task.attemptNumber, 1);
  assert.equal(task.anchorAt, "2026-07-11T09:59:00.000Z");

  const claimed = db.claimDueFlowActivationTasks({
    limit: 20,
    nowIso: "2026-07-11T10:00:01.000Z",
    staleBeforeIso: "2026-07-11T09:50:00.000Z"
  });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].status, "processing");
  assert.deepEqual(claimed[0].messages, ["提醒一", "提醒二"]);

  const sent = db.markFlowActivationTaskSent({
    id: claimed[0].id,
    worktoolMessageIds: ["wt_1", "wt_2"]
  });
  assert.equal(sent.status, "sent");
  assert.deepEqual(sent.worktoolMessageIds, ["wt_1", "wt_2"]);

  db.scheduleFlowActivationTask({
    botId,
    agentId: "agent_activation",
    conversationKey,
    nodeId: "node_1",
    generation: session.activationGeneration,
    activation: { enabled: true, intervalMinutes: 30, maxTimes: 2, polishByAgent: true, messages: ["继续提醒"] },
    dueAt: "2026-07-11T10:30:00.000Z",
    attemptNumber: 2
  });
  const canceled = db.cancelFlowActivationTasks({ conversationKey, reason: "customer_replied" });
  assert.equal(canceled >= 1, true);
  assert.equal(db.listFlowActivationTasks({ conversationKey }).at(-1).status, "canceled");
});

test("incrementFlowActivationGeneration invalidates old generations", () => {
  const botId = "bot_generation";
  const conversationKey = `${botId}:private:李四`;
  const machine = db.upsertFlowMachine({
    botId,
    enabled: true,
    config: {
      name: "代际状态机",
      version: "1.0.0",
      entryNodeId: "node_1",
      nodes: [{ id: "node_1", name: "节点", goal: "", completionCriteria: "", collectFields: [], conversationTips: [], nextNodeId: "" }]
    }
  });
  db.getOrCreateFlowSession({ botId, conversationKey, machine });
  const next = db.incrementFlowActivationGeneration({ conversationKey, reason: "customer_replied" });
  assert.equal(next.activationGeneration, 1);
});
