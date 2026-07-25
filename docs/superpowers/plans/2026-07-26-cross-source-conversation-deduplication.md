# Cross-Source Conversation Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent one WorkTool message from appearing multiple times after legacy-history loading without merging genuinely repeated live messages or deleting audit records.

**Architecture:** A pure conversation-message deduplication module owns source classification, normalized comparison, timestamp tolerances, canonical-row preference, and anchor preservation. Database import and read paths consume that module to prevent new imported duplicates and hide existing ones, while the bounded Agent-history selector consumes the same module before applying its character budget.

**Tech Stack:** Node.js ES modules, built-in `node:test`, SQLite through `node:sqlite`.

## Global Constraints

- Do not delete existing `conversation_messages` rows.
- Never merge two `local` messages.
- Every duplicate group must contain at least one imported row.
- Same imported source requires an exact timestamp match.
- Different imported sources allow at most 3 seconds.
- Local versus imported allows at most 10 seconds.
- Canonical preference is `local`, then `worktool_customer_history`, then `worktool_api_history`, then lower database id.
- Content normalization is only for comparison; returned content remains unchanged.
- Evidence-window reads must preserve the requested anchor row.
- Bot and conversation isolation must remain mandatory.
- Do not add dependencies.

---

## File Map

- Create `src/conversation-message-dedupe.js`: pure duplicate identity and canonical-row selection.
- Create `tests/conversation-message-dedupe.test.js`: unit coverage for source and timing rules.
- Modify `src/db.js`: skip new imported duplicates and deduplicate conversation read views.
- Modify `tests/db-legacy-history.test.js`: database integration coverage for import and read behavior.
- Modify `src/history-analysis.js`: deduplicate customer history before character selection.
- Modify `tests/history-analysis.test.js`: prove duplicate history does not consume budget.

---

### Task 1: Pure Cross-Source Duplicate Rules

**Files:**
- Create: `src/conversation-message-dedupe.js`
- Create: `tests/conversation-message-dedupe.test.js`

**Interfaces:**
- Produces: `normalizeConversationMessageContent(value) -> string`.
- Produces: `areConversationMessagesDuplicates(left, right) -> boolean`.
- Produces: `dedupeConversationMessages(messages, { preferredMessageId } = {}) -> message[]`.
- A message contains `id`, `botId`, `conversationKey`, `direction`, `content`, `source`, and `createdAt`.

- [ ] **Step 1: Write failing source and timing tests**

Create `tests/conversation-message-dedupe.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  areConversationMessagesDuplicates,
  dedupeConversationMessages
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

test("local and imported equivalents match within ten seconds", () => {
  assert.equal(areConversationMessagesDuplicates(
    row(),
    row({
      id: 2,
      source: "worktool_customer_history",
      content: " 老师   在吗 ",
      createdAt: "2026-07-25T15:22:09.000Z"
    })
  ), true);
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
      createdAt: "2026-07-25T15:22:01.000Z"
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
      createdAt: "2026-07-25T15:22:04.000Z"
    })
  ), false);
});
```

- [ ] **Step 2: Run the unit test and verify RED**

Run:

```bash
node --test tests/conversation-message-dedupe.test.js
```

Expected: FAIL because `src/conversation-message-dedupe.js` does not exist.

- [ ] **Step 3: Implement duplicate identity**

Create `src/conversation-message-dedupe.js` with:

```js
const importedSources = new Set([
  "worktool_customer_history",
  "worktool_api_history"
]);

export function normalizeConversationMessageContent(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function messageTime(message) {
  const value = Date.parse(message?.createdAt || "");
  return Number.isFinite(value) ? value : null;
}

export function areConversationMessagesDuplicates(left, right) {
  if (!left || !right) return false;
  if (left.botId && right.botId && left.botId !== right.botId) return false;
  if (
    left.conversationKey
    && right.conversationKey
    && left.conversationKey !== right.conversationKey
  ) return false;
  if (left.direction !== right.direction) return false;
  if (
    normalizeConversationMessageContent(left.content)
    !== normalizeConversationMessageContent(right.content)
  ) return false;

  const leftImported = importedSources.has(left.source);
  const rightImported = importedSources.has(right.source);
  if (!leftImported && !rightImported) return false;
  const leftTime = messageTime(left);
  const rightTime = messageTime(right);
  if (leftTime === null || rightTime === null) return false;
  const delta = Math.abs(leftTime - rightTime);
  if (leftImported && rightImported) {
    return left.source === right.source ? delta === 0 : delta <= 3_000;
  }
  return delta <= 10_000;
}
```

- [ ] **Step 4: Add failing canonical and anchor tests**

Append:

