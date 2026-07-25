import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-proactive-scheduling-test-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");

function ensureBot(botId) {
  const agentId = `${botId}_agent`;
  db.upsertAgent({
    agentId,
    agentName: `${botId} Agent`,
    dclawBaseUrl: "https://dclaw.example.com",
    dclawPublicId: agentId,
    enabled: true
  });
  db.upsertBotBinding({ botId, botName: botId, agentId, enabled: true });
  return agentId;
}

function createPrivateTarget(botId, targetName) {
  db.upsertProactiveAddressBookTarget({
    botId,
    targetType: "private",
    targetName,
    displayName: targetName,
    source: "test"
  });
}

function applyNormalTag(botId, agentId, targetName, tagId, tagName = tagId) {
  db.applyConversationTagChanges({
    botId,
    agentId,
    conversationKey: `${botId}:private:${targetName}`,
    nextTags: [{
      groupId: "intent",
      groupName: "意向",
      tagId,
      tagName
    }],
    source: "test"
  });
}

function createTaskWithTargets(botId, targetNames) {
  const agentId = ensureBot(botId);
  return db.createProactiveTask({
    botId,
    agentId,
    title: "测试任务",
    content: "测试内容",
    targets: targetNames.map((targetName) => ({ targetType: "private", targetName })),
    createdBy: "test"
  });
}

test("proactive target tags are isolated by Bot and include normal and date tags", () => {
  const botId = "tag_target_bot";
  const agentId = ensureBot(botId);
  const otherBotId = "tag_target_other_bot";
  const otherAgentId = ensureBot(otherBotId);
  createPrivateTarget(botId, "客户A");
  createPrivateTarget(botId, "客户B");
  createPrivateTarget(otherBotId, "客户A");

  applyNormalTag(botId, agentId, "客户A", "a", "A类");
  db.upsertSystemDateTag({
    botId,
    agentId,
    conversationKey: `${botId}:private:客户B`,
    dateTagId: "20260723"
  });
  applyNormalTag(otherBotId, otherAgentId, "客户A", "other", "其他");

  const tags = db.listProactiveTargetTags({ botId });

  assert.deepEqual(
    tags.map((tag) => [tag.tagType, tag.tagId]),
    [["date", "20260723"], ["normal", "a"]]
  );
  assert.equal(tags.every((tag) => tag.botId === botId), true);
});

test("proactive targets can be selected by multiple tags without duplicates", () => {
  const botId = "tag_filter_bot";
  const agentId = ensureBot(botId);
  createPrivateTarget(botId, "客户A");
  createPrivateTarget(botId, "客户B");
  createPrivateTarget(botId, "客户C");
  applyNormalTag(botId, agentId, "客户A", "a", "A类");
  applyNormalTag(botId, agentId, "客户B", "b", "B类");

  const page = db.listProactiveAddressBookTargetsPage({
    botId,
    tagFilters: [
      { tagType: "normal", groupId: "intent", tagId: "a" },
      { tagType: "normal", groupId: "intent", tagId: "b" }
    ],
    page: 1,
    pageSize: 20
  });

  assert.deepEqual(
    page.items.map((target) => target.targetName).sort(),
    ["客户A", "客户B"]
  );
  assert.equal(page.pagination.total, 2);
});

test("scheduled proactive target is not claimable before due time", () => {
  const botId = "schedule_bot";
  const agentId = ensureBot(botId);
  const task = db.createProactiveTask({
    botId,
    agentId,
    title: "定时",
    content: "内容",
    targets: [{ targetType: "private", targetName: "客户A" }],
    scheduledAt: "2026-07-23T04:01:00.000Z",
    createdBy: "test"
  });

  assert.equal(db.claimNextProactiveTarget({ nowIso: "2026-07-23T04:00:00.000Z" }), null);
  const claimed = db.claimNextProactiveTarget({ nowIso: "2026-07-23T04:01:00.000Z" });
  assert.equal(claimed.taskId, task.id);
});

test("canceling proactive task cancels only unclaimed targets", () => {
  const botId = "cancel_bot";
  const task = createTaskWithTargets(botId, ["客户A", "客户B"]);
  const first = db.claimNextProactiveTarget({ nowIso: new Date().toISOString() });
  db.markProactiveTargetSent({ id: first.id, messageId: "sent-1", worktoolResponse: {} });

  const canceled = db.cancelProactiveTask({ id: task.id, reason: "console" });
  const targets = db.listProactiveTaskTargets(task.id);

  assert.equal(canceled.status, "canceled");
  assert.equal(targets[0].status, "sent");
  assert.equal(targets[1].status, "canceled");
  assert.equal(db.claimNextProactiveTarget({ nowIso: new Date().toISOString() }), null);
});
