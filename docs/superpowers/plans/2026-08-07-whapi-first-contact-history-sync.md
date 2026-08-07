# Whapi First-Contact History Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Whapi private customer is first discovered locally, import that chat's available history and assign the date tag from the earliest traceable message before normal realtime automation continues.

**Architecture:** Extend the existing Whapi client with a bounded chat-history read, persist one lease-protected sync record per Bot conversation, and place a focused history-sync service between conversation creation and realtime message persistence. Imported rows reuse the existing imported-message path and never enter Agent or automation dispatch; failures degrade to the realtime message timestamp.

**Tech Stack:** Node.js ESM, Node built-in SQLite (`DatabaseSync`), Express 5, existing Whapi adapter/client and channel message bridge, Node test runner.

## Global Constraints

- Do not use a git worktree; operate in the current project directory as requested by the user.
- Sync only a locally unknown private conversation; never sync groups or the whole Channel.
- `contacts.post` is not a source of truth for first contact.
- Whapi history is bounded to 20 pages and 2,000 messages per first discovery.
- Imported history must not invoke Agent, send Channel messages, advance tasks, evaluate AI tags, or emit customer notifications.
- Existing date tags are immutable; never overwrite them.
- Whapi failure must not block persistence or processing of the realtime webhook message.
- Logs and stored errors must not contain the Whapi Token, provider response body, or full message text.

---

### Task 1: Add bounded Whapi chat-history reads

**Files:**
- Modify: `src/channels/whapi/client.js`
- Modify: `tests/whapi-client.test.js`

**Interfaces:**
- Consumes: existing `request(operation, path, options)` and `requiredId(value, name)` helpers.
- Produces: `client.listMessagesByChat(chatId, { count, offset, sort }): Promise<object>`.

- [ ] **Step 1: Write the failing client test**

Add a test that captures the requested URL and asserts exact path encoding, pagination, sorting, and Bearer authorization:

```js
test("Whapi client lists one chat history with bounded query parameters", async () => {
  let seen;
  const client = createWhapiClient({
    token: "history-token",
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return response(200, { messages: [], count: 0, total: 0 });
    }
  });
  await client.listMessagesByChat("15551234567@s.whatsapp.net", {
    count: 100,
    offset: 200,
    sort: "asc"
  });
  assert.equal(
    seen.url,
    "https://gate.whapi.cloud/messages/list/15551234567%40s.whatsapp.net?count=100&offset=200&sort=asc"
  );
  assert.equal(seen.options.headers.authorization, "Bearer history-token");
});
```

Also assert an empty Chat ID fails before `fetchImpl` is called.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/whapi-client.test.js`

Expected: FAIL because `listMessagesByChat` is undefined.

- [ ] **Step 3: Implement the minimal client method**

Add to the frozen client:

```js
listMessagesByChat: (chatId, options = {}) => request(
  "list_messages_by_chat",
  `/messages/list/${encodeURIComponent(requiredId(chatId, "chatId"))}`,
  { query: { ...pagination(options), sort: options.sort } }
),
```

The client must continue using `channelFailure`; do not include response bodies or the token in thrown errors.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/whapi-client.test.js`

Expected: all Whapi client tests pass.

- [ ] **Step 5: Commit the client boundary**

```bash
git add src/channels/whapi/client.js tests/whapi-client.test.js
git commit -m "feat: read Whapi chat history"
```

---

### Task 2: Persist first-contact history sync leases

**Files:**
- Modify: `src/db.js`
- Create: `tests/db-first-contact-history-sync.test.js`

**Interfaces:**
- Produces: `claimFirstContactHistorySync({ botId, conversationKey, owner, leaseMs, nowIso }): { claimed, record }`.
- Produces: `completeFirstContactHistorySync({ botId, conversationKey, owner, status, pageCount, importedCount, earliestAt, errorMessage, nowIso }): record`.
- Produces: `getFirstContactHistorySync({ botId, conversationKey }): record | null`.
- Produces statuses: `processing | success | unavailable | failed`.

- [ ] **Step 1: Write failing database lease tests**

Cover these exact cases:

