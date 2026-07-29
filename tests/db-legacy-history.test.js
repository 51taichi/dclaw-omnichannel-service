import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { dateTagIdFor } from "../src/tags.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-legacy-history-test-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");
const rawDb = new DatabaseSync(path.join(dataDir, "worktool-bot-service.sqlite"));

function insertRawConversationMessage({
  botId,
  conversationKey,
  direction = "inbound",
  senderName = "",
  content,
  source = "local",
  sourceKey,
  createdAt
}) {
  return Number(rawDb.prepare(`
    INSERT INTO conversation_messages (
      bot_id, conversation_key, direction, sender_name, content,
      raw_payload_json, source, source_key, created_at
    )
    VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?)
  `).run(
    botId,
    conversationKey,
    direction,
    senderName,
    content,
    source,
    sourceKey,
    createdAt
  ).lastInsertRowid);
}

test("migrates only imported outbound sender names to the bound Bot name once", () => {
  const botId = "history_sender_migration_bot";
  const conversationKey = `${botId}:private:张彬`;
  db.upsertBotBinding({
    botId,
    botName: "张三老师",
    agentId: "history_sender_migration_agent",
    agentName: "鲸小助",
    dclawBaseUrl: "https://dclaw.example.test",
    dclawPublicId: "history_sender_migration_agent",
    agentApiKey: "",
    enabled: true
  });
  const importedCustomerId = insertRawConversationMessage({
    botId,
    conversationKey,
    direction: "outbound",
    senderName: "张彬",
    content: "客户历史中的机器人回复",
    source: "worktool_customer_history",
    sourceKey: "customer-outbound",
    createdAt: "2026-07-28T08:00:00.000Z"
  });
  const importedApiId = insertRawConversationMessage({
    botId,
    conversationKey,
    direction: "outbound",
    senderName: "张彬",
    content: "API 历史中的机器人回复",
    source: "worktool_api_history",
    sourceKey: "api-outbound",
    createdAt: "2026-07-28T08:01:00.000Z"
  });
  const inboundId = insertRawConversationMessage({
    botId,
    conversationKey,
    direction: "inbound",
    senderName: "张彬",
    content: "客户发言",
    source: "worktool_customer_history",
    sourceKey: "customer-inbound",
    createdAt: "2026-07-28T08:02:00.000Z"
  });
  const localOutboundId = insertRawConversationMessage({
    botId,
    conversationKey,
    direction: "outbound",
    senderName: "原客服名称",
    content: "本地机器人回复",
    source: "local",
    sourceKey: "local-outbound",
    createdAt: "2026-07-28T08:03:00.000Z"
  });

  assert.equal(db.migrateLegacyHistoryOutboundSenderNames(), 2);
  const senderName = (id) => rawDb.prepare(
    "SELECT sender_name FROM conversation_messages WHERE id = ?"
  ).get(id).sender_name;
  assert.equal(senderName(importedCustomerId), "张三老师");
  assert.equal(senderName(importedApiId), "张三老师");
  assert.equal(senderName(inboundId), "张彬");
  assert.equal(senderName(localOutboundId), "原客服名称");
  assert.equal(db.migrateLegacyHistoryOutboundSenderNames(), 0);
});

test("creates a legacy flow session at the last valid node", () => {
  const session = db.createLegacyFlowSession({
    botId: "legacy_bot",
    conversationKey: "legacy_bot:private:阿三",
    machine: {
      entryNodeId: "node_1",
      config: { nodes: [{ id: "node_1" }, { id: "node_2" }, { id: "" }] }
    }
  });

  assert.equal(session.currentNodeId, "node_2");
  assert.equal(session.customerOrigin, "legacy");
  assert.equal(session.historySyncStatus, "loading");
});

test("imports external history once and preserves chronological order", () => {
  const botId = "import_bot";
  const conversationKey = `${botId}:private:阿三`;
  db.insertConversationMessage({
    botId,
    conversationKey,
    direction: "inbound",
    senderName: "阿三",
    content: "当前消息",
    rawPayload: {}
  });
  const imported = {
    sourceKey: "stable-key",
    direction: "inbound",
    senderName: "阿三",
    content: "旧消息",
    createdAt: "2026-07-17T17:22:28.000Z",
    rawPayload: { title: "阿三" }
  };

  assert.equal(db.insertImportedConversationMessages({
    botId,
    conversationKey,
    source: "worktool_customer_history",
    messages: [imported, imported]
  }), 1);
  assert.deepEqual(
    db.listConversationMessages({ botId, conversationKey }).map((message) => message.content),
    ["旧消息", "当前消息"]
  );
});

