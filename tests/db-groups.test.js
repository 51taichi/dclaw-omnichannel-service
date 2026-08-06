import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-managed-groups-test-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");

test("managed groups keep one canonical conversation across renames", () => {
  const created = db.createOrGetGroup({
    botId: "managed_bot_a",
    currentName: "A项目群",
    source: "callback",
    discoveredAt: "2026-07-29T01:00:00.000Z"
  });

  assert.equal(created.replyPolicy, "mention_only");
  assert.match(created.conversationKey, /^managed_bot_a:group-id:/);
  assert.deepEqual(created.tagGroupIds, ["__date__"]);
  assert.equal(
    db.getGroupByConversationKey({
      botId: "managed_bot_a",
      conversationKey: created.conversationKey
    }).id,
    created.id
  );

  const renamed = db.updateGroupExternalSnapshot({
    botId: "managed_bot_a",
    groupId: created.id,
    expectedVersion: created.version,
    currentName: "A项目交付群"
  });

  assert.equal(renamed.id, created.id);
  assert.equal(renamed.conversationKey, created.conversationKey);
  assert.equal(
    db.resolveGroupByAddress({
      botId: "managed_bot_a",
      groupName: "A项目群"
    }).group.id,
    created.id
  );
  assert.equal(
    db.resolveGroupByAddress({
      botId: "managed_bot_a",
      groupName: "A项目交付群"
    }).group.id,
    created.id
  );
});

test("managed group configuration is versioned and always keeps the date binding", () => {
  const group = db.createOrGetGroup({
    botId: "managed_bot_b",
    currentName: "售后服务群",
    source: "callback"
  });

  const saved = db.saveGroupConfig({
    botId: "managed_bot_b",
    groupId: group.id,
    expectedVersion: group.version,
    replyPolicy: "always",
    background: "客户购买了A产品",
    tagGroupIds: ["emotion"]
  });

  assert.equal(saved.replyPolicy, "always");
  assert.equal(saved.background, "客户购买了A产品");
  assert.deepEqual(saved.tagGroupIds, ["__date__", "emotion"]);
  assert.throws(
    () => db.saveGroupConfig({
      botId: "managed_bot_b",
      groupId: group.id,
      expectedVersion: group.version,
      replyPolicy: "never",
      background: "",
      tagGroupIds: []
    }),
    (error) => error?.code === "GROUP_VERSION_CONFLICT"
  );
});

test("managed group roles preserve aliases and deletion does not delete the group", () => {
  const group = db.createOrGetGroup({
    botId: "managed_bot_c",
    currentName: "客户协作群",
    source: "callback"
  });

  const first = db.saveGroupRoles({
    botId: "managed_bot_c",
    groupId: group.id,
    expectedVersion: group.version,
    roles: [{
      currentName: "张三",
      identityType: "customer",
      description: "甲方负责人",
      replyPolicy: "always"
    }]
  });
  const roleId = first.roles[0].id;

  const renamed = db.saveGroupRoles({
    botId: "managed_bot_c",
    groupId: group.id,
    expectedVersion: first.group.version,
    roles: [{
      id: roleId,
      currentName: "张三-甲方负责人",
      identityType: "customer",
      description: "甲方负责人",
      replyPolicy: "always"
    }]
  });

  assert.deepEqual(renamed.roles[0].aliases, ["张三"]);
  const deleted = db.saveGroupRoles({
    botId: "managed_bot_c",
    groupId: group.id,
    expectedVersion: renamed.group.version,
    roles: []
  });
  assert.deepEqual(deleted.roles, []);
  assert.equal(db.getGroupById({ botId: "managed_bot_c", groupId: group.id }).id, group.id);
});

test("same-name candidates are isolated by Bot and ambiguous within one Bot", () => {
  const first = db.createOrGetGroup({
    botId: "managed_bot_d",
    currentName: "同名群",
    source: "callback"
  });
  db.createOrGetGroup({
    botId: "managed_bot_e",
    currentName: "同名群",
    source: "callback"
  });

  assert.equal(
    db.resolveGroupByAddress({ botId: "managed_bot_d", groupName: "同名群" }).group.id,
    first.id
  );
  assert.equal(
    db.resolveGroupByAddress({ botId: "managed_bot_e", groupName: "同名群" }).status,
    "resolved"
  );
});