```js
test("dedupe prefers local then customer history", () => {
  const api = row({ id: 1, source: "worktool_api_history" });
  const customer = row({ id: 2, source: "worktool_customer_history" });
  const local = row({ id: 3, source: "local" });
  assert.deepEqual(
    dedupeConversationMessages([api, customer, local]).map((item) => item.id),
    [3]
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

test("dedupe retains rows outside source tolerance", () => {
  const local = row();
  const imported = row({
    id: 2,
    source: "worktool_customer_history",
    createdAt: "2026-07-25T15:22:11.000Z"
  });
  assert.equal(dedupeConversationMessages([local, imported]).length, 2);
});
```

- [ ] **Step 5: Implement canonical selection**

Add a source rank map and the complete selector:

```js
const sourceRank = new Map([
  ["local", 0],
  ["worktool_customer_history", 1],
  ["worktool_api_history", 2]
]);

function stableId(message) {
  const value = Number(message?.id);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function compareChronologically(left, right) {
  const leftTime = messageTime(left) ?? Number.POSITIVE_INFINITY;
  const rightTime = messageTime(right) ?? Number.POSITIVE_INFINITY;
  return leftTime - rightTime || stableId(left) - stableId(right);
}

function candidateWins(candidate, existing, preferredMessageId) {
  if (stableId(candidate) === preferredMessageId) return true;
  if (stableId(existing) === preferredMessageId) return false;
  const candidateRank = sourceRank.get(candidate.source) ?? 3;
  const existingRank = sourceRank.get(existing.source) ?? 3;
  return candidateRank < existingRank
    || (candidateRank === existingRank && stableId(candidate) < stableId(existing));
}

export function dedupeConversationMessages(
  messages,
  { preferredMessageId = null } = {}
) {
  const canonical = [];
  for (const candidate of [...(messages || [])].sort(compareChronologically)) {
    const duplicateIndex = canonical.findIndex(
      (existing) => areConversationMessagesDuplicates(existing, candidate)
    );
    if (duplicateIndex < 0) {
      canonical.push(candidate);
      continue;
    }
    if (candidateWins(candidate, canonical[duplicateIndex], Number(preferredMessageId))) {
      canonical[duplicateIndex] = candidate;
    }
  }
  return canonical.sort(compareChronologically);
}
```

- [ ] **Step 6: Run pure unit tests**

Run:

```bash
node --test tests/conversation-message-dedupe.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit the pure module**

```bash
git add src/conversation-message-dedupe.js tests/conversation-message-dedupe.test.js
git commit -m "Add cross-source conversation deduplication"
```

---

### Task 2: Database Import And Read Boundaries

**Files:**
- Modify: `src/db.js`
- Modify: `tests/db-legacy-history.test.js`

**Interfaces:**
- Consumes: `areConversationMessagesDuplicates(left, right)`.
- Consumes: `dedupeConversationMessages(messages, options)`.
- Existing callers continue using `insertImportedConversationMessages`,
  `listConversationMessages`, and `listConversationMessagesAround`.

- [ ] **Step 1: Add failing database tests**

Append to `tests/db-legacy-history.test.js`:

```js
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
  assert.equal(db.listConversationMessages({ botId, conversationKey }).length, 1);
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
```

Append an evidence-anchor regression:

```js
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
```

- [ ] **Step 2: Run database tests and verify RED**

Run:

```bash
node --test tests/db-legacy-history.test.js
```

Expected: FAIL because import and read paths do not use semantic deduplication.

- [ ] **Step 3: Add import-time duplicate detection**

Import the pure helpers at the top of `src/db.js`.

Prepare a bounded candidate lookup:

```js
const duplicateCandidates = db.prepare(`
  SELECT *
  FROM conversation_messages
  WHERE bot_id = ?
    AND conversation_key = ?
    AND direction = ?
    AND created_at BETWEEN ? AND ?
  ORDER BY created_at ASC, id ASC
`);
```

Before each insert, parse `createdAt`, calculate ISO timestamps ten seconds
before and after, and map the query rows through `rowToConversationMessage`.
Construct:

```js
const importedCandidate = {
  botId,
  conversationKey,
  direction,
  content,
  source,
  sourceKey,
  createdAt
};
const matching = candidates.filter(
  (candidate) => areConversationMessagesDuplicates(candidate, importedCandidate)
);
const retained = dedupeConversationMessages([...matching, importedCandidate]);
const candidateIsCanonical = retained.includes(importedCandidate);
if (matching.length && !candidateIsCanonical) continue;
```

This skips same-source aliases, API-history duplicates, and imported copies of
live rows. It still inserts `worktool_customer_history` when the only existing
equivalent is lower-priority `worktool_api_history`, allowing read views to
select the richer row.

- [ ] **Step 4: Deduplicate normal conversation reads**

Normalize requested visible limit to at least one. Query up to four times that
limit, capped at 1200 rows:

```js
const visibleLimit = Math.max(1, Number.parseInt(limit, 10) || 200);
const fetchLimit = Math.min(1200, visibleLimit * 4);
const rows = statement.all(...queryParams, fetchLimit);
return dedupeConversationMessages(rows.map(rowToConversationMessage))
  .slice(-visibleLimit);
