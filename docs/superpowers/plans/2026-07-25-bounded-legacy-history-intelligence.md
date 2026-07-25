# Bounded Legacy History Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send one bounded plain-text block of legacy customer messages to the Agent, then persist the validated tag decisions, flow assets, and earliest-history date tag.

**Architecture:** A new pure `history-analysis` module owns per-Bot limit normalization and newest-first history selection. The legacy-history service exposes a stored analysis snapshot, while the existing DClaw request builder and response gateway carry one optional history-analysis contract. The server orchestrator enables that contract only for an unsent legacy history snapshot and reuses existing tag adjudication, flow data merge, and date-tag persistence.

**Tech Stack:** Node.js ES modules, built-in `node:test`, Express 5, SQLite through `node:sqlite`, vanilla HTML/CSS/JavaScript.

## Global Constraints

- Historical Agent input contains customer-authored messages only.
- Historical Agent input is plain text and never uses `history_context` or a JSON message array.
- Default historical text budget is 4000 Unicode characters.
- Per-Bot configuration range is 1000 through 6000, with a UI step of 100.
- Selection starts at the newest complete message and stops when the next message would exceed the budget.
- Selected messages are rendered in chronological order.
- The live message does not consume the historical budget.
- Exactly one Agent call performs the live reply, tag decision, and flow asset collection.
- Later normal calls do not resend a successfully processed historical block.
- The earliest imported customer timestamp creates the add-date tag locally.
- Existing tag exclusivity, one-way transitions, activation scheduling, response validation, fallback replies, and flow transition rules remain authoritative.
- Do not add dependencies.

---

## File Map

- Create `src/history-analysis.js`: normalize the Bot setting, count Unicode code points, and build the bounded customer-only text snapshot.
- Create `tests/history-analysis.test.js`: unit coverage for settings and text selection.
- Modify `src/legacy-customer-history.js`: expose stored customer-only analysis data and earliest timestamp.
- Modify `tests/legacy-customer-history-service.test.js`: replace mixed-history expectations with bounded customer-only expectations.
- Modify `src/dclaw.js`: accept optional historical text and tag rules, emit the combined response schema, and preserve the contract in repair prompts.
- Modify `tests/dclaw-tags.test.js`: verify plain-text history, tag rules, response schema, and no `history_context`.
- Modify `tests/dclaw-request-sanitization.test.js`: verify configured maximum history fits the overall request boundary.
- Modify `src/server.js`: add Bot-scoped setting APIs, build the legacy request, validate and apply tags/assets, create the legacy date tag, and mark successful one-time analysis.
- Modify `tests/server-legacy-history-boundary.test.js`: verify legacy analysis is conditionally assembled and marked.
- Modify `tests/server-tags-boundary.test.js`: verify Agent tag decisions are applied only when the request allowed them.
- Modify `tests/db-legacy-history.test.js`: verify one-time state and legacy date-tag behavior.
- Modify `public/console/index.html`: add the History Intelligence panel and numeric setting.
- Modify `public/console/app.js`: load, save, reset, and isolate the setting by selected Bot.
- Modify `public/console/styles.css`: keep the compact setting panel aligned with the existing Config tab.
- Create `tests/console-history-analysis-boundary.test.js`: verify the UI and API wiring.

---

### Task 1: Pure History Budget And Selection

**Files:**
- Create: `src/history-analysis.js`
- Create: `tests/history-analysis.test.js`

**Interfaces:**
- Produces: `normalizeHistoryAnalysisConfig(config) -> { historyCustomerTextMaxChars: number }`
- Produces: `buildBoundedCustomerHistoryText({ messages, maxChars }) -> { text, selectedMessages, selectedCount, omittedCount, selectedChars, importedCustomerCount, earliestCustomerAt }`
- Consumes: normalized conversation-message records containing `direction`, `source`, `content`, and `createdAt`.

- [ ] **Step 1: Write failing setting-normalization tests**

