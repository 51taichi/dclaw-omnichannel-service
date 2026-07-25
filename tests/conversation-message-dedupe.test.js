import assert from "node:assert/strict";
import test from "node:test";
import {
  areConversationMessagesDuplicates,
  dedupeConversationMessages,
  normalizeConversationMessageContent
} from "../src/conversation-message-dedupe.js";

function row(overrides = {}) {
  return {
    id: 1,
    botId: "bot-a",
    conversationKey: "bot-a:private:客户",
    direction: "inbound",
    content: "老师 在吗",
    source: "local",
    createdAt: "2026-07-25T15:22:00.000Z",
    ...overrides
  };
}

test("normalizes surrounding and repeated whitespace for comparison", () => {
  assert.equal(normalizeConversationMessageContent(" 老师 \n  在吗 "), "老师 在吗");
});

test("local and imported equivalents match within ten seconds", () => {
  assert.equal(areConversationMessagesDuplicates(
    row(),
    row({
      id: 2,
      source: "worktool_customer_history",
      content: " 老师   在吗 ",
      createdAt: "2026-07-25T15:22:10.000Z"
    })
  ), true);
});

test("local and imported rows outside ten seconds remain distinct", () => {
  assert.equal(areConversationMessagesDuplicates(
    row(),
    row({
      id: 2,
      source: "worktool_customer_history",
      createdAt: "2026-07-25T15:22:10.001Z"
    })
  ), false);
});

test("two local rows are never duplicates", () => {
  assert.equal(areConversationMessagesDuplicates(row(), row({ id: 2 })), false);
});

test("same imported source requires an exact timestamp", () => {
  const imported = row({ source: "worktool_customer_history" });
  assert.equal(areConversationMessagesDuplicates(
    imported,
    row({ id: 2, source: "worktool_customer_history" })
  ), true);
  assert.equal(areConversationMessagesDuplicates(
    imported,
    row({
      id: 3,
      source: "worktool_customer_history",
      createdAt: "2026-07-25T15:22:00.001Z"
    })
  ), false);
});

test("different imported sources allow three seconds only", () => {
  const customer = row({ source: "worktool_customer_history" });
  assert.equal(areConversationMessagesDuplicates(
    customer,
    row({
      id: 2,
      source: "worktool_api_history",
      createdAt: "2026-07-25T15:22:03.000Z"
    })
  ), true);
  assert.equal(areConversationMessagesDuplicates(
    customer,
    row({
      id: 3,
      source: "worktool_api_history",
      createdAt: "2026-07-25T15:22:03.001Z"
    })
  ), false);
});

test("different direction bot or conversation prevents matching", () => {
  const imported = row({ source: "worktool_customer_history" });
  assert.equal(
    areConversationMessagesDuplicates(imported, row({ id: 2, direction: "outbound" })),
    false
  );
  assert.equal(
    areConversationMessagesDuplicates(imported, row({ id: 3, botId: "bot-b" })),
    false
  );
  assert.equal(
    areConversationMessagesDuplicates(
      imported,
      row({ id: 4, conversationKey: "bot-a:private:另一位客户" })
    ),
    false
  );
});

test("missing or invalid timestamps prevent semantic matching", () => {
  const imported = row({ source: "worktool_customer_history" });
  assert.equal(
    areConversationMessagesDuplicates(imported, row({ id: 2, createdAt: "" })),
    false
  );
  assert.equal(
    areConversationMessagesDuplicates(imported, row({ id: 3, createdAt: "not-a-date" })),
    false
  );
});

test("dedupe prefers local then customer history", () => {
  const api = row({ id: 1, source: "worktool_api_history" });
  const customer = row({ id: 2, source: "worktool_customer_history" });
  const local = row({ id: 3, source: "local" });
  assert.deepEqual(
    dedupeConversationMessages([api, customer, local]).map((item) => item.id),
    [3]
  );
});

test("dedupe uses lower id for equivalent rows from the same imported source", () => {
  const laterId = row({ id: 8, source: "worktool_customer_history" });
  const earlierId = row({ id: 4, source: "worktool_customer_history" });
  assert.deepEqual(
    dedupeConversationMessages([laterId, earlierId]).map((item) => item.id),
    [4]
  );
});

test("dedupe preserves a requested evidence anchor", () => {
  const imported = row({ id: 10, source: "worktool_customer_history" });
  const local = row({ id: 11, source: "local" });
  assert.deepEqual(
    dedupeConversationMessages([imported, local], { preferredMessageId: 10 })
      .map((item) => item.id),
    [10]
  );
});

test("dedupe keeps original content and chronological order", () => {
  const older = row({
    id: 7,
    content: "  老师   在吗  ",
    source: "worktool_customer_history"
  });
  const newer = row({
    id: 9,
    content: "第二条",
    source: "worktool_customer_history",
    createdAt: "2026-07-25T15:23:00.000Z"
  });
  assert.deepEqual(
    dedupeConversationMessages([newer, older]).map((item) => item.content),
    ["  老师   在吗  ", "第二条"]
  );
});
