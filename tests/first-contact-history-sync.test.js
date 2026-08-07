import assert from "node:assert/strict";
import test from "node:test";

import { syncFirstContactHistory } from "../src/first-contact-history-sync.js";

const historyMessage = (id, timestamp, body, fromMe = false) => ({
  id,
  type: "text",
  chat_id: "1555@s.whatsapp.net",
  from: fromMe ? "1999" : "1555",
  from_name: fromMe ? "Sales" : "Ada",
  from_me: fromMe,
  timestamp,
  text: { body }
});

function dependencies(overrides = {}) {
  const state = { imported: [], tags: [], completed: [] };
  return {
    state,
    value: {
      claimSync: () => ({ claimed: true, record: { status: "processing" } }),
      heartbeatSync: () => {},
      completeSync: (value) => { state.completed.push(value); return value; },
      importMessages: ({ messages }) => { state.imported.push(...messages); return { inserted: messages.length }; },
      ensureDateTag: (value) => { state.tags.push(value); return []; },
      ...overrides
    }
  };
}

test("first-contact history sync paginates, deduplicates the live message, and tags the earliest date", async () => {
  const calls = [];
  const client = {
    async listMessagesByChat(chatId, options) {
      calls.push({ chatId, options });
      return options.offset === 0
        ? {
            messages: [
              historyMessage("old-1", 1785891600, "first"),
              historyMessage("old-2", 1785978000, "second", true)
            ],
            count: 2,
            total: 3
          }
        : { messages: [historyMessage("live-3", 1786064400, "live")], count: 1, total: 3 };
    }
  };
  const deps = dependencies();

  const result = await syncFirstContactHistory({
    botId: "bot-a",
    agentId: "agent-a",
    conversationKey: "whapi:chan:private:1555@s.whatsapp.net",
    channelAccountId: "chan",
    chatId: "1555@s.whatsapp.net",
    currentMessage: { messageId: "live-3", occurredAt: "2026-08-07T01:00:00.000Z" },
    client,
    owner: "worker-a",
    pageSize: 2,
    dependencies: deps.value
  });

  assert.deepEqual(calls.map((call) => call.options.offset), [0, 2]);
  assert.deepEqual(deps.state.imported.map((row) => row.sourceKey), ["old-1", "old-2"]);
  assert.equal(result.status, "success");
  assert.equal(result.pageCount, 2);
  assert.equal(result.importedCount, 2);
  assert.equal(result.earliestAt, "2026-08-05T01:00:00.000Z");
  assert.equal(deps.state.tags[0].firstSeenAt, "2026-08-05T01:00:00.000Z");
});

test("first-contact history sync claims its durable lease before creating the conversation shell", async () => {
  const order = [];
  const deps = dependencies({
    claimSync: () => { order.push("claim"); return { claimed: true, record: { status: "processing" } }; }
  });
  await syncFirstContactHistory({
    botId: "bot-a", agentId: "agent-a", conversationKey: "key-order",
    channelAccountId: "chan", chatId: "1555@s.whatsapp.net",
    currentMessage: { messageId: "live", occurredAt: "2026-08-07T02:00:00.000Z" },
    client: { listMessagesByChat: async () => ({ messages: [], count: 0, total: 0 }) },
    owner: "worker-order",
    prepareConversation: async () => { order.push("prepare"); },
    dependencies: deps.value
  });
  assert.deepEqual(order, ["claim", "prepare"]);
});

test("first-contact history sync degrades safely when history is empty or fails", async () => {
  const emptyDeps = dependencies();
  const empty = await syncFirstContactHistory({
    botId: "bot-a", agentId: "agent-a", conversationKey: "key-a",
    channelAccountId: "chan", chatId: "1555@s.whatsapp.net",
    currentMessage: { messageId: "live", occurredAt: "2026-08-07T02:00:00.000Z" },
    client: { listMessagesByChat: async () => ({ messages: [], count: 0, total: 0 }) },
    owner: "worker-a", dependencies: emptyDeps.value
  });
  assert.equal(empty.status, "unavailable");
  assert.equal(empty.earliestAt, "2026-08-07T02:00:00.000Z");

  const failedDeps = dependencies();
  const failed = await syncFirstContactHistory({
    botId: "bot-a", agentId: "agent-a", conversationKey: "key-b",
    channelAccountId: "chan", chatId: "1555@s.whatsapp.net",
    currentMessage: { messageId: "live", occurredAt: "2026-08-07T03:00:00.000Z" },
    client: { listMessagesByChat: async () => { const error = new Error("provider body secret"); error.code = "rate_limited"; throw error; } },
    owner: "worker-b", dependencies: failedDeps.value
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.errorMessage, "rate_limited");
  assert.equal(JSON.stringify(failedDeps.state.completed).includes("provider body secret"), false);
  assert.equal(failedDeps.state.tags[0].firstSeenAt, "2026-08-07T03:00:00.000Z");
});

test("first-contact history sync honors page and message limits", async () => {
  let calls = 0;
  let heartbeats = 0;
  const deps = dependencies({ heartbeatSync: () => { heartbeats += 1; } });
  const result = await syncFirstContactHistory({
    botId: "bot-a", agentId: "agent-a", conversationKey: "key-limit",
    channelAccountId: "chan", chatId: "1555@s.whatsapp.net",
    currentMessage: { messageId: "live", occurredAt: "2026-08-07T03:00:00.000Z" },
    client: {
      listMessagesByChat: async (_chatId, { offset }) => {
        calls += 1;
        return {
          messages: [historyMessage(`old-${offset}`, 1785891600 + offset, "history")],
          count: 1,
          total: 100
        };
      }
    },
    owner: "worker-limit", maxPages: 2, maxMessages: 2, pageSize: 1,
    dependencies: deps.value
  });
  assert.equal(calls, 2);
  assert.equal(heartbeats, 2);
  assert.equal(result.importedCount, 2);
});

test("first-contact history sync rejects messages belonging to another chat", async () => {
  const deps = dependencies();
  const result = await syncFirstContactHistory({
    botId: "bot-a", agentId: "agent-a", conversationKey: "key-mixed",
    channelAccountId: "chan", chatId: "1555@s.whatsapp.net",
    currentMessage: { messageId: "live", occurredAt: "2026-08-07T03:00:00.000Z" },
    client: { listMessagesByChat: async () => ({
      messages: [{ ...historyMessage("foreign", 1785891600, "foreign"), chat_id: "1666@s.whatsapp.net" }],
      count: 1, total: 1
    }) },
    owner: "worker-mixed", dependencies: deps.value
  });
  assert.equal(result.status, "failed");
  assert.equal(deps.state.imported.length, 0);
});

test("history messages with invalid timestamps remain importable but cannot change the earliest date", async () => {
  const deps = dependencies();
  const result = await syncFirstContactHistory({
    botId: "bot-a", agentId: "agent-a", conversationKey: "key-invalid-time",
    channelAccountId: "chan", chatId: "1555@s.whatsapp.net",
    currentMessage: { messageId: "live", occurredAt: "2026-08-07T03:00:00.000Z" },
    client: { listMessagesByChat: async () => ({
      messages: [{ ...historyMessage("unknown-time", 1785891600, "kept"), timestamp: "bad" }],
      count: 1, total: 1
    }) },
    owner: "worker-invalid-time", dependencies: deps.value
  });
  assert.equal(result.status, "success");
  assert.equal(result.earliestAt, "2026-08-07T03:00:00.000Z");
  assert.equal(deps.state.imported[0].content, "kept");
  assert.equal(deps.state.imported[0].createdAt, "2026-08-07T03:00:00.000Z");
});
