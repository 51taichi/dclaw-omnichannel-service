# Tag Sync Terminal Errors And Date Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Treat WorkTool tag-sync business callbacks as terminal and let each Bot exclude customer-added date tags from synchronization by default.

**Architecture:** Extend the existing Bot tag-sync config with `syncDateTags` and persist an explicit `tag_type` on Outbox rows. Registration, initial backfill, and config changes enforce the date-tag policy; the worker treats every type 213 callback as terminal while preserving non-zero callback error text for audit.

**Tech Stack:** Node.js ESM, `node:sqlite`, Express, browser JavaScript, `node:test`.

## Global Constraints

- `同步添加日期标签` defaults to off for new and existing Bots.
- Disabling date synchronization removes pending and failed date rows, but never processing or succeeded rows.
- Re-enabling backfills only currently assigned date tags.
- WorkTool type 213 business errors never retry; transport submission failures and missing callbacks retain existing retry behavior.
- WorkTool error text is stored verbatim; missing text becomes `其他原因（错误码 <code>）`.
- Non-213 callbacks do not enter tag synchronization.
- Customer replies, activation messages, proactive sends, local tag assignment, and nightly scheduling remain unchanged.

---

### Task 1: Persist And Enforce Date Tag Synchronization Policy

**Files:**
- Modify: `src/tag-sync.js`
- Modify: `src/db.js`
- Test: `tests/tag-sync.test.js`
- Test: `tests/db-tag-sync.test.js`

**Interfaces:**
- Consumes: `normalizeTagSyncConfig(config)` and existing `conversation_tags.tag_type` values.
- Produces: `TagSyncConfig.syncDateTags: boolean`; `tag_sync_outbox.tag_type`; policy-aware `registerTagSyncOutboxRows`, `ensureTagSyncInitialBackfill`, and `saveTagSyncConfig`.

- [ ] **Step 1: Write failing normalization and database tests**

Add assertions that defaults return `syncDateTags: false`, saved true/false values persist, date tags are omitted while false, enabling backfills current date tags, and disabling removes only pending/failed date rows.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/tag-sync.test.js tests/db-tag-sync.test.js`

Expected: failures for missing `syncDateTags`, missing schema columns, or date rows still being registered.

- [ ] **Step 3: Implement minimal schema and policy handling**

Add `sync_date_tags INTEGER NOT NULL DEFAULT 0` to `bot_tag_sync_configs`, `tag_type TEXT NOT NULL DEFAULT 'normal'` to `tag_sync_outbox`, and `ensureColumn` migrations. Backfill Outbox tag types from matching `conversation_tags`; pass tag type into registration; filter date tags according to config; clean pending/failed date rows when disabled; and register current date tags on false-to-true changes.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/tag-sync.test.js tests/db-tag-sync.test.js`

Expected: all focused tests pass.

### Task 2: Make WorkTool Business Callbacks Terminal

**Files:**
- Modify: `src/tag-sync-worker.js`
- Modify: `src/db.js`
- Modify: `src/server.js`
- Test: `tests/tag-sync-worker.test.js`
- Test: `tests/db-tag-sync.test.js`
- Test: `tests/server-tag-sync-boundary.test.js`

**Interfaces:**
- Consumes: WorkTool command callback `{ type, errorCode, errorReason, errorMsg, successList, failList }`.
- Produces: `resolveTagSyncCommandCallback({ ..., succeeded: true, error })` where `error` may be a preserved terminal business reason.

- [ ] **Step 1: Write failing worker, database, and server boundary tests**

Assert that a non-zero type 213 callback resolves rows as succeeded, stores the original error text without `next_retry_at`, uses the generic reason when text is absent, and type 203 callbacks are not delegated to the tag-sync worker.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/tag-sync-worker.test.js tests/db-tag-sync.test.js tests/server-tag-sync-boundary.test.js`

Expected: current code marks business errors failed/retryable and delegates type 203 callbacks.

- [ ] **Step 3: Implement terminal callback handling**

For type 213 callbacks, derive `terminalReason` from `errorReason`, then `errorMsg`, then the generic error-code text. Resolve matching rows with `succeeded: true` and preserve `terminalReason` in `last_error`. Gate both server callback routes so only callback type 213 invokes the tag-sync worker.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/tag-sync-worker.test.js tests/db-tag-sync.test.js tests/server-tag-sync-boundary.test.js`

Expected: all focused tests pass and existing transport retry tests remain green.

### Task 3: Add The Bot Configuration Switch

**Files:**
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Test: `tests/console-tag-sync-boundary.test.js`

**Interfaces:**
- Consumes: tag-sync config API property `syncDateTags`.
- Produces: admin-only `#tagSyncDateTagsEnabled` switch labeled `同步添加日期标签`.

- [ ] **Step 1: Write failing console boundary tests**

Assert that the switch exists, defaults unchecked, loads from `config.syncDateTags`, and is included in the save payload without being disabled by the nightly automation switch.

- [ ] **Step 2: Run the console test and verify RED**

Run: `node --test tests/console-tag-sync-boundary.test.js`

Expected: failure because the switch and client binding do not exist.

- [ ] **Step 3: Implement the switch with existing compact toggle styles**

Place the toggle in the tag-sync configuration grid, bind it in the element map, load it in `applyTagSyncConfig`, and save it in `saveTagSyncConfig` as `syncDateTags`.

- [ ] **Step 4: Run focused and full verification**

Run: `node --test tests/console-tag-sync-boundary.test.js`

Run: `npm test`

Run: `git diff --check`

Expected: focused and full suites pass with no whitespace errors.

- [ ] **Step 5: Commit and push**

Commit implementation and tests to `main`, then push `origin/main` without including unrelated local files.