test("managed groups can be searched and paginated per Bot", () => {
  db.createOrGetGroup({ botId: "managed_bot_list", currentName: "甲售后群", source: "callback" });
  db.createOrGetGroup({ botId: "managed_bot_list", currentName: "乙项目群", source: "callback" });
  db.createOrGetGroup({ botId: "managed_bot_other", currentName: "甲外部群", source: "callback" });

  const page = db.listGroupsPage({
    botId: "managed_bot_list",
    search: "甲",
    page: 1,
    pageSize: 10
  });
  assert.deepEqual(page.items.map((group) => group.currentName), ["甲售后群"]);
  assert.deepEqual(page.pagination, { page: 1, pageSize: 10, total: 1, totalPages: 1 });
});

test("first managed discovery migrates a legacy named group conversation to the stable key", () => {
  const botId = "managed_bot_legacy";
  const legacyKey = `${botId}:group:历史售后群`;
  db.upsertConversation({
    botId,
    agentId: "agent_legacy",
    conversationKey: legacyKey,
    message: { roomType: 1, receivedName: "张三", groupName: "历史售后群" }
  });
  db.getOrCreateConversationSession({ botId, conversationKey: legacyKey });
  db.insertConversationMessage({
    botId,
    conversationKey: legacyKey,
    direction: "inbound",
    senderName: "张三",
    content: "之前的历史消息"
  });

  const group = db.createOrGetGroup({
    botId,
    currentName: "历史售后群",
    source: "callback"
  });

  assert.equal(db.getConversation(legacyKey), null);
  assert.equal(db.getConversation(group.conversationKey).groupName, "历史售后群");
  assert.equal(db.getFlowSession(group.conversationKey).conversationKey, group.conversationKey);
  assert.equal(
    db.listConversationMessages({ botId, conversationKey: group.conversationKey })[0].content,
    "之前的历史消息"
  );
});

test("manual merge preserves source names as aliases and removes only the duplicate registry", () => {
  const botId = "managed_bot_merge";
  const target = db.createOrGetGroup({ botId, currentName: "项目交付群", source: "callback" });
  const source = db.createOrGetGroup({ botId, currentName: "项目群", source: "callback" });

  const merged = db.mergeGroupAlias({
    botId,
    sourceGroupId: source.id,
    targetGroupId: target.id
  });

  assert.equal(merged.id, target.id);
  assert.equal(db.getGroupById({ botId, groupId: source.id }), null);
  assert.equal(
    db.resolveGroupByAddress({ botId, groupName: "项目群" }).group.id,
    target.id
  );
});

test("a managed group conversation receives the group creation date tag", () => {
  const botId = "managed_bot_date_tag";
  const agentId = "managed_agent_date_tag";
  db.upsertBotBinding({ botId, botName: "日期群 Bot", agentId, enabled: true });
  db.upsertAgentTagSchema({
    agentId,
    schema: { dateTag: { enabled: true, cutoffTime: "00:00" }, groups: [] }
  });
  const group = db.createOrGetGroup({
    botId,
    currentName: "历史项目群",
    source: "worktool_list",
    discoveredAt: "2026-07-29T08:00:00.000Z",
    createdAt: "2026-07-04T03:00:00.000Z"
  });
  db.upsertConversation({
    botId,
    agentId,
    conversationKey: group.conversationKey,
    message: {
      roomType: 1,
      receivedName: "张三",
      groupName: group.currentName
    }
  });

  const tags = db.ensureManagedGroupConversationDateTag({
    botId,
    agentId,
    conversationKey: group.conversationKey,
    groupCreatedAt: group.groupCreatedAt
  });

  assert.equal(tags.find((tag) => tag.tagType === "date")?.tagId, "20260704");
});

