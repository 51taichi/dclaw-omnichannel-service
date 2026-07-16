import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-friend-reentry-test-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");
let setupSequence = 0;

function setup() {
  setupSequence += 1;
  const botId = `friend_reentry_bot_${setupSequence}`;
  const agentId = `friend_reentry_agent_${setupSequence}`;
  const conversationKey = `${botId}:private:道友`;
  db.upsertAgent({
    agentId,
    agentName: "测试客服",
    dclawBaseUrl: "https://dclaw.example.com",
    dclawPublicId: agentId,
    enabled: true
  });
  db.upsertBotBinding({ botId, botName: "测试 Bot", agentId, enabled: true });
  const machine = db.upsertFlowMachine({
    agentId,
    enabled: true,
    config: {
      name: "测试状态机",
      version: "1.0.0",
      entryNodeId: "node_1",
      nodes: [
        { id: "node_1", name: "入口", goal: "", completionCriteria: "", collectFields: ["城市"], conversationTips: [], nextNodeId: "node_2" },
        { id: "node_2", name: "后续", goal: "", completionCriteria: "", collectFields: [], conversationTips: [], nextNodeId: "" }
      ]
    }
  });
  return { botId, agentId, conversationKey, machine };
}

test("friend-added callbacks use a time-bucketed key even when WorkTool provides a message id", () => {
  const params = {
    botId: "friend_key_bot",
    conversationKey: "friend_key_bot:private:道友",
    message: { textType: 22, type: 105, messageId: "friend-event", friendName: "道友" }
  };

  const first = db.buildMessageKey({ ...params, nowMs: 0 });
  const later = db.buildMessageKey({ ...params, nowMs: 20_000 });
  assert.notEqual(first, later);
});

test("different friend-added callbacks do not share a synthetic key in the same time bucket", () => {
  const base = {
    botId: "friend_key_bot",
    conversationKey: "friend_key_bot:private:unknown"
  };
  const first = db.buildMessageKey({
    ...base,
    message: { textType: 22, type: 105, friendName: "甲客户", friendRemark: "" },
    nowMs: 0
  });
  const second = db.buildMessageKey({
    ...base,
    message: { textType: 22, type: 105, friendName: "乙客户", friendRemark: "" },
    nowMs: 0
  });

  assert.notEqual(first, second);
});

test("friend-added entry persists its first activation task with the re-entry state", () => {
  const { botId, agentId, conversationKey, machine } = setup();
  const entry = db.beginFriendAddedFlowEntry({
    botId,
    conversationKey,
    machine,
    occurredAt: "2026-07-16T11:00:00.000Z",
    activationTask: {
      agentId,
      activation: { enabled: true, polishByAgent: false, messages: [{ content: "道友在吗", intervalMinutes: 2, maxTimes: 1 }] },
      anchorAt: "2026-07-16T11:00:00.000Z",
      dueAt: "2026-07-16T11:02:00.000Z"
    }
  });

  assert.equal(entry.status, "created");
  assert.equal(entry.task.status, "pending");
  assert.equal(entry.task.generation, entry.session.activationGeneration);
  assert.equal(entry.task.messageContent, "道友在吗");
});