```js
const first = claimFirstContactHistorySync({
  botId: "bot-a", conversationKey: "whapi:chan:private:alice", owner: "worker-a",
  leaseMs: 60_000, nowIso: "2026-08-07T00:00:00.000Z"
});
assert.equal(first.claimed, true);
assert.equal(claimFirstContactHistorySync({
  botId: "bot-a", conversationKey: "whapi:chan:private:alice", owner: "worker-b",
  leaseMs: 60_000, nowIso: "2026-08-07T00:00:30.000Z"
}).claimed, false);
assert.equal(claimFirstContactHistorySync({
  botId: "bot-a", conversationKey: "whapi:chan:private:alice", owner: "worker-b",
  leaseMs: 60_000, nowIso: "2026-08-07T00:01:01.000Z"
}).claimed, true);
```

Also test owner enforcement on completion, attempt increment, terminal status persistence, bounded error length, and Bot isolation.

- [ ] **Step 2: Run the database test and verify RED**

Run: `node --test tests/db-first-contact-history-sync.test.js`

Expected: FAIL because the table and exported functions do not exist.

- [ ] **Step 3: Add the schema and row mapper**

Create `first_contact_history_syncs` with:

```sql
bot_id TEXT NOT NULL,
conversation_key TEXT NOT NULL,
status TEXT NOT NULL DEFAULT 'pending',
attempts INTEGER NOT NULL DEFAULT 0,
lease_owner TEXT NOT NULL DEFAULT '',
lease_expires_at TEXT,
page_count INTEGER NOT NULL DEFAULT 0,
imported_count INTEGER NOT NULL DEFAULT 0,
earliest_at TEXT,
error_message TEXT NOT NULL DEFAULT '',
started_at TEXT,
finished_at TEXT,
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL,
PRIMARY KEY (bot_id, conversation_key)
```

Implement claim using `BEGIN IMMEDIATE`, permitting a claim only for a missing row, `failed`, `unavailable`, or an expired `processing` row. `success` is terminal. Completion must update only a row owned by the supplied owner and must clear lease fields.

- [ ] **Step 4: Run focused database tests and verify GREEN**

Run: `node --test tests/db-first-contact-history-sync.test.js tests/db-channel-accounts.test.js`

Expected: all selected database tests pass.

- [ ] **Step 5: Commit lease persistence**

```bash
git add src/db.js tests/db-first-contact-history-sync.test.js
git commit -m "feat: persist first-contact history sync leases"
```

---

### Task 3: Normalize and import Whapi history without side effects

**Files:**
- Create: `src/first-contact-history-sync.js`
- Modify: `src/db.js`
- Modify: `src/channels/whapi/mapper.js`
- Create: `tests/first-contact-history-sync.test.js`
- Create: `tests/db-conversation-history.test.js`

**Interfaces:**
- Produces: `normalizeWhapiHistoryMessage({ channelAccountId, message }): InboundEvent` from the mapper.
- Produces: `syncFirstContactHistory({ botId, agentId, conversationKey, chatId, currentMessage, client, owner, maxPages = 20, maxMessages = 2000 }): Promise<{ status, pageCount, importedCount, earliestAt }>`.
- Extends: `insertImportedConversationMessages` accepts source `whapi_chat_history` and message rows with `sourceKey`, `direction`, `senderName`, `content`, `rawPayload`, and `createdAt`.
- Produces: `ensureFirstDiscoveryDateTag({ botId, agentId, conversationKey, firstSeenAt }): tags | null`.

- [ ] **Step 1: Write failing pure synchronization tests**

Use injected fake `client`, lease functions, importer, and date-tag writer. Verify:

```js
const result = await syncFirstContactHistory({
  botId: "bot-a",
  agentId: "agent-a",
  conversationKey: "whapi:chan:private:1555@s.whatsapp.net",
  chatId: "1555@s.whatsapp.net",
  currentMessage: { messageId: "live-3", occurredAt: "2026-08-07T03:00:00.000Z" },
  client,
  owner: "worker-a",
  dependencies
});
assert.equal(result.earliestAt, "2026-08-05T01:00:00.000Z");
assert.deepEqual(imported.map((row) => row.sourceKey), ["old-1", "old-2"]);
```

Test ascending pagination, duplicate current message removal, maximum 20 pages/2,000 messages, invalid timestamps excluded from `earliestAt`, empty history as `unavailable`, and provider failure as `failed` without throwing.

- [ ] **Step 2: Run sync tests and verify RED**

Run: `node --test tests/first-contact-history-sync.test.js`

Expected: FAIL because the module and mapper export do not exist.