```js
test("normalizes the per-Bot history character budget", () => {
  assert.deepEqual(normalizeHistoryAnalysisConfig({}), {
    historyCustomerTextMaxChars: 4000
  });
  assert.equal(
    normalizeHistoryAnalysisConfig({ historyCustomerTextMaxChars: 50 })
      .historyCustomerTextMaxChars,
    1000
  );
  assert.equal(
    normalizeHistoryAnalysisConfig({ historyCustomerTextMaxChars: 9000 })
      .historyCustomerTextMaxChars,
    6000
  );
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `node --test tests/history-analysis.test.js`

Expected: FAIL because `src/history-analysis.js` does not exist.

- [ ] **Step 3: Implement constants and normalization**

```js
export const DEFAULT_HISTORY_CUSTOMER_TEXT_MAX_CHARS = 4000;
export const MIN_HISTORY_CUSTOMER_TEXT_MAX_CHARS = 1000;
export const MAX_HISTORY_CUSTOMER_TEXT_MAX_CHARS = 6000;

export function normalizeHistoryAnalysisConfig(config = {}) {
  const requested = Number(config.historyCustomerTextMaxChars);
  const value = Number.isFinite(requested)
    ? Math.round(requested)
    : DEFAULT_HISTORY_CUSTOMER_TEXT_MAX_CHARS;
  return {
    historyCustomerTextMaxChars: Math.min(
      MAX_HISTORY_CUSTOMER_TEXT_MAX_CHARS,
      Math.max(MIN_HISTORY_CUSTOMER_TEXT_MAX_CHARS, value)
    )
  };
}
```

- [ ] **Step 4: Add failing selector tests**

Cover these exact cases:

```js
test("selects newest customer messages but renders them chronologically", () => {
  const result = buildBoundedCustomerHistoryText({
    maxChars: 7,
    messages: [
      inbound("第一条", "2026-07-01T00:00:00.000Z"),
      inbound("第二条", "2026-07-02T00:00:00.000Z"),
      inbound("第三条", "2026-07-03T00:00:00.000Z")
    ]
  });
  assert.equal(result.text, "第二条\n第三条");
  assert.equal(result.selectedCount, 2);
  assert.equal(result.omittedCount, 1);
  assert.equal(result.earliestCustomerAt, "2026-07-01T00:00:00.000Z");
});