test("limited conversation history returns the most recent messages in chronological order", () => {
  const botId = "recent_bot";
  const conversationKey = `${botId}:private:阿三`;
  for (const content of ["第一条", "第二条", "第三条"]) {
    db.insertConversationMessage({
      botId,
      conversationKey,
      direction: "inbound",
      senderName: "阿三",
      content,
      rawPayload: {}
    });
  }

  assert.deepEqual(
    db.listConversationMessages({ botId, conversationKey, limit: 2 })
      .map((message) => message.content),
    ["第二条", "第三条"]
  );
});

test("new imported history reopens one-time Agent context delivery", () => {
  const botId = "context_bot";
  const conversationKey = `${botId}:private:阿三`;
  db.createLegacyFlowSession({
    botId,
    conversationKey,
    machine: { config: { nodes: [{ id: "final" }] } }
  });
  db.markLegacyHistoryContextSent({ botId, conversationKey });
  assert.ok(db.getFlowSessionForBot({ botId, conversationKey }).historyContextSentAt);

  db.insertImportedConversationMessages({
    botId,
    conversationKey,
    source: "worktool_customer_history",
    messages: [{
      sourceKey: "new-history",
      direction: "inbound",
      senderName: "阿三",
      content: "历史",
      createdAt: "2026-07-17T17:22:28.000Z",
      rawPayload: {}
    }]
  });
  assert.equal(db.getFlowSessionForBot({ botId, conversationKey }).historyContextSentAt, "");
});

test("outbound API history backfill does not reopen completed customer analysis", () => {
  const botId = "outbound_context_bot";
  const conversationKey = `${botId}:private:阿三`;
  db.createLegacyFlowSession({
    botId,
    conversationKey,
    machine: { config: { nodes: [{ id: "final" }] } }
  });
  db.markLegacyHistoryContextSent({ botId, conversationKey });
  const completedAt = db.getFlowSessionForBot({ botId, conversationKey }).historyContextSentAt;

  db.insertImportedConversationMessages({
    botId,
    conversationKey,
    source: "worktool_api_history",
    messages: [{
      sourceKey: "outbound-history",
      direction: "outbound",
      senderName: "机器人",
      content: "此前系统回复",
      createdAt: "2026-07-17T17:22:28.000Z",
      rawPayload: {}
    }]
  });

  assert.equal(
    db.getFlowSessionForBot({ botId, conversationKey }).historyContextSentAt,
    completedAt
  );
});

test("legacy history uses the earliest imported timestamp for one date tag", () => {
  const botId = "legacy_date_bot";
  const agentId = "legacy_date_agent";
  const conversationKey = `${botId}:private:历史客户`;
  const earliestCustomerAt = "2026-06-30T14:01:00.000Z";
  db.upsertAgentTagSchema({
    agentId,
    schema: {
      dateTag: { enabled: true, cutoffTime: "20:00" },
      groups: []
    }
  });
  db.upsertConversation({
    botId,
    agentId,
    conversationKey,
    skipFirstSeenDateTag: true,
    message: { roomType: 2, receivedName: "历史客户", groupName: "历史客户" }
  });

  db.ensureLegacyHistoryDateTag({
    botId,
    agentId,
    conversationKey,
    firstSeenAt: earliestCustomerAt
  });
  db.ensureLegacyHistoryDateTag({
    botId,
    agentId,
    conversationKey,
    firstSeenAt: earliestCustomerAt
  });

  const dateTags = db.listConversationTags({ botId, agentId, conversationKey })
    .filter((tag) => tag.tagType === "date");
  assert.equal(dateTags.length, 1);
  assert.equal(dateTags[0].tagId, dateTagIdFor(earliestCustomerAt, "20:00"));
  assert.equal(dateTags[0].source, "legacy_history");
});

