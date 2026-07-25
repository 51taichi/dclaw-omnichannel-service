# Legacy Customer History Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect first-contact legacy customers, import available WorkTool history, analyze configured tags at the final flow node, and show a gold legacy-customer badge on conversation cards.

**Architecture:** Keep WorkTool response parsing and bot-wide API-command caching outside `server.js`. Persist imported history with source-level idempotency, create legacy flow sessions at the last configured node, and inject a bounded legacy transcript into the existing DClaw request and tag-decision gateway. The synchronous path waits only for the per-contact customer-history endpoint; the unfilterable command-history endpoint refreshes in a separate bot-level worker.

**Tech Stack:** Node.js ES modules, Express 5, `node:sqlite` `DatabaseSync`, built-in `fetch`, built-in `node:test`, vanilla JavaScript/CSS console.

## Global Constraints

- Only private conversations can enter the legacy-customer path.
- A canonical new-friend greeting always uses the existing new-customer path.
- Empty, failed, or timed-out history still enters the final flow node and does not receive history-derived business tags.
- A legacy customer's first local persistence must skip the automatic `添加日期` tag because the real friend-added date is unknown.
- `/robot/wework/message` is a deprecated WorkTool endpoint and must remain isolated behind `src/worktool-history.js`.
- `/wework/listRawMessage` must never block an inbound customer reply.
- Imported history must be idempotent across duplicate callbacks, retries, and service restarts.
- Employee replies sent manually from the WeCom phone client are unavailable and are not reconstructed.
- The legacy badge text is `老客户`, appears beside the customer name, and uses the same `#f59e0b` gold family as human handoff without inheriting handoff pulse, card highlight, or sorting.
- No new runtime dependency is allowed.
- Preserve unrelated dirty-worktree changes and stage only files belonging to the current task.

---

## File Map

- Create `src/worktool-history.js`: WorkTool history HTTP adapter and response normalization.
- Create `src/legacy-history.js`: pure legacy-candidate, transcript-priority, and single-flight helpers.
- Create `src/worktool-history-cache.js`: background bot-level command-history refresh coordinator.
- Modify `src/worktool.js`: export the existing shared WorkTool request primitive.
- Modify `src/db.js`: schema migration, legacy session metadata, imported-message idempotency, and command cache.
- Modify `src/dclaw.js`: bounded legacy transcript in the normal Agent request.
- Modify `src/server.js`: legacy orchestration and cache-worker startup.
- Modify `public/console/index.html`: add the Lucide-compatible history symbol.
- Modify `public/console/app.js`: render legacy badge and status tooltip.
- Modify `public/console/styles.css`: compact gold badge using the handoff gold family.
- Create `tests/worktool-history.test.js`: adapter parsing, pagination, timeout, and source-key tests.
- Create `tests/db-legacy-history.test.js`: database migrations, idempotency, final-node session, and cache tests.
- Create `tests/legacy-history.test.js`: candidate detection and transcript bounding tests.
- Create `tests/worktool-history-cache.test.js`: command-cache refresh and single-flight tests.
- Modify `tests/dclaw-tags.test.js`: legacy transcript and history-tag prompt coverage.
- Create `tests/server-legacy-history-boundary.test.js`: inbound ordering and fallback integration boundaries.
- Create `tests/console-legacy-customer-boundary.test.js`: card markup and visual-state boundaries.

---

### Task 1: WorkTool History Adapter

**Files:**
- Create: `src/worktool-history.js`
- Modify: `src/worktool.js`
- Create: `tests/worktool-history.test.js`

**Interfaces:**
- Consumes: `requestWorkTool(path, options)` from `src/worktool.js`.
- Produces:
  - `listCustomerHistory({ robotId, title, startTime, endTime, pageSize, timeoutMs }): Promise<{ messages, titles, rawCount }>`
  - `listApiCommandPage({ robotId, page, pageSize, sort, timeoutMs }): Promise<{ items, pagination }>`
  - `normalizeCustomerHistoryRow(row): NormalizedHistoryMessage[]`
  - `normalizeApiCommandRow(row): NormalizedApiCommand[]`
  - `historySourceKey(message): string`
  - `normalizeWorktoolTimestamp(value): string`

- [ ] **Step 1: Write failing adapter tests**

Create `tests/worktool-history.test.js` with fetch stubs that verify:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  historySourceKey,
  listApiCommandPage,
  listCustomerHistory,
  normalizeApiCommandRow,
  normalizeCustomerHistoryRow,
  normalizeWorktoolTimestamp
} from "../src/worktool-history.js";

test("normalizes all readable customer history items", () => {
  const rows = normalizeCustomerHistoryRow({
    robotId: "bot_a",
    titleList: "魔兮-18570860666",
    sender: 0,
    type: 1,
    createTime: "2026-07-18 01:02:56",
    itemMsgList: JSON.stringify([
      { feature: 0, text: "1:02" },
      { feature: 2, text: "我是魔兮" }
    ])
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].content, "我是魔兮");
  assert.equal(rows[0].title, "魔兮-18570860666");
  assert.equal(rows[0].direction, "inbound");
});

test("history source keys are stable and content-sensitive", () => {
  const base = {
    robotId: "bot_a",
    title: "阿三",
    sender: 0,
    type: 1,
    createdAt: "2026-07-18 01:22:28",
    rawItems: '[{"feature":2,"text":"你们课程多少钱费用"}]'
  };
  assert.equal(historySourceKey(base), historySourceKey({ ...base }));
  assert.notEqual(historySourceKey(base), historySourceKey({ ...base, title: "其他人" }));
});

test("normalizes timezone-free WorkTool timestamps as Beijing time", () => {
  assert.equal(
    normalizeWorktoolTimestamp("2026-07-18 01:02:56"),
    "2026-07-17T17:02:56.000Z"
  );
  assert.equal(
    normalizeWorktoolTimestamp("2026-07-24T17:35:04"),
    "2026-07-24T09:35:04.000Z"
  );
});

