import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dateTagIdFor } from "../src/tags.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-legacy-history-test-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");

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