test("stores and queries API messages through contact aliases", () => {
  db.upsertWorktoolApiMessageCache({
    botId: "cache_bot",
    items: [
      { messageId: "m1", commandIndex: 0, targetName: "魔兮", type: 203, content: "在吗", createdAt: "2026-07-02T08:02:18.000Z", rawPayload: {} },
      { messageId: "m2", commandIndex: 0, targetName: "魔兮-18570860666", type: 203, content: "你好", createdAt: "2026-07-17T17:03:00.000Z", rawPayload: {} }
    ]
  });

  assert.equal(db.hasCachedWorktoolMessageId({ botId: "cache_bot", messageId: "m1" }), true);
  assert.equal(db.listCachedApiMessages({
    botId: "cache_bot",
    targetNames: ["魔兮", "魔兮-18570860666"]
  }).length, 2);
});

test("API message cache batches roll back together on persistence errors", () => {
  const circularPayload = {};
  circularPayload.self = circularPayload;

  assert.throws(() => db.upsertWorktoolApiMessageCache({
    botId: "atomic_cache_bot",
    items: [
      {
        messageId: "atomic-1",
        commandIndex: 0,
        targetName: "阿三",
        type: 203,
        content: "第一条",
        createdAt: "2026-07-20T01:00:00.000Z",
        rawPayload: {}
      },
      {
        messageId: "atomic-2",
        commandIndex: 0,
        targetName: "阿三",
        type: 203,
        content: "第二条",
        createdAt: "2026-07-20T01:01:00.000Z",
        rawPayload: circularPayload
      }
    ]
  }), /circular/i);

  assert.equal(db.hasCachedWorktoolMessageId({
    botId: "atomic_cache_bot",
    messageId: "atomic-1"
  }), false);
});

test("legacy persistence can skip the first-seen date tag", () => {
  const botId = "legacy_date_bot";
  const agentId = "legacy_date_agent";
  const conversationKey = `${botId}:private:老客户`;
  db.upsertAgentTagSchema({
    agentId,
    schema: { dateTag: { enabled: true }, groups: [] }
  });
  db.upsertConversation({
    botId,
    agentId,
    conversationKey,
    message: { roomType: 2, receivedName: "老客户" },
    skipFirstSeenDateTag: true
  });

  assert.deepEqual(
    db.listConversationTags({ botId, agentId, conversationKey })
      .filter((tag) => tag.tagType === "date"),
    []
  );
});

test("friend-added reset clears legacy metadata", () => {
  const botId = "readd_bot";
  const agentId = "readd_agent";
  const conversationKey = `${botId}:private:阿三`;
  db.upsertConversation({
    botId,
    agentId,
    conversationKey,
    message: { roomType: 2, receivedName: "阿三" }
  });
  db.createLegacyFlowSession({
    botId,
    conversationKey,
    machine: { config: { nodes: [{ id: "final" }] } }
  });
  db.resetConversationForFriendGreeting({ botId, agentId, conversationKey });

  const session = db.getFlowSessionForBot({ botId, conversationKey });
  assert.equal(session.customerOrigin, "new");
  assert.equal(session.historySyncStatus, "not_required");
  assert.equal(session.historyImportedCount, 0);
});

test("import skips a row already stored through the live callback", () => {
  const botId = "dedupe_live_bot";
  const conversationKey = `${botId}:private:客户`;
  const local = db.insertConversationMessage({
    botId,
    conversationKey,
    direction: "inbound",
    senderName: "客户",
    content: "老师在吗",
    rawPayload: { messageId: "live-1" }
  });

  assert.equal(db.insertImportedConversationMessages({
    botId,
    conversationKey,
    source: "worktool_customer_history",
    messages: [{
      sourceKey: "history-1",
      direction: "inbound",
      senderName: "客户",
      content: "老师在吗",
      createdAt: local.createdAt,
      rawPayload: {}
    }]
  }), 0);
  assert.deepEqual(
    db.listConversationMessages({ botId, conversationKey }).map((message) => message.id),
    [local.id]
  );
});

