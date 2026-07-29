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
      replyPolicy: "always",
      desiredMarkName: "张三-甲方负责人",
      originalMarkName: "张三",
      syncMarkName: true
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
      replyPolicy: "always",
      desiredMarkName: "张三-甲方负责人",
      originalMarkName: "张三-甲方负责人",
      syncMarkName: false
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

test("a successful external member remark becomes the new unchanged baseline", () => {
  const botId = "managed_bot_remark";
  const group = db.createOrGetGroup({ botId, currentName: "备注群", source: "callback" });
  const saved = db.saveGroupRoles({
    botId,
    groupId: group.id,
    expectedVersion: group.version,
    roles: [{
      currentName: "张三",
      desiredMarkName: "张三-甲方负责人",
      originalMarkName: "张三",
      syncMarkName: true
    }]
  });
  const role = saved.roles[0];

  const synced = db.markGroupRoleRemarkSynced({
    botId,
    groupId: group.id,
    roleId: role.id,
    markName: "张三-甲方负责人"
  });

  assert.equal(synced.originalMarkName, "张三-甲方负责人");
  assert.equal(synced.desiredMarkName, "张三-甲方负责人");
  assert.equal(synced.currentName, "张三-甲方负责人");
  assert.deepEqual(synced.aliases, ["张三"]);
  assert.equal(synced.syncMarkName, false);
});