test("stops instead of skipping or truncating the first message that exceeds the remaining budget", () => {
  const result = buildBoundedCustomerHistoryText({
    maxChars: 6,
    messages: [
      inbound("更早", "2026-07-01T00:00:00.000Z"),
      inbound("太长太长太长", "2026-07-02T00:00:00.000Z"),
      inbound("最新", "2026-07-03T00:00:00.000Z")
    ]
  });
  assert.equal(result.text, "最新");
  assert.equal(result.selectedCount, 1);
  assert.equal(result.omittedCount, 2);
});
```

Also verify:

- outbound and non-`worktool_customer_history` rows are excluded;
- blank content is excluded;
- `[图片消息]` remains intact;
- one emoji counts as one Unicode code point;
- invalid dates do not become `earliestCustomerAt`.

- [ ] **Step 5: Implement the selector**

Use `Array.from(text).length` for code-point counting. Filter and normalize once,
sort valid rows descending for selection, stop on the first overflow, then
reverse only the selected rows for rendering. Compute `earliestCustomerAt` from
all valid customer rows before budget selection.

- [ ] **Step 6: Run selector tests**

Run: `node --test tests/history-analysis.test.js`

Expected: PASS.

- [ ] **Step 7: Commit the pure module**

```bash
git add src/history-analysis.js tests/history-analysis.test.js
git commit -m "Add bounded legacy customer text selector"
```

---

### Task 2: Stored Legacy Analysis Snapshot

**Files:**
- Modify: `src/legacy-customer-history.js`
- Modify: `tests/legacy-customer-history-service.test.js`
- Modify: `tests/legacy-history.test.js`

**Interfaces:**
- Consumes: `buildBoundedCustomerHistoryText({ messages, maxChars })` from Task 1.
- Produces: `legacyCustomerHistory.buildStoredLegacyAnalysis({ botId, conversationKey, maxChars })`.
- The returned object is the exact selector result from Task 1.

- [ ] **Step 1: Replace the mixed-context service test with a failing customer-only test**

```js
test("builds bounded analysis from imported customer messages only", async () => {
  const { service } = createHarness();
  await service.prepareLegacyCustomer({
    botId: "bot_a",
    conversationKey: "bot_a:private:魔兮",
    title: "魔兮",
    machine: { config: { nodes: [{ id: "final" }] } }
  });

  const analysis = service.buildStoredLegacyAnalysis({
    botId: "bot_a",
    conversationKey: "bot_a:private:魔兮",
    maxChars: 4000
  });

  assert.equal(analysis.text, "之前已经付款");
  assert.equal(analysis.importedCustomerCount, 1);
  assert.equal(analysis.earliestCustomerAt, "2026-07-20T01:00:00.000Z");
});
```

The assertion must prove that `此前系统回复` and `当前消息` are absent.

- [ ] **Step 2: Run service tests and verify failure**

Run: `node --test tests/legacy-customer-history-service.test.js tests/legacy-history.test.js`

Expected: FAIL because `buildStoredLegacyAnalysis` is missing.

- [ ] **Step 3: Implement the stored snapshot**

Replace `buildStoredLegacyContext` with:

```js
function buildStoredLegacyAnalysis({ botId, conversationKey, maxChars }) {
  const imported = listImportedConversationMessages({ botId, conversationKey });
  return buildBoundedCustomerHistoryText({
    messages: imported.filter(
      (message) => message.source === "worktool_customer_history"
    ),
    maxChars
  });
}
```

Remove the now-unused dependency on `listConversationMessages` from the service
factory. Keep cached API history import for UI display, but never pass it to the
analysis selector.

- [ ] **Step 4: Replace obsolete mixed-context unit coverage**

Update `tests/legacy-history.test.js` so it tests
`buildBoundedCustomerHistoryText` only through the new module. Delete assertions
that prioritize local or API outbound history.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test \
  tests/history-analysis.test.js \
  tests/legacy-history.test.js \
  tests/legacy-customer-history-service.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit the service boundary**

```bash
git add src/legacy-customer-history.js tests/legacy-history.test.js tests/legacy-customer-history-service.test.js
git commit -m "Expose customer-only legacy history analysis"
```

---

### Task 3: Per-Bot Configuration API And Console

**Files:**
- Modify: `src/server.js`
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Create: `tests/console-history-analysis-boundary.test.js`

**Interfaces:**
- Consumes: `normalizeHistoryAnalysisConfig(config)` from Task 1.
- Produces: `GET /api/bots/:botId/settings/history-analysis`.
- Produces: `PUT /api/bots/:botId/settings/history-analysis`.
- Stores: `app_settings` key generated as ``history_analysis:${botId}``.

- [ ] **Step 1: Write failing server and console boundary tests**

Assert that `src/server.js` contains:

```js
function getHistoryAnalysisSettingKey(botId) {
  return `history_analysis:${String(botId || "").trim()}`;
}
```

Assert that both routes call `assertAdminForBot`, PUT merges the current value
with the request body, and the result is normalized before `setSetting`.

Assert that `public/console/index.html` contains:

```html
<form id="historyAnalysisForm">
  <label>
    <span class="field-label">历史客户发言上限（字符）</span>
    <input
      name="historyCustomerTextMaxChars"
      type="number"
      min="1000"
      max="6000"
      step="100"
      value="4000"
      required
    />
  </label>
</form>
```

Assert that `public/console/app.js` has context-version-safe
`loadHistoryAnalysis` and `saveHistoryAnalysis` functions and calls the new API.

- [ ] **Step 2: Run the boundary test and verify failure**

Run: `node --test tests/console-history-analysis-boundary.test.js`

Expected: FAIL because the setting and panel do not exist.

- [ ] **Step 3: Implement Bot-scoped settings in the server**

Add:

```js
function getHistoryAnalysisSettingKey(botId) {
  return `history_analysis:${String(botId || "").trim()}`;
}

function getHistoryAnalysisConfig(botId) {
  return normalizeHistoryAnalysisConfig(
    getSetting(getHistoryAnalysisSettingKey(botId), null) || {}
  );
}
```

GET returns `getHistoryAnalysisConfig(botId)`. PUT merges the existing setting
and `req.body`, normalizes it, persists it, and returns the normalized value.

- [ ] **Step 4: Add the Config-tab panel**

Add a collapsible `历史智能分析` Bot-context admin panel after
`消息/等待回复`. Use existing panel, field, action, save icon, and compact-form
classes. The button text is `保存历史分析配置`.

- [ ] **Step 5: Wire load, save, reset, and Bot switching**

Add:

```js
historyAnalysisLoadVersion: 0
```

and `els.historyAnalysisForm`. Reset its input to `4000` in
`clearBotScopedContent`. Load it after `loadReplyWait` for an unlocked admin Bot.
On save, replace the input with the server-normalized value and show
`历史智能分析配置已保存`.

- [ ] **Step 6: Add only necessary layout CSS**

Reuse the existing compact form grid. Add a narrow selector only if needed to
keep the numeric field and save action aligned; do not introduce cards inside
the panel.

- [ ] **Step 7: Run Config-tab tests**

Run:

```bash
node --test \
  tests/console-history-analysis-boundary.test.js \
  tests/console-reply-wait-boundary.test.js \
  tests/console-auth-boundary.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit configuration work**