test("import skips alias duplicates but keeps repeated local messages", () => {
  const botId = "dedupe_alias_bot";
  const conversationKey = `${botId}:private:客户`;
  const createdAt = "2026-07-25T15:22:00.000Z";
  assert.equal(db.insertImportedConversationMessages({
    botId,
    conversationKey,
    source: "worktool_customer_history",
    messages: [
      {
        sourceKey: "alias-a",
        direction: "inbound",
        content: "你好",
        createdAt,
        rawPayload: { titleList: "客户" }
      },
      {
        sourceKey: "alias-b",
        direction: "inbound",
        content: "你好",
        createdAt,
        rawPayload: { titleList: "客户-手机号" }
      }
    ]
  }), 1);

  db.insertConversationMessage({
    botId,
    conversationKey,
    direction: "inbound",
    content: "重复发送",
    rawPayload: { messageId: "local-a" }
  });
  db.insertConversationMessage({
    botId,
    conversationKey,
    direction: "inbound",
    content: "重复发送",
    rawPayload: { messageId: "local-b" }
  });
  assert.equal(
    db.listConversationMessages({ botId, conversationKey })
      .filter((message) => message.content === "重复发送").length,
    2
  );
});

test("read views prefer richer customer history without deleting API history", () => {
  const botId = "dedupe_imported_bot";
  const conversationKey = `${botId}:private:客户`;
  const createdAt = "2026-07-25T15:22:00.000Z";
  assert.equal(db.insertImportedConversationMessages({
    botId,
    conversationKey,
    source: "worktool_api_history",
    messages: [{
      sourceKey: "api-message",
      direction: "outbound",
      senderName: "机器人",
      content: "课程介绍",
      createdAt,
      rawPayload: { type: 203 }
    }]
  }), 1);
  assert.equal(db.insertImportedConversationMessages({
    botId,
    conversationKey,
    source: "worktool_customer_history",
    messages: [{
      sourceKey: "customer-message",
      direction: "outbound",
      senderName: "老师",
      content: "课程介绍",
      createdAt,
      rawPayload: { fileUrl: "https://example.test/course.jpg" }
    }]
  }), 1);

  const rawImported = db.listImportedConversationMessages({ botId, conversationKey });
  assert.equal(rawImported.length, 2);
  assert.deepEqual(
    db.listConversationMessages({ botId, conversationKey }).map((message) => message.source),
    ["worktool_customer_history"]
  );
});

test("read views prefer local rows while evidence reads preserve imported anchors", () => {
  const botId = "dedupe_anchor_bot";
  const conversationKey = `${botId}:private:客户`;
  const createdAt = new Date().toISOString();
  db.insertImportedConversationMessages({
    botId,
    conversationKey,
    source: "worktool_customer_history",
    messages: [{
      sourceKey: "anchor-history",
      direction: "inbound",
      senderName: "客户",
      content: "想了解课程",
      createdAt,
      rawPayload: {}
    }]
  });
  const imported = db.listImportedConversationMessages({ botId, conversationKey })[0];
  const local = db.insertConversationMessage({
    botId,
    conversationKey,
    direction: "inbound",
    senderName: "客户",
    content: "想了解课程",
    rawPayload: { messageId: "live-anchor" }
  });

  assert.deepEqual(
    db.listConversationMessages({ botId, conversationKey }).map((message) => message.id),
    [local.id]
  );
  assert.deepEqual(
    db.listConversationMessagesAround({
      botId,
      conversationKey,
      anchorMessageId: imported.id,
      before: 10,
      after: 10
    }).filter((message) => message.content === "想了解课程")
      .map((message) => message.id),
    [imported.id]
  );
});

test("limited reads fetch enough surplus rows to fill the visible result", () => {
  const botId = "dedupe_limit_bot";
  const conversationKey = `${botId}:private:客户`;
  for (let index = 1; index <= 3; index += 1) {
    const createdAt = `2026-07-25T15:2${index}:00.000Z`;
    db.insertImportedConversationMessages({
      botId,
      conversationKey,
      source: "worktool_api_history",
      messages: [{
        sourceKey: `api-${index}`,
        direction: "outbound",
        content: `消息${index}`,
        createdAt,
        rawPayload: {}
      }]
    });
    db.insertImportedConversationMessages({
      botId,
      conversationKey,
      source: "worktool_customer_history",
      messages: [{
        sourceKey: `customer-${index}`,
        direction: "outbound",
        content: `消息${index}`,
        createdAt,
        rawPayload: {}
      }]
    });
  }

  assert.deepEqual(
    db.listConversationMessages({ botId, conversationKey, limit: 2 })
      .map((message) => message.content),
    ["消息2", "消息3"]
  );
});