```

This preserves the newest visible rows while allowing room for duplicate
removal.

- [ ] **Step 5: Deduplicate evidence-window reads**

Normalize the visible `before` and `after` limits to `0..200`. Fetch up to four
times each visible limit, capped at 800 per side, then:

```js
const beforeFetchLimit = Math.min(800, beforeLimit * 4);
const afterFetchLimit = Math.min(800, afterLimit * 4);
const visible = dedupeConversationMessages(
  [...earlier, anchor, ...later].map(rowToConversationMessage),
  { preferredMessageId: anchor.id }
);
const anchorIndex = visible.findIndex((message) => message.id === anchor.id);
if (anchorIndex < 0) return [];
return visible.slice(
  Math.max(0, anchorIndex - beforeLimit),
  anchorIndex + afterLimit + 1
);
```

The preferred anchor must replace any otherwise higher-ranked duplicate.

- [ ] **Step 6: Run database and isolation tests**

Run:

```bash
node --test \
  tests/db-legacy-history.test.js \
  tests/db-bot-isolation.test.js \
  tests/db-tag-alerts.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit database integration**

```bash
git add src/db.js tests/db-legacy-history.test.js
git commit -m "Deduplicate imported conversation views"
```

---

### Task 3: Agent History Budget Deduplication

**Files:**
- Modify: `src/history-analysis.js`
- Modify: `tests/history-analysis.test.js`

**Interfaces:**
- Consumes: `dedupeConversationMessages(messages)`.
- Existing `buildBoundedCustomerHistoryText` return shape stays unchanged.

- [ ] **Step 1: Write failing Agent-history test**

Append:

```js
test("duplicate imported customer rows consume the history budget once", () => {
  const result = buildBoundedCustomerHistoryText({
    maxChars: 100,
    messages: [
      inbound("之前已付款", "2026-07-01T00:00:00.000Z", {
        id: 1,
        botId: "bot-a",
        conversationKey: "bot-a:private:客户",
        sourceKey: "alias-a"
      }),
      inbound("之前已付款", "2026-07-01T00:00:00.000Z", {
        id: 2,
        botId: "bot-a",
        conversationKey: "bot-a:private:客户",
        sourceKey: "alias-b"
      })
    ]
  });

  assert.equal(result.text, "之前已付款");
  assert.equal(result.importedCustomerCount, 1);
  assert.equal(result.selectedCount, 1);
  assert.equal(result.selectedChars, 5);
});
```

- [ ] **Step 2: Run selector tests and verify RED**

Run:

```bash
node --test tests/history-analysis.test.js
```

Expected: FAIL because both imported rows are counted.

- [ ] **Step 3: Apply shared deduplication before budget selection**

Import `dedupeConversationMessages`. After filtering and normalizing customer
messages, call:

```js
const customerMessages = dedupeConversationMessages(normalizedCustomerMessages);
```

Use the deduplicated collection for earliest timestamp, newest-first selection,
`importedCustomerCount`, and `omittedCount`.

- [ ] **Step 4: Run history and request tests**

Run:

```bash
node --test \
  tests/history-analysis.test.js \
  tests/legacy-customer-history-service.test.js \
  tests/dclaw-tags.test.js \
  tests/dclaw-request-sanitization.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Agent-history integration**

```bash
git add src/history-analysis.js tests/history-analysis.test.js
git commit -m "Deduplicate bounded legacy history input"
```

---

### Task 4: Full Regression And Review

**Files:**
- Modify only files required by regressions caused by Tasks 1-3.

**Interfaces:**
- Consumes all prior task outputs.
- Produces a clean, release-ready commit series.

- [ ] **Step 1: Run syntax checks**

Run:

```bash
node --check src/conversation-message-dedupe.js
node --check src/db.js
node --check src/history-analysis.js
```

Expected: all commands exit zero.

- [ ] **Step 2: Run the complete test suite**

Run:

```bash
npm test
```

Expected: all tests pass with zero failures.

- [ ] **Step 3: Check scope and formatting**

Run:

```bash
git diff --check
git status --short
git log --oneline -10
```

Expected: no whitespace errors and no uncommitted files.

- [ ] **Step 4: Request code review**

Review from the design commit through the final implementation commit. Require
findings to lead with severity and file/line references. Specifically inspect:

- accidental local-local merging;
- cross-Bot or cross-conversation matching;
- evidence anchor stability;
- timestamp tolerance boundaries;
- existing duplicate visibility;
- character-budget counts;
- raw-record retention.

- [ ] **Step 5: Fix Critical or Important findings**

For every valid finding, add a failing regression test, implement the smallest
fix, rerun focused tests, and commit the correction.

- [ ] **Step 6: Run final verification**

Run:

```bash
npm test
git diff --check
git status --short
```

Expected: complete suite passes, formatting is clean, and the worktree is clean.