```bash
git add src/server.js public/console/index.html public/console/app.js public/console/styles.css tests/console-history-analysis-boundary.test.js
git commit -m "Configure legacy history analysis per Bot"
```

---

### Task 4: Combined DClaw History, Tag, And Asset Contract

**Files:**
- Modify: `src/dclaw.js`
- Modify: `tests/dclaw-tags.test.js`
- Modify: `tests/dclaw-request-sanitization.test.js`
- Modify: `tests/agent-response-gateway.test.js`

**Interfaces:**
- Extends: `buildDclawRequest({ binding, conversation, message, flow, tagContext, legacyHistoryAnalysis, conversationReset, generalRule })`.
- `legacyHistoryAnalysis` contains `text`, `selectedCount`, `omittedCount`,
  `selectedChars`, and `configuredLimit`.
- Stores only history counts in request metadata; complete history remains in
  the request message string.
- Enables gateway `allowTagDecision` when `request.metadata.tagRules` exists.

- [ ] **Step 1: Rewrite failing DClaw tag/history tests**

For a legacy analysis request, assert:

```js
assert.match(request.message, /客户历史发言（纯文本/);
assert.match(request.message, /我刚刚已经付费了/);
assert.doesNotMatch(request.message, /history_context/);
assert.doesNotMatch(request.message, /"messages":\s*\[/);
assert.match(request.message, /tagDecision/);
assert.equal(request.metadata.historyAnalysis.selectedCount, 1);
assert.equal(request.metadata.historyAnalysis.text, undefined);
assert.ok(request.metadata.tagRules);
```

For a normal request without `legacyHistoryAnalysis`, assert that tag rules and
tag decisions remain absent. This keeps AI history tagging limited to the
one-time legacy flow.

- [ ] **Step 2: Verify the rewritten tests fail**

Run:

```bash
node --test \
  tests/dclaw-tags.test.js \
  tests/dclaw-request-sanitization.test.js \
  tests/agent-response-gateway.test.js
```

Expected: FAIL because the current request builder intentionally strips tag and
legacy context.

- [ ] **Step 3: Restore the optional tag contract**

Change:

```js
function responseSchemaForRequest({ hasFlow, hasTags }) {
  const tagPart = hasTags
    ? ',"tagDecision":{"add":[],"remove":[]}'
    : "";
  return hasFlow
    ? `{"reply":"发给客户的文本","attachments":[],"sources":[],"flowDecision":{"currentNodeId":"当前节点ID","nextNodeId":"建议下一节点ID或当前节点ID","nodeCompleted":false,"confidence":0.0,"reason":"判断原因","collectedDataPatch":{}}${tagPart}}`
    : `{"reply":"发给客户的文本","attachments":[],"sources":[]${tagPart}}`;
}
```

Pass `hasTags` through initial, format-retry, and attachment-source retry
schemas. Add bounded tag guidance only when `tagContext` is present.

- [ ] **Step 4: Append history as plain text**

Add the history section to the instruction string, not the JSON payload:

```text
以下是该客户最近一段历史发言，只用于判断客户意图、标签和已提供资料。
客户历史发言（纯文本，按时间从旧到新）：
${legacyHistoryAnalysis.text}
```

Do not add the text to metadata. Metadata contains only counts and configured
limit so logs and invocation records do not create a second full copy.

- [ ] **Step 5: Preserve all configured asset fields**

Raise the compact flow `collectFields` item limit from 3 to 10 while retaining
the existing per-field character limit. Keep `conversationTips` at its existing
bound by accepting a per-call `maxItems` argument rather than globally
increasing every flow array.

- [ ] **Step 6: Protect the overall request**