test("semantic import matching stays isolated by bot and conversation", () => {
  const createdAt = "2026-07-25T15:22:00.000Z";
  db.insertImportedConversationMessages({
    botId: "dedupe_scope_bot_a",
    conversationKey: "dedupe_scope_bot_a:private:客户甲",
    source: "worktool_customer_history",
    messages: [{
      sourceKey: "scope-a",
      direction: "inbound",
      content: "同一句话",
      createdAt,
      rawPayload: {}
    }]
  });

  assert.equal(db.insertImportedConversationMessages({
    botId: "dedupe_scope_bot_b",
    conversationKey: "dedupe_scope_bot_b:private:客户甲",
    source: "worktool_customer_history",
    messages: [{
      sourceKey: "scope-b",
      direction: "inbound",
      content: "同一句话",
      createdAt,
      rawPayload: {}
    }]
  }), 1);
  assert.equal(db.insertImportedConversationMessages({
    botId: "dedupe_scope_bot_a",
    conversationKey: "dedupe_scope_bot_a:private:客户乙",
    source: "worktool_customer_history",
    messages: [{
      sourceKey: "scope-c",
      direction: "inbound",
      content: "同一句话",
      createdAt,
      rawPayload: {}
    }]
  }), 1);
});

test("limited reads close the duplicate tolerance boundary before selecting newest rows", () => {
  const botId = "dedupe_boundary_bot";
  const conversationKey = `${botId}:private:客户`;
  insertRawConversationMessage({
    botId,
    conversationKey,
    content: "重复消息",
    source: "local",
    sourceKey: "local-canonical",
    createdAt: "2026-07-25T15:22:00.000Z"
  });
  for (let index = 6; index <= 9; index += 1) {
    insertRawConversationMessage({
      botId,
      conversationKey,
      content: `唯一消息${index}`,
      source: "worktool_customer_history",
      sourceKey: `unique-${index}`,
      createdAt: `2026-07-25T15:22:0${index}.000Z`
    });
  }
  insertRawConversationMessage({
    botId,
    conversationKey,
    content: "重复消息",
    source: "worktool_customer_history",
    sourceKey: "imported-duplicate",
    createdAt: "2026-07-25T15:22:10.000Z"
  });

  assert.deepEqual(
    db.listConversationMessages({ botId, conversationKey, limit: 1 })
      .map((message) => message.content),
    ["唯一消息9"]
  );
});

test("evidence reads close duplicate boundaries for non-anchor rows", () => {
  const botId = "dedupe_evidence_boundary_bot";
  const conversationKey = `${botId}:private:客户`;
  insertRawConversationMessage({
    botId,
    conversationKey,
    content: "重复消息",
    source: "local",
    sourceKey: "local-canonical",
    createdAt: "2026-07-25T15:22:00.000Z"
  });
  for (let index = 6; index <= 9; index += 1) {
    insertRawConversationMessage({
      botId,
      conversationKey,
      content: `唯一消息${index}`,
      source: "worktool_customer_history",
      sourceKey: `unique-${index}`,
      createdAt: `2026-07-25T15:22:0${index}.000Z`
    });
  }
  insertRawConversationMessage({
    botId,
    conversationKey,
    content: "重复消息",
    source: "worktool_customer_history",
    sourceKey: "imported-duplicate",
    createdAt: "2026-07-25T15:22:10.000Z"
  });
  const anchorId = insertRawConversationMessage({
    botId,
    conversationKey,
    content: "证据锚点",
    source: "local",
    sourceKey: "anchor",
    createdAt: "2026-07-25T15:22:20.000Z"
  });

  assert.deepEqual(
    db.listConversationMessagesAround({
      botId,
      conversationKey,
      anchorMessageId: anchorId,
      before: 1,
      after: 0
    }).map((message) => message.content),
    ["唯一消息9", "证据锚点"]
  );
});

test("conversation message lookups use scope and timestamp indexes", () => {
  const importPlan = rawDb.prepare(`
    EXPLAIN QUERY PLAN
    SELECT *
    FROM conversation_messages
    WHERE bot_id = ?
      AND conversation_key = ?
      AND direction = ?
      AND created_at BETWEEN ? AND ?
    ORDER BY created_at ASC, id ASC
  `).all(
    "query_plan_bot",
    "query_plan_bot:private:客户",
    "inbound",
    "2026-07-25T15:22:00.000Z",
    "2026-07-25T15:23:00.000Z"
  );
  const readPlan = rawDb.prepare(`
    EXPLAIN QUERY PLAN
    SELECT *
    FROM conversation_messages
    WHERE bot_id = ?
      AND conversation_key = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 20
  `).all("query_plan_bot", "query_plan_bot:private:客户");

  assert.match(
    importPlan.map((row) => row.detail).join("\n"),
    /idx_conversation_messages_scope_direction_time/
  );
  assert.match(
    readPlan.map((row) => row.detail).join("\n"),
    /idx_conversation_messages_scope_time/
  );
});

