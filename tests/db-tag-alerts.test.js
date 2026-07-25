import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-tag-alerts-test-"));
process.env.DATA_DIR = dataDir;

const {
  applyAgentTagOutcome,
  insertConversationMessage,
  listConversationMessagesAround,
  listConversationTags,
  listTagActivationTasks,
  listUnreadTagAlerts,
  markTagAlertRead,
  resolveConversationMessageEvidence
} = await import("../src/db.js");

function tagChange(overrides = {}) {
  return {
    action: "add",
    groupId: "intent",
    groupName: "意向",
    tagId: "b",
    tagName: "B类",
    reason: "客户询问老师水平",
    oldTagIds: [],
    newTagIds: ["b"],
    ...overrides
  };
}

test("automatic tag outcome stores tags activation work and one durable alert", () => {
  const botId = "alert_bot";
  const agentId = "alert_agent";
  const conversationKey = `${botId}:private:张三`;
  const message = insertConversationMessage({
    botId,
    conversationKey,
    direction: "inbound",
    senderName: "张三",
    content: "你们老师的水平怎么样",
    rawPayload: { messageId: "worktool-msg-1" }
  });
  const accepted = [tagChange()];

  const result = applyAgentTagOutcome({
    botId,
    agentId,
    conversationKey,
    accepted,
    rejected: [],
    nextTags: [{
      groupId: "intent",
      groupName: "意向",
      tagId: "b",
      tagName: "B类",
      reason: "客户询问老师水平"
    }],
    source: "agent_decision",
    activationCandidates: [{
      groupId: "intent",
      tagId: "b",
      activation: {
        enabled: true,
        polishByAgent: false,
        messages: [{ content: "需要我介绍老师吗", intervalMinutes: 1, maxTimes: 1 }]
      },
      dueAt: "2026-07-26T01:00:00.000Z"
    }],
    alertCandidates: [{
      groupId: "intent",
      tagId: "b",
      customerName: "张三",
      evidenceMessageId: message.id,
      evidenceText: message.content
    }]
  });

  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].tagName, "B类");
  assert.equal(result.alerts[0].evidenceMessageId, message.id);
  assert.equal(result.scheduledTagActivationTasks.length, 1);
  assert.equal(
    listConversationTags({ botId, agentId, conversationKey })[0].tagId,
    "b"
  );
  assert.equal(
    listTagActivationTasks({ botId, agentId, conversationKey }).length,
    1
  );
  assert.equal(listUnreadTagAlerts({ botId }).length, 1);
});

test("an outcome without an accepted state change creates no duplicate alert", () => {
  const botId = "alert_duplicate_bot";
  const agentId = "alert_duplicate_agent";
  const conversationKey = `${botId}:private:李四`;

  applyAgentTagOutcome({
    botId,
    agentId,
    conversationKey,
    accepted: [tagChange()],
    nextTags: [{
      groupId: "intent",
      groupName: "意向",
      tagId: "b",
      tagName: "B类",
      reason: "首次命中"
    }],
    alertCandidates: [{
      groupId: "intent",
      tagId: "b",
      customerName: "李四",
      evidenceText: "第一次咨询"
    }]
  });

  const repeated = applyAgentTagOutcome({
    botId,
    agentId,
    conversationKey,
    accepted: [],
    rejected: [],
    nextTags: [{
      groupId: "intent",
      groupName: "意向",
      tagId: "b",
      tagName: "B类",
      reason: "首次命中"
    }],
    alertCandidates: [{
      groupId: "intent",
      tagId: "b",
      customerName: "李四",
      evidenceText: "重复咨询"
    }]
  });

  assert.deepEqual(repeated.alerts, []);
  assert.equal(listUnreadTagAlerts({ botId }).length, 1);
});

test("alert reads are isolated by bot", () => {
  const first = applyAgentTagOutcome({
    botId: "read_bot_a",
    agentId: "read_agent",
    conversationKey: "read_bot_a:private:王五",
    accepted: [tagChange()],
    nextTags: [{
      groupId: "intent",
      groupName: "意向",
      tagId: "b",
      tagName: "B类"
    }],
    alertCandidates: [{
      groupId: "intent",
      tagId: "b",
      customerName: "王五"
    }]
  }).alerts[0];

  assert.equal(markTagAlertRead({ botId: "read_bot_b", alertId: first.id }), null);
  assert.equal(listUnreadTagAlerts({ botId: "read_bot_a" }).length, 1);

  const read = markTagAlertRead({ botId: "read_bot_a", alertId: first.id });
  assert.ok(read.readAt);
  assert.equal(listUnreadTagAlerts({ botId: "read_bot_a" }).length, 0);
});

test("evidence resolution and message windows stay inside one conversation", () => {
  const botId = "evidence_bot";
  const conversationKey = `${botId}:private:赵六`;
  const ids = [];
  for (let index = 0; index < 140; index += 1) {
    const message = insertConversationMessage({
      botId,
      conversationKey,
      direction: "inbound",
      senderName: "赵六",
      content: index === 10 ? "我想详细了解老师水平" : `普通消息 ${index}`,
      rawPayload: { messageId: `evidence-${index}` }
    });
    ids.push(message.id);
  }
  const other = insertConversationMessage({
    botId: "other_bot",
    conversationKey: "other_bot:private:赵六",
    direction: "inbound",
    senderName: "赵六",
    content: "我想详细了解老师水平",
    rawPayload: { messageId: "other-evidence" }
  });

  const resolved = resolveConversationMessageEvidence({
    botId,
    conversationKey,
    evidenceMessageId: String(ids[10]),
    evidenceText: "我想详细了解老师水平",
    candidateMessageIds: [ids[10], ids.at(-1), other.id]
  });
  assert.equal(resolved.id, ids[10]);

  const window = listConversationMessagesAround({
    botId,
    conversationKey,
    anchorMessageId: resolved.id,
    before: 3,
    after: 3
  });
  assert.equal(window.some((message) => message.id === resolved.id), true);
  assert.equal(window.some((message) => message.botId === "other_bot"), false);

  const fallback = resolveConversationMessageEvidence({
    botId,
    conversationKey,
    evidenceMessageId: "not-allowed",
    evidenceText: "not present",
    candidateMessageIds: [ids[10], ids.at(-1)]
  });
  assert.equal(fallback.id, ids.at(-1));
});