Raise `defaultDclawRequestMessageMaxChars` to a bounded value that accommodates
the approved 6000-character history plus current prompt sections (16000
characters). Keep `DCLAW_REQUEST_MESSAGE_MAX_CHARS` as an explicit override.
Verify a maximum-sized history request is either at most the configured total
limit or throws the existing deterministic `DClaw request message is too long`
error; it must not silently remove the history section.

- [ ] **Step 7: Enable strict tag validation only for tagged requests**

Update the server-facing validation options contract so:

```js
allowTagDecision: Boolean(request?.metadata?.tagRules)
tagContext: request?.metadata?.tagRules || null
```

Add gateway coverage proving a known tag passes and an unknown tag fails.

- [ ] **Step 8: Run focused Agent contract tests**

Run:

```bash
node --test \
  tests/dclaw-tags.test.js \
  tests/dclaw-request-sanitization.test.js \
  tests/dclaw-retry.test.js \
  tests/agent-response-gateway.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit the Agent contract**

```bash
git add src/dclaw.js tests/dclaw-tags.test.js tests/dclaw-request-sanitization.test.js tests/agent-response-gateway.test.js
git commit -m "Send bounded legacy history for Agent decisions"
```

---

### Task 5: Apply Tags, Assets, Date Tag, And One-Time State

**Files:**
- Modify: `src/server.js`
- Modify: `src/db.js`
- Modify: `tests/server-legacy-history-boundary.test.js`
- Modify: `tests/server-tags-boundary.test.js`
- Modify: `tests/server-inbound-coalescing-boundary.test.js`
- Modify: `tests/db-legacy-history.test.js`

**Interfaces:**
- Consumes: `legacyCustomerHistory.buildStoredLegacyAnalysis({ botId, conversationKey, maxChars })`.
- Consumes: `getHistoryAnalysisConfig(botId)`.
- Reintroduces: `buildTagContext({ binding, conversationKey })`.
- Reintroduces: `applyAgentTagDecision({ botId, binding, conversationKey, agentReply })`.
- Produces: `applyLegacyHistoryDateTag({ botId, binding, conversationKey, earliestCustomerAt })`.
- Marks: `markLegacyHistoryContextSent({ botId, conversationKey })` only after
  valid tag and flow decisions are processed.

- [ ] **Step 1: Write failing orchestration tests**

Update boundary tests to require this conditional sequence:

```js
const shouldAnalyzeLegacyHistory =
  flow?.session?.customerOrigin === "legacy"
  && flow.session.historySyncStatus === "success"
  && !flow.session.historyContextSentAt;
```

Then require:

1. Read the per-Bot limit.
2. Build the stored legacy analysis.
3. Build tag context.
4. Pass both to `buildDclawRequest`.
5. Apply `tagDecision`.
6. Apply `flowDecision`.
7. Mark context sent only after both applications.

Normal, new-customer, and group requests must pass neither history nor tag
context.

- [ ] **Step 2: Run server boundary tests and verify failure**

Run:

```bash
node --test \
  tests/server-legacy-history-boundary.test.js \
  tests/server-tags-boundary.test.js \
  tests/server-inbound-coalescing-boundary.test.js
```

Expected: FAIL because the current server excludes history and tag decisions.

- [ ] **Step 3: Restore tag context and adjudication helpers**

Use existing APIs:

```js
function buildTagContext({ binding, conversationKey }) {
  const schema = normalizeTagSchema(
    getAgentTagSchema(binding.agentId)?.config || {}
  );
  const currentTags = listConversationTags({
    botId: binding.botId,
    agentId: binding.agentId,
    conversationKey
  });
  return compactTagRulesForAgent({ schema, currentTags });
}
```

`applyAgentTagDecision` must call `adjudicateTagDecision`,
`applyConversationTagChanges`, `cancelTagTasksForAcceptedChanges`, and
`scheduleTagActivationsForAcceptedChanges`. This preserves manual-tag-equivalent
task behavior when AI changes a tag.

- [ ] **Step 4: Assemble history only for the eligible legacy session**

Before `buildDclawRequest`, compute `shouldAnalyzeLegacyHistory`. If true, call:

```js
const historyConfig = getHistoryAnalysisConfig(botId);
const legacyHistoryAnalysis =
  legacyCustomerHistory.buildStoredLegacyAnalysis({
    botId,
    conversationKey,
    maxChars: historyConfig.historyCustomerTextMaxChars
  });