test("limited reads continue past malformed timestamp cursors", () => {
  const botId = "dedupe_invalid_cursor_bot";
  const conversationKey = `${botId}:private:客户`;
  insertRawConversationMessage({
    botId,
    conversationKey,
    content: "重复消息",
    source: "local",
    sourceKey: "local-canonical",
    createdAt: "2026-07-25T15:22:00.000Z"
  });
  insertRawConversationMessage({
    botId,
    conversationKey,
    content: "异常时间消息",
    source: "worktool_customer_history",
    sourceKey: "invalid-cursor",
    createdAt: "2026-07-25T15:22:07.invalid"
  });
  for (const second of [8, 9]) {
    insertRawConversationMessage({
      botId,
      conversationKey,
      content: `唯一消息${second}`,
      source: "worktool_customer_history",
      sourceKey: `unique-${second}`,
      createdAt: `2026-07-25T15:22:0${second}.000Z`
    });
  }
  insertRawConversationMessage({
    botId,
    conversationKey,
    content: "重复消息",
    source: "worktool_customer_history",
    sourceKey: "imported-duplicate",
    createdAt: "2026-07-25T15:22:10.000Z"
  });

  assert.deepEqual(
    db.listConversationMessages({ botId, conversationKey, limit: 1 })
      .map((message) => message.content),
    ["唯一消息9"]
  );
});

test("evidence reads continue past malformed timestamp cursors", () => {
  const botId = "dedupe_invalid_evidence_cursor_bot";
  const conversationKey = `${botId}:private:客户`;
  insertRawConversationMessage({
    botId,
    conversationKey,
    content: "重复消息",
    source: "local",
    sourceKey: "local-canonical",
    createdAt: "2026-07-25T15:22:00.000Z"
  });
  insertRawConversationMessage({
    botId,
    conversationKey,
    content: "异常时间消息",
    source: "worktool_customer_history",
    sourceKey: "invalid-cursor",
    createdAt: "2026-07-25T15:22:07.invalid"
  });
  for (const second of [8, 9]) {
    insertRawConversationMessage({
      botId,
      conversationKey,
      content: `唯一消息${second}`,
      source: "worktool_customer_history",
      sourceKey: `unique-${second}`,
      createdAt: `2026-07-25T15:22:0${second}.000Z`
    });
  }
  insertRawConversationMessage({
    botId,
    conversationKey,
    content: "重复消息",
    source: "worktool_customer_history",
    sourceKey: "imported-duplicate",
    createdAt: "2026-07-25T15:22:10.000Z"
  });
  const anchorId = insertRawConversationMessage({
    botId,
    conversationKey,
    content: "证据锚点",
    source: "local",
    sourceKey: "anchor",
    createdAt: "2026-07-25T15:22:20.000Z"
  });

  assert.deepEqual(
    db.listConversationMessagesAround({
      botId,
      conversationKey,
      anchorMessageId: anchorId,
      before: 1,
      after: 0
    }).map((message) => message.content),
    ["唯一消息9", "证据锚点"]
  );
});

test("evidence reads preserve SQLite ordering for punctuation timestamps", () => {
  const botId = "dedupe_binary_order_bot";
  const conversationKey = `${botId}:private:客户`;
  const anchorId = insertRawConversationMessage({
    botId,
    conversationKey,
    content: "证据锚点",
    source: "local",
    sourceKey: "anchor",
    createdAt: "2026-07-25T15:22:20.000Z"
  });
  insertRawConversationMessage({
    botId,
    conversationKey,
    content: "异常时间消息",
    source: "worktool_customer_history",
    sourceKey: "punctuation-time",
    createdAt: "_bad"
  });

  assert.deepEqual(
    db.listConversationMessagesAround({
      botId,
      conversationKey,
      anchorMessageId: anchorId,
      before: 0,
      after: 1
    }).map((message) => message.content),
    ["证据锚点", "异常时间消息"]
  );
});