test("a timezone-free WorkTool group creation time is interpreted in Beijing", () => {
  const botId = "managed_bot_beijing_date";
  const agentId = "managed_agent_beijing_date";
  db.upsertBotBinding({ botId, botName: "北京时间 Bot", agentId, enabled: true });
  db.upsertAgentTagSchema({
    agentId,
    schema: { dateTag: { enabled: true, cutoffTime: "00:00" }, groups: [] }
  });
  const group = db.createOrGetGroup({
    botId,
    currentName: "北京时间项目群",
    source: "worktool_list",
    discoveredAt: "2026-07-30T03:00:00.000Z",
    createdAt: "2026-07-29 20:00:00"
  });
  db.upsertConversation({
    botId,
    agentId,
    conversationKey: group.conversationKey,
    message: {
      roomType: 1,
      receivedName: "王五",
      groupName: group.currentName
    }
  });

  const originalTimezone = process.env.TZ;
  process.env.TZ = "UTC";
  try {
    const tags = db.ensureManagedGroupConversationDateTag({
      botId,
      agentId,
      conversationKey: group.conversationKey,
      groupCreatedAt: group.groupCreatedAt
    });
    assert.equal(tags.find((tag) => tag.tagType === "date")?.tagId, "20260729");
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test("WorkTool refresh corrects a first-discovered group date and its date tag", () => {
  const botId = "managed_bot_date_correction";
  const agentId = "managed_agent_date_correction";
  db.upsertBotBinding({ botId, botName: "日期纠正 Bot", agentId, enabled: true });
  db.upsertAgentTagSchema({
    agentId,
    schema: { dateTag: { enabled: true, cutoffTime: "00:00" }, groups: [] }
  });
  const discovered = db.createOrGetGroup({
    botId,
    currentName: "先回调后同步群",
    source: "callback",
    discoveredAt: "2026-07-29T08:00:00.000Z"
  });
  db.upsertConversation({
    botId,
    agentId,
    conversationKey: discovered.conversationKey,
    message: {
      roomType: 1,
      receivedName: "赵六",
      groupName: discovered.currentName
    }
  });
  db.ensureManagedGroupConversationDateTag({
    botId,
    agentId,
    conversationKey: discovered.conversationKey,
    groupCreatedAt: discovered.groupCreatedAt
  });
  assert.equal(
    db.listConversationTags({ botId, agentId, conversationKey: discovered.conversationKey })
      .find((tag) => tag.tagType === "date")?.tagId,
    "20260729"
  );

  const refreshed = db.createOrGetGroup({
    botId,
    currentName: discovered.currentName,
    source: "worktool_list",
    createdAt: "2026-07-04 11:00:00"
  });

  assert.equal(refreshed.groupCreatedAt, "2026-07-04T03:00:00.000Z");
  assert.equal(refreshed.dateSource, "channel");
  assert.equal(
    db.listConversationTags({ botId, agentId, conversationKey: discovered.conversationKey })
      .find((tag) => tag.tagType === "date")?.tagId,
    "20260704"
  );
});

test("existing managed group conversations backfill their creation date tags", () => {
  const botId = "managed_bot_date_backfill";
  const agentId = "managed_agent_date_backfill";
  db.upsertBotBinding({ botId, botName: "存量日期群 Bot", agentId, enabled: true });
  db.upsertAgentTagSchema({
    agentId,
    schema: { dateTag: { enabled: true, cutoffTime: "00:00" }, groups: [] }
  });
  const group = db.createOrGetGroup({
    botId,
    currentName: "存量项目群",
    source: "worktool_list",
    discoveredAt: "2026-07-29T08:00:00.000Z",
    createdAt: "2026-06-18T03:00:00.000Z"
  });
  db.upsertConversation({
    botId,
    agentId,
    conversationKey: group.conversationKey,
    message: {
      roomType: 1,
      receivedName: "李四",
      groupName: group.currentName
    }
  });

  assert.equal(
    db.listConversationTags({ botId, agentId, conversationKey: group.conversationKey }).length,
    0
  );
  assert.equal(db.backfillManagedGroupConversationDateTags(), 1);
  assert.equal(
    db.listConversationTags({ botId, agentId, conversationKey: group.conversationKey })
      .find((tag) => tag.tagType === "date")?.tagId,
    "20260618"
  );
});
