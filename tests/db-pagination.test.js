import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnichannel-pagination-test-"));
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

function createFlowSession({ botId, agentId, name, roomType = 2, groupName = name }) {
  const conversationKey = roomType === 1
    ? `${botId}:group:${groupName}`
    : `${botId}:private:${name}`;
  db.upsertConversation({
    botId,
    agentId,
    conversationKey,
    message: { roomType, receivedName: name, groupName }
  });
  db.getOrCreateConversationSession({ botId, conversationKey });
  return conversationKey;
}

test("listFlowSessionsPage returns total count and requested page only", () => {
  const botId = "pagination_flow_bot";
  const agentId = ensureBot(botId);
  for (let index = 1; index <= 5; index += 1) {
    createFlowSession({ botId, agentId, name: `客户${index}` });
  }

  const page = db.listFlowSessionsPage({ botId, page: 2, pageSize: 2 });

  assert.equal(page.pagination.total, 5);
  assert.equal(page.pagination.page, 2);
  assert.equal(page.pagination.pageSize, 2);
  assert.equal(page.pagination.totalPages, 3);
  assert.equal(page.items.length, 2);
});

test("listFlowSessionsPage applies type and query filters before pagination", () => {
  const botId = "pagination_flow_filter_bot";
  const agentId = ensureBot(botId);
  createFlowSession({ botId, agentId, name: "李红" });
  createFlowSession({ botId, agentId, name: "张三" });
  createFlowSession({ botId, agentId, name: "魔兮", roomType: 1, groupName: "A招商服务群" });

  const privateMatches = db.listFlowSessionsPage({
    botId,
    type: "private",
    query: "李",
    page: 1,
    pageSize: 20
  });
  const groupMatches = db.listFlowSessionsPage({
    botId,
    type: "group",
    query: "招商",
    page: 1,
    pageSize: 20
  });

  assert.equal(privateMatches.pagination.total, 1);
  assert.equal(privateMatches.items[0].receivedName, "李红");
  assert.equal(groupMatches.pagination.total, 1);
  assert.equal(groupMatches.items[0].groupName, "A招商服务群");
});

test("human handoff sessions stay globally pinned after clearing search", () => {
  const botId = "pagination_handoff_pin_bot";
  const agentId = ensureBot(botId);
  const targetKey = createFlowSession({ botId, agentId, name: "较早客户" });
  createFlowSession({ botId, agentId, name: "较新客户一" });
  const newestKey = createFlowSession({ botId, agentId, name: "较新客户二" });

  const before = db.getFlowSessionForBot({ botId, conversationKey: targetKey });
  const unfilteredBefore = db.listFlowSessionsPage({ botId, page: 1, pageSize: 2 });
  assert.equal(
    unfilteredBefore.items.some((item) => item.conversationKey === targetKey),
    false
  );

  const searchResult = db.listFlowSessionsPage({
    botId,
    query: "较早客户",
    page: 1,
    pageSize: 2
  });
  assert.equal(searchResult.items[0].conversationKey, targetKey);

  db.updateFlowSessionHandoff({
    botId,
    conversationKey: targetKey,
    handoffStatus: "human",
    handoffBy: "console",
    reason: "测试人工接手"
  });

  const afterClearingSearch = db.listFlowSessionsPage({ botId, page: 1, pageSize: 2 });
  assert.equal(afterClearingSearch.items[0].conversationKey, targetKey);
  assert.equal(afterClearingSearch.items[1].conversationKey, newestKey);
  assert.equal(
    db.getFlowSessionForBot({ botId, conversationKey: targetKey }).lastMessageAt,
    before.lastMessageAt
  );
});

test("listProactiveTasksPage returns total count and requested page only", () => {
  const botId = "pagination_proactive_bot";
  const agentId = ensureBot(botId);
  for (let index = 1; index <= 5; index += 1) {
    db.createProactiveTask({
      botId,
      agentId,
      title: "",
      content: `推送${index}`,
      targets: [{ targetType: "private", targetName: `客户${index}` }],
      createdBy: "test"
    });
  }

  const page = db.listProactiveTasksPage({ botId, page: 2, pageSize: 2 });

  assert.equal(page.pagination.total, 5);
  assert.equal(page.pagination.page, 2);
  assert.equal(page.pagination.pageSize, 2);
  assert.equal(page.pagination.totalPages, 3);
  assert.equal(page.items.length, 2);
});

test("listProactiveAddressBookTargetsPage returns filtered total count and requested page", () => {
  const botId = "pagination_targets_bot";
  ensureBot(botId);
  for (let index = 1; index <= 5; index += 1) {
    db.upsertProactiveAddressBookTarget({
      botId,
      targetType: index % 2 === 0 ? "group" : "private",
      targetName: `目标${index}`
    });
  }

  const page = db.listProactiveAddressBookTargetsPage({ botId, page: 2, pageSize: 2 });
  const privateMatches = db.listProactiveAddressBookTargetsPage({
    botId,
    targetType: "private",
    query: "目标",
    page: 1,
    pageSize: 20
  });

  assert.equal(page.pagination.total, 5);
  assert.equal(page.pagination.page, 2);
  assert.equal(page.pagination.pageSize, 2);
  assert.equal(page.pagination.totalPages, 3);
  assert.equal(page.items.length, 2);
  assert.equal(privateMatches.pagination.total, 3);
  assert.equal(privateMatches.items.every((target) => target.targetType === "private"), true);
});