```

Pass the analysis only when `text` is non-empty. Pass tag context only for that
same request.

- [ ] **Step 5: Apply the earliest-history date tag**

Add a DB-level helper or a server helper that:

1. verifies the date tag is enabled;
2. bypasses `effectiveAt` only for the imported legacy timestamp;
3. uses `dateTagIdFor(earliestCustomerAt, cutoffTime)`;
4. calls `upsertSystemDateTag` with source `legacy_history`;
5. remains idempotent.

Add tests proving a historical date earlier than `effectiveAt` still creates
the approved legacy date tag and repeated calls do not duplicate it.

- [ ] **Step 6: Apply validated history decisions**

After strict validation and before marking history complete:

```js
const tagUpdate = shouldAnalyzeLegacyHistory
  ? applyAgentTagDecision({ botId, binding, conversationKey, agentReply })
  : null;
```

Keep the existing `applyFlowDecision` call as the single owner of
`collectedDataPatch` and node transitions. After it succeeds, mark the history
context sent. Do not mark on validation failure, Agent timeout, stale epoch,
send failure, empty reply, or flow-decision failure.

- [ ] **Step 7: Add structured diagnostics**

Log `legacy_history.analysis_prepared` with configured limit, selected chars,
selected count, omitted count, and earliest timestamp. Log
`legacy_history.analysis_applied` with accepted/rejected tag counts and names of
collected-data patch keys. Never log the historical text.

- [ ] **Step 8: Run focused server and DB tests**

Run:

```bash
node --test \
  tests/db-legacy-history.test.js \
  tests/server-legacy-history-boundary.test.js \
  tests/server-tags-boundary.test.js \
  tests/server-inbound-coalescing-boundary.test.js \
  tests/server-tag-activation-boundary.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit orchestration**

```bash
git add src/server.js src/db.js tests/db-legacy-history.test.js tests/server-legacy-history-boundary.test.js tests/server-tags-boundary.test.js tests/server-inbound-coalescing-boundary.test.js
git commit -m "Apply legacy history tags and assets once"
```

---

### Task 6: Full Regression And Operational Verification

**Files:**
- Modify only files required by failures proven to be regressions from Tasks
  1-5.

**Interfaces:**
- Consumes all prior task outputs.
- Produces a release-ready commit series with no unrelated files.

- [ ] **Step 1: Run syntax checks**

```bash
node --check src/history-analysis.js
node --check src/legacy-customer-history.js
node --check src/dclaw.js
node --check src/db.js
node --check src/server.js
node --check public/console/app.js
```

Expected: all commands exit 0.

- [ ] **Step 2: Run the complete test suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 3: Check formatting and scope**

```bash
git diff --check
git status --short
git log --oneline -8
```

Expected: no whitespace errors; only planned files are modified; task commits
are present.

- [ ] **Step 4: Review the final request boundary**

Use a Node test fixture to build a request with:

- 6000 Unicode characters of selected history;
- 10 flow collection fields;
- enabled tag rules;
- a non-empty live message.

Assert the request contains the end of the historical text, includes
`tagDecision` and all 10 `collectFields`, contains no `history_context`, and is
within the effective total request limit.

- [ ] **Step 5: Review the final persistence boundary**

Use database fixtures to prove:

- the earliest historical timestamp creates exactly one date tag;
- accepted AI tags are visible in `listConversationTags`;
- `collectedDataPatch` is visible in the flow session;
- `historyContextSentAt` is set after success;
- a simulated failure leaves `historyContextSentAt` empty.

- [ ] **Step 6: Create a final cleanup commit only if verification required changes**

```bash
git add src/history-analysis.js src/legacy-customer-history.js src/dclaw.js src/db.js src/server.js public/console/index.html public/console/app.js public/console/styles.css tests/history-analysis.test.js tests/legacy-history.test.js tests/legacy-customer-history-service.test.js tests/dclaw-tags.test.js tests/dclaw-request-sanitization.test.js tests/agent-response-gateway.test.js tests/console-history-analysis-boundary.test.js tests/db-legacy-history.test.js tests/server-legacy-history-boundary.test.js tests/server-tags-boundary.test.js tests/server-inbound-coalescing-boundary.test.js
git commit -m "Harden bounded legacy history analysis"
```

Skip this commit when the worktree is already clean.