test("paginates customer history and returns remark aliases", async () => {
  const originalFetch = globalThis.fetch;
  process.env.WORKTOOL_BASE_URL = "https://worktool.test";
  const requestedPages = [];
  globalThis.fetch = async (url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    requestedPages.push(page);
    return new Response(JSON.stringify({
      code: 200,
      data: {
        pageNum: page,
        pageSize: 1,
        totalPage: 2,
        total: 2,
        list: [{
          robotId: "bot_a",
          titleList: page === 1 ? "魔兮" : "魔兮-18570860666",
          sender: 0,
          type: 1,
          createTime: `2026-07-${page === 1 ? "10" : "18"} 11:00:00`,
          itemMsgList: JSON.stringify([{ feature: 2, text: page === 1 ? "在吗" : "你好" }])
        }]
      }
    }), { status: 200 });
  };
  try {
    const result = await listCustomerHistory({
      robotId: "bot_a",
      title: "魔兮",
      pageSize: 1
    });
    assert.deepEqual(requestedPages, [1, 2]);
    assert.deepEqual(result.titles, ["魔兮", "魔兮-18570860666"]);
    assert.equal(result.messages.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normalizes each target from one API command", () => {
  const commands = normalizeApiCommandRow({
    messageId: "2080",
    createTime: "2026-07-24T17:35:04",
    body: JSON.stringify({
      list: [{
        type: 203,
        titleList: ["阿三", "魔兮"],
        receivedContent: "在吗"
      }]
    })
  });
  assert.deepEqual(commands.map((item) => item.targetName), ["阿三", "魔兮"]);
  assert.equal(commands[0].content, "在吗");
});

test("rejects WorkTool business errors and aborts timed out requests", async () => {
  const originalFetch = globalThis.fetch;
  process.env.WORKTOOL_BASE_URL = "https://worktool.test";
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ code: 500, message: "失败" }), { status: 200 });
    await assert.rejects(
      listCustomerHistory({ robotId: "bot_a", title: "阿三" }),
      /WorkTool business error: 500 失败/
    );

    globalThis.fetch = async (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError"))
        );
      });
    await assert.rejects(
      listApiCommandPage({ robotId: "bot_a", timeoutMs: 5 }),
      /AbortError|aborted/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

Use complete stub payloads for page 1/page 2 rather than reading live WorkTool data.

- [ ] **Step 2: Run the adapter test and verify failure**

Run:

```bash
node --test tests/worktool-history.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/worktool-history.js`.

- [ ] **Step 3: Export the shared WorkTool request primitive**

Change `src/worktool.js`:

```js
export async function requestWorkTool(path, { robotId, timeoutMs = 0, ...options } = {}) {
  const url = new URL(`${getBaseUrl()}${path}`);
  url.searchParams.set("robotId", getRobotId(robotId));
  const signal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : options.signal;
  const response = await fetch(url, {
    ...options,
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const detail = typeof data === "object" ? JSON.stringify(data) : String(data);
    throw new Error(`WorkTool request failed: ${response.status} ${detail}`);
  }
  return data;
}
```

Existing callers continue to use the function unchanged.

- [ ] **Step 4: Implement `src/worktool-history.js`**

Use `node:crypto` SHA-256 for source keys. Normalize only readable content:

```js
import crypto from "node:crypto";
import { requestWorkTool } from "./worktool.js";

const DEFAULT_HISTORY_START = "2020-01-01 00:00:00";
const DEFAULT_TIMEOUT_MS = 8_000;

export function historySourceKey(message) {
  return crypto.createHash("sha256").update(JSON.stringify([
    message.robotId,
    message.title,
    Number(message.sender),
    Number(message.type),
    message.createdAt,
    message.rawItems
  ])).digest("hex");
}

export function normalizeCustomerHistoryRow(row) {
  let items;
  try {
    items = JSON.parse(row.itemMsgList || "[]");
  } catch {
    return [];
  }
  const content = items
    .filter((item) => Number(item?.feature) !== 0)
    .map((item) => String(item?.text || "").trim())
    .filter(Boolean)
    .join("\n");
  if (!content) return [];
  const message = {
    robotId: String(row.robotId || ""),
    title: String(row.titleList || "").trim(),
    sender: Number(row.sender || 0),
    type: Number(row.type || 0),
    direction: Number(row.sender || 0) === 0 ? "inbound" : "outbound",
    content,
    createdAt: String(row.createTime || ""),
    rawItems: String(row.itemMsgList || "[]"),
    rawPayload: row
  };
  return [{ ...message, sourceKey: historySourceKey(message) }];
}
```

`listCustomerHistory` requests pages with `sort=create_time,asc`, validates `code === 200 || code === 0`, stops at `totalPage`, flattens normalized messages, and returns a unique title list.

`normalizeApiCommandRow` parses `body.list`, emits one normalized item per `titleList` target, uses `(messageId, commandIndex, targetName)` as identity fields, and extracts `receivedContent` or `extraText`.

`normalizeWorktoolTimestamp` parses WorkTool's timezone-free
`YYYY-MM-DD HH:mm:ss` and `YYYY-MM-DDTHH:mm:ss` values as Asia/Shanghai
(`UTC+08:00`) and returns UTC ISO strings. Invalid timestamps make the row
unreadable instead of falling back to the current time.

- [ ] **Step 5: Run adapter tests**

Run:

```bash
node --test tests/worktool-history.test.js tests/worktool-callbacks.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit adapter work**

```bash
git add src/worktool.js src/worktool-history.js tests/worktool-history.test.js
git commit -m "Add WorkTool history adapter"
```

---

### Task 2: Legacy History Database Model

**Files:**
- Modify: `src/db.js`
- Create: `tests/db-legacy-history.test.js`

**Interfaces:**
- Consumes: normalized messages from Task 1.
- Produces:
  - `createLegacyFlowSession({ botId, conversationKey, machine }): FlowSession`
  - `updateLegacyHistorySync({ botId, conversationKey, status, importedCount, errorMessage }): FlowSession`
  - `markLegacyHistoryContextSent({ botId, conversationKey }): FlowSession`
  - `insertImportedConversationMessages({ botId, conversationKey, source, messages }): number`
  - `listImportedConversationMessages({ botId, conversationKey }): ConversationMessage[]`
  - `upsertWorktoolApiMessageCache({ botId, items }): number`
  - `listCachedApiMessages({ botId, targetNames }): CachedApiMessage[]`
  - `hasCachedWorktoolMessageId({ botId, messageId }): boolean`
  - `listLegacyFlowSessionTargets({ botId }): Array<{ conversationKey, receivedName }>`

- [ ] **Step 1: Write failing database tests**

Create a temporary `DATA_DIR` before dynamically importing `src/db.js`. Cover:

```js
test("creates legacy flow session at the last valid node", () => {
  const session = createLegacyFlowSession({
    botId: "bot_legacy",
    conversationKey: "bot_legacy:private:阿三",
    machine: {
      entryNodeId: "node_1",
      config: { nodes: [{ id: "node_1" }, { id: "node_2" }, { id: "" }] }
    }
  });
  assert.equal(session.currentNodeId, "node_2");
  assert.equal(session.customerOrigin, "legacy");
  assert.equal(session.historySyncStatus, "loading");
});

test("imports the same WorkTool history once", () => {
  const message = {
    sourceKey: "stable-key",
    direction: "inbound",
    senderName: "阿三",
    content: "我刚刚已经付费了",
    createdAt: "2026-07-18 02:33:48",
    rawPayload: { type: 1 }
  };
  assert.equal(insertImportedConversationMessages({
    botId: "bot_legacy",
    conversationKey: "bot_legacy:private:阿三",
    source: "worktool_customer_history",
    messages: [message, message]
  }), 1);
});

test("new imported history reopens one-time Agent context delivery", () => {
  const botId = "bot_context";
  const conversationKey = `${botId}:private:阿三`;
  createLegacyFlowSession({
    botId,
    conversationKey,
    machine: { config: { nodes: [{ id: "final" }] } }
  });
  markLegacyHistoryContextSent({ botId, conversationKey });
  assert.ok(getFlowSessionForBot({ botId, conversationKey }).historyContextSentAt);
  insertImportedConversationMessages({
    botId,
    conversationKey,
    source: "worktool_customer_history",
    messages: [{
      sourceKey: "older",
      direction: "inbound",
      senderName: "阿三",
      content: "旧消息",
      createdAt: "2026-07-17T17:22:28.000Z",
      rawPayload: {}
    }]
  });
  assert.equal(getFlowSessionForBot({ botId, conversationKey }).historyContextSentAt, "");
});

test("stores and queries cached API commands by aliases", () => {
  upsertWorktoolApiMessageCache({
    botId: "bot_legacy",
    items: [
      { messageId: "m1", commandIndex: 0, targetName: "魔兮", type: 203, content: "在吗", createdAt: "2026-07-02T16:02:18", rawPayload: {} },
      { messageId: "m2", commandIndex: 0, targetName: "魔兮-18570860666", type: 203, content: "你好", createdAt: "2026-07-18T01:03:00", rawPayload: {} }
    ]
  });
  assert.equal(listCachedApiMessages({
    botId: "bot_legacy",
    targetNames: ["魔兮", "魔兮-18570860666"]
  }).length, 2);
});

test("lists only private legacy sessions for cache reconciliation", () => {
  const botId = "bot_reconcile";
  upsertConversation({
    botId,
    agentId: "agent_reconcile",
    conversationKey: `${botId}:private:阿三`,
    message: { roomType: 2, receivedName: "阿三" }
  });
  createLegacyFlowSession({
    botId,
    conversationKey: `${botId}:private:阿三`,
    machine: { config: { nodes: [{ id: "final" }] } }
  });
  assert.deepEqual(listLegacyFlowSessionTargets({ botId }), [{
    conversationKey: `${botId}:private:阿三`,
    receivedName: "阿三"
  }]);
});

test("legacy persistence can skip the first-seen date tag", () => {
  const botId = "bot_legacy_date";
  const agentId = "agent_legacy_date";
  const conversationKey = `${botId}:private:老客户`;
  upsertAgentTagSchema({
    agentId,
    schema: { dateTag: { enabled: true }, groups: [] }
  });
  upsertConversation({
    botId,
    agentId,
    conversationKey,
    message: { roomType: 2, receivedName: "老客户" },
    skipFirstSeenDateTag: true
  });
  assert.deepEqual(
    listConversationTags({ botId, agentId, conversationKey })
      .filter((tag) => tag.tagType === "date"),
    []
  );
});

test("friend-added reset removes the legacy origin", () => {
  const botId = "bot_readd";
  const agentId = "agent_readd";
  const conversationKey = `${botId}:private:阿三`;
  upsertConversation({
    botId,
    agentId,
    conversationKey,
    message: { roomType: 2, receivedName: "阿三" }
  });
  createLegacyFlowSession({
    botId,
    conversationKey,
    machine: { config: { nodes: [{ id: "final" }] } }
  });
  resetConversationForFriendGreeting({ botId, agentId, conversationKey });
  const session = getFlowSessionForBot({ botId, conversationKey });
  assert.equal(session.customerOrigin, "new");
  assert.equal(session.historySyncStatus, "not_required");
  assert.equal(session.historyImportedCount, 0);
});
```

- [ ] **Step 2: Run the database test and verify failure**

Run:

```bash
node --test tests/db-legacy-history.test.js
```

Expected: FAIL because the new database functions and columns do not exist.

- [ ] **Step 3: Add schema and backward-compatible migrations**

Extend `flow_sessions` and `conversation_messages`, then add:

```sql
CREATE TABLE IF NOT EXISTS worktool_api_message_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  command_index INTEGER NOT NULL,
  target_name TEXT NOT NULL,
  message_type INTEGER NOT NULL,
  content TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  raw_payload_json TEXT NOT NULL,
  cached_at TEXT NOT NULL,
  UNIQUE(bot_id, message_id, command_index, target_name)
);