- [ ] **Step 3: Expose one-message history normalization**

Refactor `normalizeMessage` into an exported wrapper without changing webhook behavior:

```js
export function normalizeWhapiHistoryMessage({ channelAccountId, message }) {
  return normalizeMessage(channelAccountId, "post", message);
}
```

Convert normalized events to imported rows. Use the event message external ID as `sourceKey`; use `event.occurredAt` as `createdAt`; use `fromMe` for direction. Generate existing visible placeholders for attachment-only messages instead of discarding them.

- [ ] **Step 4: Extend the imported-message database path**

Permit `whapi_chat_history` in `insertImportedConversationMessages`. Keep `INSERT OR IGNORE` idempotency and add a test proving repeated provider message IDs insert once. Do not call any Agent, task, alert, or Channel function from this database path.

Add an explicit date-tag function that checks conversation ownership, private room type, enabled date-tag schema, valid timestamp, and existing date tag, but intentionally does not reject a historical timestamp that predates `effectiveAt`:

```js
export function ensureFirstDiscoveryDateTag({ botId, agentId, conversationKey, firstSeenAt }) {
  // validate ownership/type/schema; return existing tag unchanged; otherwise call upsertSystemDateTag
}
```

- [ ] **Step 5: Implement the bounded sync service**

The service must claim its lease first, request pages using `count: 100`, `offset: page * 100`, `sort: "asc"`, stop at provider total/end/limits, remove the current provider message ID from imported rows, insert history, select the earliest valid timestamp including the current message, write the date tag, and complete the lease.

On error, call completion with `status: "failed"` and `errorMessage: error.code || error.name || "history_sync_failed"`; never store `error.message` when it can contain provider material. Return the failed result rather than throwing.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
node --test \
  tests/first-contact-history-sync.test.js \
  tests/db-first-contact-history-sync.test.js \
  tests/db-conversation-history.test.js \
  tests/whapi-mapper.test.js
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit the isolated sync service**

```bash
git add src/first-contact-history-sync.js src/db.js src/channels/whapi/mapper.js \
  tests/first-contact-history-sync.test.js tests/db-conversation-history.test.js
git commit -m "feat: import Whapi first-contact history"
```

---

### Task 4: Insert history sync into realtime private-message processing

**Files:**
- Modify: `src/server.js`
- Create: `tests/server-first-contact-history-sync-boundary.test.js`
- Create: `tests/server-first-contact-history-sync-integration.test.js`
- Modify: `tests/fixtures/mock-whapi-fetch.js`

**Interfaces:**
- Consumes: `syncFirstContactHistory(...)` from Task 3.
- Consumes: existing `createWhapiClientForBot(botId)`, `upsertConversation`, session initialization, and realtime message insertion.
- Produces: an ordering guarantee: conversation shell → history sync/import/date tag → current message persistence → existing automation.

- [ ] **Step 1: Write the failing server boundary test**

Assert source ordering and guards:

```js
assert.ok(handler.indexOf("hadConversation") < handler.indexOf("syncFirstContactHistory"));
assert.ok(handler.indexOf("syncFirstContactHistory") < handler.indexOf("insertConversationMessage"));
assert.match(handler, /isPrivateMessage\(message\)[\s\S]*!hadConversation/);
assert.doesNotMatch(handler, /isGroupMessage\(message\)[\s\S]*syncFirstContactHistory/);
```

Also assert existing conversations bypass the sync and history rows do not call `inboundCoalescer.push` themselves.

- [ ] **Step 2: Write the failing integration test**

Start the real server with a temporary database and mocked Whapi fetch. Post a `messages.post` webhook for an unknown customer while the history endpoint returns two older messages plus the current message. Wait for the worker, then assert:

- one Whapi history sequence was requested;
- three unique conversation messages exist in chronological display order;
- the date tag equals the oldest history date under the configured cutoff;
- exactly one Agent invocation corresponds to the realtime webhook;
- no outgoing message was created by historical rows.

Add failure and empty-history cases proving the realtime message and date tag still exist.

- [ ] **Step 3: Run server tests and verify RED**

Run:

```bash
node --test \
  tests/server-first-contact-history-sync-boundary.test.js \
  tests/server-first-contact-history-sync-integration.test.js
```

Expected: FAIL because realtime processing does not call the sync service.

- [ ] **Step 4: Refactor inbound persistence at the narrow boundary**

