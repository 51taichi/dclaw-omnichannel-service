import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dateTagIdFor } from "../src/tags.js";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omnichannel-history-db-"));
const db = await import("../src/db.js");

test("Whapi history imports are idempotent by provider message id", () => {
  const input = {
    botId: "history-bot",
    conversationKey: "whapi:chan:private:alice",
    source: "whapi_chat_history",
    messages: [{
      sourceKey: "message-1",
      direction: "inbound",
      senderName: "Alice",
      content: "hello",
      createdAt: "2026-08-01T01:00:00.000Z",
      rawPayload: { provider: "whapi" }
    }]
  };

  assert.equal(db.insertImportedConversationMessages(input), 1);
  assert.equal(db.insertImportedConversationMessages(input), 0);
  assert.equal(db.listConversationMessages({
    botId: input.botId,
    conversationKey: input.conversationKey
  }).length, 1);
});

test("distinct Whapi provider ids are not semantically collapsed", () => {
  const inserted = db.insertImportedConversationMessages({
    botId: "distinct-bot",
    conversationKey: "whapi:chan:private:distinct",
    source: "whapi_chat_history",
    messages: ["id-1", "id-2"].map((sourceKey) => ({
      sourceKey,
      direction: "inbound",
      senderName: "Customer",
      content: "same content",
      createdAt: "2026-08-01T01:00:00.000Z",
      rawPayload: {}
    }))
  });
  assert.equal(inserted, 2);
});

test("Whapi history does not duplicate an already persisted realtime provider message", () => {
  const botId = "realtime-history-bot";
  const conversationKey = "whapi:chan:private:carol";
  db.insertConversationMessage({
    botId,
    conversationKey,
    direction: "inbound",
    senderName: "Carol",
    content: "already live",
    rawPayload: { messageId: "provider-1" }
  });
  const inserted = db.insertImportedConversationMessages({
    botId,
    conversationKey,
    source: "whapi_chat_history",
    messages: [{
      sourceKey: "provider-1", direction: "inbound", senderName: "Carol",
      content: "already live", createdAt: new Date().toISOString(), rawPayload: {}
    }]
  });
  assert.equal(inserted, 0);
  assert.equal(db.listConversationMessages({ botId, conversationKey }).length, 1);
});

test("Whapi history recognizes outbound scalar and array provider identities", () => {
  const cases = [
    { id: "out-scalar", rawPayload: { channelMessageId: "out-scalar" } },
    { id: "out-array", rawPayload: { channelMessageIds: ["out-array"] } },
    { id: "manual-array", rawPayload: { messageIds: ["manual-array"] } }
  ];
  for (const item of cases) {
    const conversationKey = `whapi:chan:private:${item.id}`;
    db.insertConversationMessage({
      botId: "outbound-history-bot",
      conversationKey,
      direction: "outbound",
      senderName: "Sales",
      content: item.id,
      rawPayload: item.rawPayload
    });
    assert.equal(db.insertImportedConversationMessages({
      botId: "outbound-history-bot",
      conversationKey,
      source: "whapi_chat_history",
      messages: [{
        sourceKey: item.id, direction: "outbound", senderName: "Sales",
        content: item.id, createdAt: new Date().toISOString(), rawPayload: {}
      }]
    }), 0);
  }
});

test("first-discovery tagging uses historical time and preserves an existing date tag", () => {
  const botId = "history-tag-bot";
  const agentId = "history-tag-agent";
  const conversationKey = "whapi:chan:private:bob";
  db.upsertAgentTagSchema({
    agentId,
    schema: { dateTag: { enabled: true, cutoffTime: "00:00" }, groups: [] }
  });
  db.upsertConversation({
    botId,
    agentId,
    conversationKey,
    message: { roomType: 2, receivedName: "Bob", groupName: "Bob" },
    skipFirstSeenDateTag: true
  });
  const historicalAt = "2024-03-02T01:00:00.000Z";

  db.ensureFirstDiscoveryDateTag({ botId, agentId, conversationKey, firstSeenAt: historicalAt });
  assert.deepEqual(
    db.listConversationTags({ botId, agentId, conversationKey })
      .filter((tag) => tag.tagType === "date")
      .map((tag) => tag.tagId),
    [dateTagIdFor(new Date(historicalAt), "00:00")]
  );

  db.ensureFirstDiscoveryDateTag({
    botId,
    agentId,
    conversationKey,
    firstSeenAt: "2023-01-01T00:00:00.000Z"
  });
  assert.equal(
    db.listConversationTags({ botId, agentId, conversationKey })
      .filter((tag) => tag.tagType === "date").length,
    1
  );
});