CREATE INDEX IF NOT EXISTS idx_worktool_api_cache_target
ON worktool_api_message_cache (bot_id, target_name, occurred_at);
```

Use existing `ensureColumn` calls:

```js
ensureColumn("flow_sessions", "customer_origin", "TEXT NOT NULL DEFAULT 'unknown'");
ensureColumn("flow_sessions", "history_sync_status", "TEXT NOT NULL DEFAULT 'not_required'");
ensureColumn("flow_sessions", "history_imported_count", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("flow_sessions", "history_synced_at", "TEXT");
ensureColumn("flow_sessions", "history_sync_error", "TEXT");
ensureColumn("flow_sessions", "history_context_sent_at", "TEXT");
ensureColumn("conversation_messages", "source", "TEXT NOT NULL DEFAULT 'local'");
ensureColumn("conversation_messages", "source_key", "TEXT");
```

Create a partial unique index for non-empty imported keys.

- [ ] **Step 4: Map new fields and implement database functions**

Update `rowToFlowSession`:

```js
customerOrigin: row.customer_origin || "unknown",
historySyncStatus: row.history_sync_status || "not_required",
historyImportedCount: Number(row.history_imported_count || 0),
historySyncedAt: row.history_synced_at || "",
historySyncError: row.history_sync_error || "",
historyContextSentAt: row.history_context_sent_at || ""
```

Update `rowToConversationMessage` with `source` and `sourceKey`.

`createLegacyFlowSession` filters `machine.config.nodes` to nodes with non-empty IDs, selects the last ID, and uses one transaction to insert or update the session metadata. It must not schedule node activation.

`insertImportedConversationMessages` uses `INSERT OR IGNORE`, preserves each WorkTool `createdAt`, and returns `changes`.

`updateLegacyHistorySync` accepts only `success`, `empty`, and `failed`, truncates the stored error to 500 characters, and updates `history_synced_at`.

`markLegacyHistoryContextSent` writes `history_context_sent_at` only after a
successful Agent invocation. Importing any new `worktool_customer_history` or
`worktool_api_history` row clears `history_context_sent_at`, so newly available
history is included once on the next customer message.

Change `listConversationMessages` ordering to
`ORDER BY created_at ASC, id ASC` so history imported after the triggering
message still appears in chronological order.

`listLegacyFlowSessionTargets` joins `flow_sessions` to `conversations`, filters
`customer_origin = 'legacy'` and private conversation keys, and returns the
current `received_name`. Additional aliases come from imported customer
history rows during cache reconciliation.

Extend `upsertConversation` with `skipFirstSeenDateTag = false`. Call
`syncConversationFirstSeenDateTag` only when the flag is false; every existing
caller retains current behavior.

- [ ] **Step 5: Keep friend-added and reset semantics explicit**

In `resetConversationForFriendGreeting`, set:

```sql
customer_origin = 'new',
history_sync_status = 'not_required',
history_imported_count = 0,
history_synced_at = NULL,
history_sync_error = NULL,
history_context_sent_at = NULL
```

Do not mark existing migrated sessions as legacy.

- [ ] **Step 6: Run database tests**

Run:

```bash
node --test tests/db-legacy-history.test.js tests/db-friend-added-reentry.test.js tests/db-bot-isolation.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit database work**

```bash
git add src/db.js tests/db-legacy-history.test.js
git commit -m "Persist legacy customer history state"
```

---

### Task 3: Legacy Candidate and Transcript Policy

**Files:**
- Create: `src/legacy-history.js`
- Create: `tests/legacy-history.test.js`

**Interfaces:**
- Consumes: WorkTool-normalized and database message objects.
- Produces:
  - `isLegacyCustomerCandidate({ message, binding, hadConversation, hadFlowSession }): boolean`
  - `createKeyedSingleFlight(): { run(key, task), has(key) }`
  - `buildLegacyHistoryContext({ customerMessages, localMessages, cachedApiMessages, maxMessages, maxChars }): LegacyHistoryContext`

- [ ] **Step 1: Write failing policy tests**

Cover exact candidate and prioritization behavior:

```js
test("only a first ordinary private message is a legacy candidate", () => {
  const base = {
    binding: { enabled: true },
    hadConversation: false,
    hadFlowSession: false
  };
  assert.equal(isLegacyCustomerCandidate({
    ...base,
    message: { roomType: 2, textType: 1, spoken: "在吗" }
  }), true);
  assert.equal(isLegacyCustomerCandidate({
    ...base,
    message: { roomType: 2, textType: 1, spoken: "我已经添加了你，现在我们可以开始聊天了" }
  }), false);
  assert.equal(isLegacyCustomerCandidate({
    ...base,
    message: { roomType: 1, textType: 1, spoken: "在吗" }
  }), false);
  assert.equal(isLegacyCustomerCandidate({
    ...base,
    hadConversation: true,
    message: { roomType: 2, textType: 1, spoken: "在吗" }
  }), false);
});

test("single flight shares one history task per conversation", async () => {
  const flight = createKeyedSingleFlight();
  let calls = 0;
  const task = () => {
    calls += 1;
    return Promise.resolve({ status: "success" });
  };
  const [a, b] = await Promise.all([flight.run("conversation", task), flight.run("conversation", task)]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
});

test("bounded context keeps current and customer messages before old API sends", () => {
  const context = buildLegacyHistoryContext({
    customerMessages: [
      { direction: "inbound", content: "客户旧问题", createdAt: "2026-07-10 11:00:00" },
      { direction: "inbound", content: "客户最新问题", createdAt: "2026-07-18 01:00:00" }
    ],
    localMessages: [{ direction: "outbound", content: "最近回复", createdAt: "2026-07-18 01:01:00" }],
    cachedApiMessages: Array.from({ length: 100 }, (_, index) => ({
      direction: "outbound",
      content: `旧发送${index}`,
      createdAt: `2026-07-01 00:${String(index % 60).padStart(2, "0")}:00`
    })),
    maxMessages: 3,
    maxChars: 10_000
  });
  assert.deepEqual(context.messages.map((item) => item.content), [
    "客户旧问题",
    "客户最新问题",
    "最近回复"
  ]);
});
```

- [ ] **Step 2: Run the policy test and verify failure**

Run:

```bash
node --test tests/legacy-history.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement candidate and keyed single-flight helpers**

Reuse `isSystemFriendGreeting` from `src/message-rules.js`. `createKeyedSingleFlight` stores the task promise before invoking await and removes it in `finally`.

- [ ] **Step 4: Implement deterministic transcript bounding**

Use defaults `maxMessages = 200` and `maxChars = 30_000`. Normalize each message to:

```js
{
  direction: "inbound" | "outbound",
  senderName: "",
  content: "",
  createdAt: "",
  source: ""
}
```

Deduplicate by `(direction, createdAt, content)`. Select messages by priority:

1. all customer-history messages, newest first while fitting;
2. local conversation messages, newest first while fitting;
3. cached API sends, newest first while fitting;
4. return the selected set sorted chronologically.

Return:

```js
{
  messages,
  importedCustomerCount: customerMessages.length,
  includedCount: messages.length,
  truncated: includedCount < uniqueInputCount
}
```

- [ ] **Step 5: Run policy tests**

Run:

```bash
node --test tests/legacy-history.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit policy work**

```bash
git add src/legacy-history.js tests/legacy-history.test.js
git commit -m "Add legacy history selection policy"
```

---

### Task 4: Bot-Level API Command Cache Worker

**Files:**
- Create: `src/worktool-history-cache.js`
- Create: `tests/worktool-history-cache.test.js`

**Interfaces:**
- Consumes:
  - `listApiCommandPage` from Task 1.
  - cache database APIs from Task 2.
  - `createKeyedSingleFlight` from Task 3.
- Produces:
  - `createWorktoolHistoryCache({ listPage, upsertItems, hasMessageId, onRefreshed, pageSize }): { refreshBot }`
  - `refreshBot({ robotId }): Promise<{ fetched, inserted, stoppedAtKnown }>`

- [ ] **Step 1: Write failing cache tests**

Create injected fake dependencies:

```js
test("refreshes newest pages and stops at the first known message id", async () => {
  const pages = [];
  const cache = createWorktoolHistoryCache({
    pageSize: 2,
    listPage: async ({ page }) => {
      pages.push(page);
      if (page === 1) return {
        items: [
          { messageId: "new-2", commandIndex: 0, targetName: "阿三" },
          { messageId: "new-1", commandIndex: 0, targetName: "阿三" }
        ],
        pagination: { pageNum: 1, totalPage: 2 }
      };
      return {
        items: [{ messageId: "known", commandIndex: 0, targetName: "阿三" }],
        pagination: { pageNum: 2, totalPage: 2 }
      };
    },
    hasMessageId: ({ messageId }) => messageId === "known",
    upsertItems: ({ items }) => items.length
  });
  const result = await cache.refreshBot({ robotId: "bot_a" });
  assert.deepEqual(pages, [1, 2]);
  assert.equal(result.stoppedAtKnown, true);
});

test("shares one refresh per bot and releases the lock after failure", async () => {
  let calls = 0;
  let rejectFirst;
  const firstFailure = new Promise((_resolve, reject) => {
    rejectFirst = reject;
  });
  const cache = createWorktoolHistoryCache({
    listPage: async () => {
      calls += 1;
      if (calls === 1) return firstFailure;
      return { items: [], pagination: { pageNum: 1, totalPage: 1 } };
    },
    hasMessageId: () => false,
    upsertItems: () => 0
  });
  const first = cache.refreshBot({ robotId: "bot_a" });
  const shared = cache.refreshBot({ robotId: "bot_a" });
  rejectFirst(new Error("temporary failure"));
  await assert.rejects(first, /temporary failure/);
  await assert.rejects(shared, /temporary failure/);
  assert.equal(calls, 1);
  await cache.refreshBot({ robotId: "bot_a" });
  assert.equal(calls, 2);
});

test("runs reconciliation after cached pages are committed", async () => {
  const events = [];
  const cache = createWorktoolHistoryCache({
    listPage: async () => ({
      items: [{ messageId: "m1", commandIndex: 0, targetName: "阿三" }],
      pagination: { pageNum: 1, totalPage: 1 }
    }),
    hasMessageId: () => false,
    upsertItems: ({ items }) => {
      events.push(`stored:${items.length}`);
      return items.length;
    },
    onRefreshed: async ({ robotId }) => {
      events.push(`reconciled:${robotId}`);
    }
  });
  await cache.refreshBot({ robotId: "bot_a" });
  assert.deepEqual(events, ["stored:1", "reconciled:bot_a"]);
});
```

- [ ] **Step 2: Run the cache test and verify failure**

Run:

```bash
node --test tests/worktool-history-cache.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the injected cache coordinator**

`refreshBot` uses `sort=create_time,desc`, collects only unseen rows, writes each completed page, stops at a known message ID, invokes `onRefreshed({ robotId })` after all writes succeed, and returns structured counts. It never logs or swallows errors; `server.js` owns logging and retry scheduling.

- [ ] **Step 4: Run cache tests**

Run:

```bash
node --test tests/worktool-history-cache.test.js tests/worktool-history.test.js tests/db-legacy-history.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit cache worker**

```bash
git add src/worktool-history-cache.js tests/worktool-history-cache.test.js
git commit -m "Cache WorkTool API message history"
```

---

### Task 5: DClaw Legacy Transcript and Tag Analysis

**Files:**
- Modify: `src/dclaw.js`
- Modify: `tests/dclaw-tags.test.js`

**Interfaces:**
- Consumes: `LegacyHistoryContext` from Task 3.
- Produces: `buildDclawRequest({ ..., legacyHistoryContext })` with `metadata.legacyHistory`.

- [ ] **Step 1: Add failing DClaw request tests**

Add to `tests/dclaw-tags.test.js`:

```js
test("buildDclawRequest gives legacy history to reply and tag analysis", () => {
  const request = buildDclawRequest({
    binding,
    conversation,
    message,
    flow: {
      machine: { nodes: [{ id: "final" }] },
      currentNode: { id: "final", name: "持续服务", goal: "基于历史继续交流" },
      session: { currentNodeId: "final", customerOrigin: "legacy" }
    },
    tagContext: {
      groups: [{ id: "intent", tags: [{ id: "paid", name: "已付费", condition: "客户明确已经付费" }] }],
      currentTags: []
    },
    legacyHistoryContext: {
      messages: [{
        direction: "inbound",
        senderName: "阿三",
        content: "我刚刚已经付费了",
        createdAt: "2026-07-18 02:33:48",
        source: "worktool_customer_history"
      }],
      importedCustomerCount: 62,
      includedCount: 1,
      truncated: true
    }
  });
  assert.equal(request.metadata.legacyHistory.importedCustomerCount, 62);
  assert.match(request.message, /老客户历史上下文/);
  assert.match(request.message, /我刚刚已经付费了/);
  assert.match(request.message, /结合历史记录和当前表达判断标签/);
});

test("empty legacy history is represented without claiming history evidence", () => {
  const request = buildDclawRequest({
    binding,
    conversation,
    message,
    tagContext: null,
    legacyHistoryContext: {
      messages: [],
      importedCustomerCount: 0,
      includedCount: 0,
      truncated: false
    }
  });
  assert.equal(request.metadata.legacyHistory, null);
  assert.doesNotMatch(request.message, /结合历史记录和当前表达判断标签/);
});
```

- [ ] **Step 2: Run DClaw tests and verify failure**

Run:

```bash
node --test tests/dclaw-tags.test.js
```

Expected: FAIL because `legacyHistoryContext` is not included.

- [ ] **Step 3: Extend `buildDclawRequest`**

Add the optional parameter and payload:

```js
const legacyHistory = legacyHistoryContext?.messages?.length
  ? {
      customerOrigin: "legacy",
      messages: legacyHistoryContext.messages,
      importedCustomerCount: legacyHistoryContext.importedCustomerCount,
      includedCount: legacyHistoryContext.includedCount,
      truncated: Boolean(legacyHistoryContext.truncated)
    }
  : null;
```

When present, add instructions:

```js
"这是老客户首次接入本系统，legacyHistory 包含可获得的历史记录。",
"先结合历史上下文回应客户当前问题，再围绕当前最后任务节点继续交流；不要重新执行新客户开场流程。",
"标签判断必须结合 legacyHistory 中的客户表达和当前表达，不能把系统发送内容当成客户意图证据。"
```

Include `legacyHistory` in the JSON message payload and `metadata`.

- [ ] **Step 4: Run DClaw tests**

Run:

```bash
node --test tests/dclaw-tags.test.js tests/dclaw-request-sanitization.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit DClaw work**

```bash
git add src/dclaw.js tests/dclaw-tags.test.js
git commit -m "Include legacy history in agent requests"
```

---

### Task 6: Inbound Legacy Customer Orchestration

**Files:**
- Create: `src/legacy-customer-history.js`
- Modify: `src/server.js`
- Create: `tests/server-legacy-history-boundary.test.js`

**Interfaces:**
- Consumes all interfaces from Tasks 1-5.
- Produces:
  - `createLegacyCustomerHistoryService(dependencies)`
  - `prepareLegacyCustomer({ botId, binding, conversationKey, message, machine }): Promise<{ session, historyStatus }>`
  - `buildStoredLegacyContext({ botId, conversationKey, targetNames }): LegacyHistoryContext | null`
  - `backfillCachedHistoryForBot({ botId }): Promise<{ conversations, inserted }>`

- [ ] **Step 1: Write failing orchestration module tests**

Use injected dependencies so no real WorkTool or SQLite calls occur:

```js
test("imports history once and marks success", async () => {
  const calls = { history: 0, imported: 0 };
  const service = createLegacyCustomerHistoryService({
    createLegacySession: () => ({ customerOrigin: "legacy", historySyncStatus: "loading" }),
    listCustomerHistory: async () => {
      calls.history += 1;
      return {
        messages: [{ sourceKey: "k1", content: "我已经付费", title: "阿三" }],
        titles: ["阿三"],
        rawCount: 1
      };
    },
    insertImportedMessages: ({ messages }) => {
      calls.imported += messages.length;
      return messages.length;
    },
    updateHistorySync: ({ status, importedCount }) => ({ historySyncStatus: status, historyImportedCount: importedCount }),
    listLocalMessages: () => [],
    listCachedApiMessages: () => []
  });
  const [first, second] = await Promise.all([
    service.prepareLegacyCustomer({ botId: "bot", conversationKey: "bot:private:阿三", message: { receivedName: "阿三" }, machine: { config: { nodes: [{ id: "final" }] } } }),
    service.prepareLegacyCustomer({ botId: "bot", conversationKey: "bot:private:阿三", message: { receivedName: "阿三" }, machine: { config: { nodes: [{ id: "final" }] } } })
  ]);
  assert.equal(calls.history, 1);
  assert.equal(calls.imported, 1);
  assert.equal(first.historyStatus, "success");
  assert.equal(second.historyStatus, "success");
});

test("empty and failed history still create a legacy final-node session", async () => {
  const statuses = [];
  const makeService = (listCustomerHistory) => createLegacyCustomerHistoryService({
    createLegacySession: () => ({ customerOrigin: "legacy", currentNodeId: "final" }),
    listCustomerHistory,
    insertImportedMessages: () => 0,
    updateHistorySync: ({ status }) => {
      statuses.push(status);
      return { historySyncStatus: status };
    },
    listLocalMessages: () => [],
    listCachedApiMessages: () => []
  });
  const empty = await makeService(async () => ({
    messages: [],
    titles: ["阿三"],
    rawCount: 0
  })).prepareLegacyCustomer({
    botId: "bot",
    conversationKey: "bot:private:阿三",
    message: { receivedName: "阿三" },
    machine: { config: { nodes: [{ id: "final" }] } }
  });
  const failed = await makeService(async () => {
    throw new Error("timeout");
  }).prepareLegacyCustomer({
    botId: "bot",
    conversationKey: "bot:private:魔兮",
    message: { receivedName: "魔兮" },
    machine: { config: { nodes: [{ id: "final" }] } }
  });
  assert.equal(empty.historyStatus, "empty");
  assert.equal(failed.historyStatus, "failed");
  assert.deepEqual(statuses, ["empty", "failed"]);
});
```

- [ ] **Step 2: Add failing server ordering boundary tests**

Create `tests/server-legacy-history-boundary.test.js`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

function functionBody(name, nextName) {
  const start = source.indexOf(`async function ${name}`);
  assert.notEqual(start, -1);
  const end = source.indexOf(`async function ${nextName}`, start + 1);
  assert.notEqual(end, -1);
  return source.slice(start, end);
}

test("captures pre-persistence state and prepares legacy history before flow creation", () => {
  const body = functionBody("processIncomingMessage", "processCoalescedIncomingBatch");
  const hadConversation = body.indexOf("const hadLocalConversation");
  const hadFlow = body.indexOf("const hadFlowSession");
  const persist = body.indexOf("persistInboundConversation");
  const friendGreeting = body.indexOf("isSystemFriendGreeting(message)");
  const prepare = body.indexOf("prepareLegacyCustomer");
  const buildFlow = body.indexOf("buildFlowContext");
  assert.ok(hadConversation >= 0 && hadConversation < persist);
  assert.ok(hadFlow >= 0 && hadFlow < persist);
  assert.ok(friendGreeting >= 0 && friendGreeting < prepare);
  assert.ok(prepare >= 0 && prepare < buildFlow);
  assert.match(body, /skipFirstSeenDateTag:\s*legacyCandidate/);
  assert.doesNotMatch(body, /refreshBot\(/);
});

test("coalesced agent request receives bounded legacy history and success-gated tags", () => {
  const start = source.indexOf("async function processCoalescedIncomingBatch");
  const end = source.indexOf("function applyManualConversationTagChange", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);
  assert.match(body, /historySyncStatus === "success"/);
  assert.match(body, /historyContextSentAt/);
  assert.match(body, /legacyHistoryContext/);
  assert.match(body, /buildDclawRequest\(\{[\s\S]*legacyHistoryContext/);
  assert.match(body, /markLegacyHistoryContextSent/);
  assert.doesNotMatch(body, /refreshBot\(/);
});

test("flow-session list omits stored history errors", () => {
  const start = source.indexOf('"/api/flow-sessions"');
  const end = source.indexOf('"/api/flow-sessions/:conversationKey"', start);
  const route = source.slice(start, end);
  assert.match(route, /historySyncError/);
  assert.match(route, /publicSession/);
});
```

- [ ] **Step 3: Run orchestration tests and verify failure**

Run:

```bash
node --test tests/server-legacy-history-boundary.test.js
```

Expected: FAIL because the service and server integration do not exist.

- [ ] **Step 4: Implement `src/legacy-customer-history.js`**

Use `createKeyedSingleFlight`. `prepareLegacyCustomer` must:

1. create/update the legacy session at the last node;
2. query customer history with the current `receivedName`;
3. import normalized messages with source `worktool_customer_history`;
4. use `[receivedName, ...history.titles]` as the alias set;
5. read local sends and cached API sends;
6. import cached sends with source `worktool_api_history`;
7. update `success`, `empty`, or `failed`;
8. resolve on failures instead of throwing into the message path.

Return only safe status data; log details through injected `logInfo`/`logWarn`.

`backfillCachedHistoryForBot`:

1. reads `listLegacyFlowSessionTargets({ botId })`;
2. loads imported customer-history rows for each conversation;
3. derives aliases from each `rawPayload.title` plus the current `receivedName`;
4. reads all matching cached API messages;
5. imports them with source `worktool_api_history`;
6. returns aggregate conversation and insert counts.

- [ ] **Step 5: Integrate candidate detection before flow creation**

In `processIncomingMessage`, capture and classify before persistence:

```js
const hadLocalConversation = Boolean(getConversation(conversationKey));
const hadFlowSession = Boolean(getFlowSession(conversationKey));
const legacyCandidate = isLegacyCustomerCandidate({
  message,
  binding,
  hadConversation: hadLocalConversation,
  hadFlowSession
});
```

Pass the classification into persistence:

```js
persistInboundConversation({
  botId,
  binding,
  conversationKey,
  message,
  skipFirstSeenDateTag: legacyCandidate
});
```

Extend `persistInboundConversation` to forward this flag to
`upsertConversation`.

After binding checks and before `buildFlowContext`:

```js
if (legacyCandidate) {
  await legacyCustomerHistory.prepareLegacyCustomer({
    botId,
    binding,
    conversationKey,
    message,
    machine: getFlowMachineForBot(botId)
  });
}
```

The canonical friend greeting branch remains earlier and unchanged.

- [ ] **Step 6: Build the legacy context in the coalesced Agent path**

After loading the session:

```js
const legacyHistoryContext =
  flow?.session?.customerOrigin === "legacy" &&
  flow.session.historySyncStatus === "success" &&
  !flow.session.historyContextSentAt
    ? legacyCustomerHistory.buildStoredLegacyContext({
        botId,
        conversationKey,
        targetNames: [conversation.receivedName]
      })
    : null;
const tagContext =
  flow?.session?.customerOrigin === "legacy" &&
  flow.session.historySyncStatus !== "success"
    ? null
    : buildTagContext({ binding, conversationKey });
```

Pass `legacyHistoryContext` to `buildDclawRequest`.
After the normal Agent invocation has passed response validation and finished
successfully, call `markLegacyHistoryContextSent` when
`legacyHistoryContext` was non-null. Do not mark it on Agent failure, format
failure, or validation failure; the next customer message must retry delivery.

- [ ] **Step 7: Start the background command-cache worker**

Instantiate `createWorktoolHistoryCache` once. At service startup:

- trigger a non-awaited refresh for each enabled Bot binding;
- run a 10-minute unref'd interval;
- catch and log per-Bot failures;
- never await cache refresh from an incoming message.

Reuse `listBotBindings()` and filter enabled bindings with non-empty Bot IDs.
Pass `legacyCustomerHistory.backfillCachedHistoryForBot` as `onRefreshed` so a
successful background cache refresh immediately reconciles previously
identified legacy conversations.

- [ ] **Step 8: Keep raw sync errors out of the ordinary session API**

Before spreading each session into the `/api/flow-sessions` response:

```js
const sessions = page.items.map((session) => {
  const { historySyncError, ...publicSession } = session;
  return {
    ...publicSession,
    ...(binding
      ? {
          tags: listConversationTags({
            botId,
            agentId: binding.agentId,
            conversationKey: session.conversationKey
          })
        }
      : { tags: [] })
  };
});
```

- [ ] **Step 9: Run targeted server tests**

Run:

```bash
node --test \
  tests/server-legacy-history-boundary.test.js \
  tests/server-inbound-coalescing-boundary.test.js \
  tests/server-tags-boundary.test.js \
  tests/db-friend-added-reentry.test.js
```

Expected: PASS.

- [ ] **Step 10: Commit server orchestration**

```bash
git add src/legacy-customer-history.js src/server.js tests/server-legacy-history-boundary.test.js
git commit -m "Load history for legacy customers"
```

---

### Task 7: Gold Legacy Customer Badge

**Files:**
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Create: `tests/console-legacy-customer-boundary.test.js`

**Interfaces:**
- Consumes session fields returned by `listFlowSessionsPage`:
  - `customerOrigin`
  - `historySyncStatus`
  - `historyImportedCount`
  - `historySyncedAt`
- Produces: `.legacy-customer-badge` beside `.flow-session-name`.

- [ ] **Step 1: Write failing console boundary tests**

Create:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("legacy private sessions render a named history badge beside the customer", () => {
  assert.equal(html.includes('id="icon-history"'), true);
  assert.match(app, /sessionType === "private" && session\\.customerOrigin === "legacy"/);
  assert.match(app, /class="legacy-customer-badge"/);
  assert.match(app, />老客户</);
  assert.match(app, /historySyncStatus/);
  assert.match(app, /已加载历史记录 \\$\\{session\\.historyImportedCount/);
});

test("legacy badge reuses gold without handoff card behavior", () => {
  assert.match(css, /\\.legacy-customer-badge\\s*\\{[\\s\\S]*#f59e0b/);
  assert.doesNotMatch(css, /\\.legacy-customer-badge\\s*\\{[\\s\\S]*animation:/);
  assert.doesNotMatch(app, /customerOrigin === "legacy"[\\s\\S]*is-handoff/);
});

test("mobile keeps the 老客户 text visible", () => {
  assert.doesNotMatch(css, /@media[^}]*\\.legacy-customer-badge[^}]*display:\\s*none/s);
  assert.doesNotMatch(css, /\\.legacy-customer-badge[^}]*font-size:\\s*0/);
});
```

- [ ] **Step 2: Run console test and verify failure**

Run:

```bash
node --test tests/console-legacy-customer-boundary.test.js
```

Expected: FAIL because the icon and badge are absent.

- [ ] **Step 3: Add history icon symbol**

Add a Lucide-compatible symbol to `public/console/index.html`:

```html
<symbol id="icon-history" viewBox="0 0 24 24">
  <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
  <path d="M3 3v5h5" />
  <path d="M12 7v5l4 2" />
</symbol>
```

- [ ] **Step 4: Render badge and exact tooltips**

Add a helper in `public/console/app.js`:

```js
function legacyCustomerTooltip(session) {
  if (session.historySyncStatus === "loading") return "正在加载历史记录";
  if (session.historySyncStatus === "success") {
    return `已加载历史记录 ${Number(session.historyImportedCount || 0)} 条`;
  }
  if (session.historySyncStatus === "empty") return "未查到历史，已按老客户接入";
  if (session.historySyncStatus === "failed") return "历史加载失败，已按老客户接入";
  return "已按老客户接入";
}
```

Inside `flow-session-name-row`, after the `<strong>`:

```js
const legacyBadge = sessionType === "private" && session.customerOrigin === "legacy"
  ? `<span class="legacy-customer-badge" title="${escapeHtml(legacyCustomerTooltip(session))}" aria-label="${escapeHtml(legacyCustomerTooltip(session))}">
      ${icon("history")}<span>老客户</span>
    </span>`
  : "";
```

- [ ] **Step 5: Style the compact gold badge**

Use the existing handoff gold:

```css
.legacy-customer-badge {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 3px;
  min-width: 0;
  padding: 2px 6px;
  border: 1px solid color-mix(in srgb, #f59e0b 64%, var(--line));
  border-radius: 6px;
  background: color-mix(in srgb, #f59e0b 14%, #ffffff);
  color: #9a6700;
  font-size: 11px;
  line-height: 16px;
  font-weight: 700;
}

.legacy-customer-badge .icon {
  width: 12px;
  height: 12px;
}
```

Allow `.flow-session-name-row` to shrink the name while keeping the badge text visible. Do not add `animation`, card classes, or sorting logic.

- [ ] **Step 6: Run console tests**

Run:

```bash
node --test tests/console-legacy-customer-boundary.test.js tests/console-handoff-boundary.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit console badge**

```bash
git add \
  public/console/index.html \
  public/console/app.js \
  public/console/styles.css \
  tests/console-legacy-customer-boundary.test.js
git commit -m "Show legacy customer session badge"
```

---

### Task 8: End-to-End Verification and Push

**Files:**
- Modify only files needed to fix failures directly caused by Tasks 1-7.

**Interfaces:**
- Consumes the complete feature.
- Produces a verified `main` branch pushed to `origin/main`.

- [ ] **Step 1: Run all focused feature tests together**

Run:

```bash
node --test \
  tests/worktool-history.test.js \
  tests/db-legacy-history.test.js \
  tests/legacy-history.test.js \
  tests/worktool-history-cache.test.js \
  tests/dclaw-tags.test.js \
  tests/server-legacy-history-boundary.test.js \
  tests/console-legacy-customer-boundary.test.js
```

Expected: PASS with zero failures.

- [ ] **Step 2: Run the complete test suite**

Run:

```bash
npm test
```

Expected: PASS with zero failures. Existing unrelated untracked test files must not be staged or changed.

- [ ] **Step 3: Inspect the final diff and repository state**

Run:

```bash
git diff --check
git status --short
git log --oneline -8
```

Expected:

- no whitespace errors;
- only pre-existing unrelated dirty files remain unstaged;
- Tasks 1-7 appear as focused commits.

- [ ] **Step 4: Perform a local adapter smoke test with fixtures only**

Run:

```bash
node --test tests/worktool-history.test.js
```

Do not call live WorkTool APIs from automated tests. The live production verification already established the endpoint shapes for 阿三 and 魔兮.

- [ ] **Step 5: Push the completed implementation**

```bash
git push origin main
```

Expected: `main -> main` succeeds.

- [ ] **Step 6: Report operational verification commands**

Provide the user with:

```bash
docker logs --since 10m worktool-bot-service 2>&1 | grep -E "legacy_history|worktool_history_cache|agent.invoke|incoming"
```

The expected production sequence for a local-history-missing old customer is:

1. `legacy_history.start`
2. `legacy_history.success`, `legacy_history.empty`, or `legacy_history.failed`
3. `agent.invoke.start`
4. normal WorkTool send and command callback events

Also report that the card should display the gold `老客户` badge and the tooltip matching the recorded sync status.