test("friend-added re-entry never advances an old delivery into the new generation", () => {
  const { botId, agentId, conversationKey, machine } = setup();
  const first = db.beginFriendAddedFlowEntry({
    botId,
    conversationKey,
    machine,
    occurredAt: "2026-07-16T12:00:00.000Z",
    activationTask: {
      agentId,
      activation: { enabled: true, polishByAgent: false, messages: [{ content: "旧提醒", intervalMinutes: 1, maxTimes: 1 }] },
      anchorAt: "2026-07-16T12:00:00.000Z",
      dueAt: "2026-07-16T12:01:00.000Z"
    }
  });
  const claimed = db.claimDueFlowActivationTasks({
    nowIso: "2026-07-16T12:01:01.000Z",
    staleBeforeIso: "2026-07-16T11:00:00.000Z"
  }).filter((task) => task.conversationKey === conversationKey);
  assert.equal(claimed.length, 1);
  db.cancelFlowActivationTasks({ conversationKey, reason: "customer_replied" });
  const reentry = db.beginFriendAddedFlowEntry({
    botId,
    conversationKey,
    machine,
    cooldownMs: 1,
    occurredAt: "2026-07-16T12:01:00.000Z",
    activationTask: {
      agentId,
      activation: { enabled: true, polishByAgent: false, messages: [{ content: "新提醒", intervalMinutes: 1, maxTimes: 1 }] },
      anchorAt: "2026-07-16T12:01:00.000Z",
      dueAt: "2026-07-16T12:02:00.000Z"
    }
  });

  const finalized = db.finalizeFlowActivationTaskDelivery({
    id: claimed[0].id,
    worktoolMessageIds: ["late_old_delivery"]
  });
  assert.equal(finalized.task.wasCanceled, true);
  assert.equal(finalized.progress, null);
  assert.equal(db.getFlowSession(conversationKey).activationGeneration, reentry.session.activationGeneration);
  assert.deepEqual(
    db.getFlowActivationProgress({ conversationKey, nodeId: "node_1" }),
    { nodeId: "node_1", messageIndex: 0, sentCount: 0 }
  );
  assert.equal(reentry.task.status, "pending");
  assert.equal(db.listFlowActivationTasks({ conversationKey }).at(-1).messageContent, "新提醒");
});

test("friend-added entry creates, deduplicates, then re-enters without clearing assets", () => {
  const { botId, agentId, conversationKey, machine } = setup();
  const firstAt = "2026-07-16T10:00:00.000Z";
  const first = db.beginFriendAddedFlowEntry({
    botId,
    conversationKey,
    machine,
    cooldownMs: 10 * 60 * 1000,
    occurredAt: firstAt
  });

  assert.equal(first.status, "created");
  assert.equal(first.session.currentNodeId, "node_1");
  assert.equal(first.session.handoffStatus, "ai");
  assert.equal(first.session.activationGeneration, 1);

  db.mergeFlowSessionData({ conversationKey, patch: { 城市: "长沙" } });
  db.updateFlowSessionNode({
    botId,
    conversationKey,
    nextNodeId: "node_2",
    reason: "test_transition"
  });
  const task = db.scheduleFlowActivationTask({
    botId,
    agentId,
    conversationKey,
    nodeId: "node_2",
    generation: first.session.activationGeneration,
    activation: { enabled: true, polishByAgent: false, messages: [{ content: "旧提醒", intervalMinutes: 1, maxTimes: 1 }] },
    dueAt: "2026-07-16T10:05:00.000Z"
  });
  assert.equal(task.status, "pending");

  const duplicate = db.beginFriendAddedFlowEntry({
    botId,
    conversationKey,
    machine,
    cooldownMs: 10 * 60 * 1000,
    occurredAt: "2026-07-16T10:05:00.000Z"
  });
  assert.equal(duplicate.status, "cooldown");
  assert.equal(duplicate.session.currentNodeId, "node_2");
  assert.equal(db.listFlowActivationTasks({ conversationKey }).at(-1).status, "pending");

  const reentry = db.beginFriendAddedFlowEntry({
    botId,
    conversationKey,
    machine,
    cooldownMs: 10 * 60 * 1000,
    occurredAt: "2026-07-16T10:11:00.000Z"
  });
  assert.equal(reentry.status, "reentered");
  assert.equal(reentry.session.currentNodeId, "node_1");
  assert.equal(reentry.session.handoffStatus, "ai");
  assert.deepEqual(reentry.session.collectedData, { 城市: "长沙" });
  assert.equal(reentry.session.activationState, null);
  assert.equal(reentry.session.activationGeneration, 2);
  assert.equal(db.listFlowActivationTasks({ conversationKey }).at(-1).status, "canceled");
});