Make the first-discovery path asynchronous without restructuring unrelated processing:

```js
if (isPrivateMessage(message) && !hadConversation) {
  const conversation = upsertConversation({
    botId,
    agentId: binding?.agentId || "",
    conversationKey,
    message,
    resetPending: resetState.resetPending,
    skipFirstSeenDateTag: true
  });
  await syncFirstContactHistory({
    botId,
    agentId: binding?.agentId || "",
    conversationKey,
    chatId: message.metadata.externalChatId,
    currentMessage: message,
    client: createWhapiClientForBot(botId),
    owner: `webhook:${process.pid}:${crypto.randomUUID()}`
  });
  // initialize session, then insert only the realtime message through the existing path
}
```

Keep existing/group behavior unchanged. If no Whapi client can be created, treat it as failed sync and continue. Do not send imported events back through `dispatchChannelWebhookEvent`.

- [ ] **Step 5: Add structured operational logs**

Emit:

- `first_contact_history_sync.started` with Bot, conversation, Channel;
- `first_contact_history_sync.completed` with status, page/import counts, earliest date, duration;
- `first_contact_history_sync.failed` with safe error category and duration.

Do not log message bodies, response bodies, or credentials.

- [ ] **Step 6: Run focused server tests and verify GREEN**

Run:

```bash
node --test \
  tests/server-first-contact-history-sync-boundary.test.js \
  tests/server-first-contact-history-sync-integration.test.js \
  tests/server-inbound-coalescing-boundary.test.js \
  tests/server-tags-boundary.test.js \
  tests/server-whapi-webhook.test.js
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit realtime integration**

```bash
git add src/server.js tests/server-first-contact-history-sync-boundary.test.js \
  tests/server-first-contact-history-sync-integration.test.js tests/fixtures/mock-whapi-fetch.js
git commit -m "feat: sync history on first Whapi contact"
```

---

### Task 5: Verify safety, documentation, and production configuration

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/whapi-cloud-channel-adapter-migration-plan.md`
- Test: all files under `tests/`

**Interfaces:**
- Produces environment defaults: `WHAPI_FIRST_CONTACT_HISTORY_MAX_PAGES=20`, `WHAPI_FIRST_CONTACT_HISTORY_MAX_MESSAGES=2000`, `WHAPI_FIRST_CONTACT_HISTORY_LEASE_MS=60000`.

- [ ] **Step 1: Document exact runtime behavior and limits**

Add the three environment variables with safe defaults. Document that the date tag means earliest Whapi-available message, history import is lazy per unknown private customer, existing tags are preserved, and failures degrade to current-message processing.

- [ ] **Step 2: Run security-focused searches**

Run:

```bash
rg -n "first_contact_history_sync.*(token|body|content)|error\.message" src/first-contact-history-sync.js src/server.js
```

Expected: no history-sync log or persisted error includes a token, response body, or full message content. Any `error.message` occurrence must be outside this feature or replaced by a safe category.

- [ ] **Step 3: Run the focused feature suite**

Run:

```bash
node --test \
  tests/whapi-client.test.js \
  tests/whapi-mapper.test.js \
  tests/db-first-contact-history-sync.test.js \
  tests/first-contact-history-sync.test.js \
  tests/server-first-contact-history-sync-boundary.test.js \
  tests/server-first-contact-history-sync-integration.test.js
```

Expected: all focused tests pass with zero failures.

- [ ] **Step 4: Run the complete regression suite**

Run: `npm test`

Expected: zero failures; existing intentional skips may remain.

- [ ] **Step 5: Request independent code review and address findings**

Review against `docs/superpowers/specs/2026-08-07-whapi-first-contact-history-sync-design.md`, focusing on duplicate replies, lease recovery, historical side effects, date-tag immutability, provider pagination, and credential leakage. Fix all Critical and Important findings, then rerun focused and full tests.

- [ ] **Step 6: Commit documentation and final fixes**

```bash
git add .env.example README.md docs/whapi-cloud-channel-adapter-migration-plan.md
git commit -m "docs: explain first-contact history sync"
```

- [ ] **Step 7: Push only after fresh verification**

```bash
git status --short
git log --oneline --max-count=6
git push origin main
```

Expected: feature commits reach `origin/main`; unrelated pre-existing working-tree changes remain uncommitted and untouched.
