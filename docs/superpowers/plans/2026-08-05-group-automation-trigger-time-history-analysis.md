# Group Automation Trigger-Time History Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the group fact-ledger implementation with complete raw group-history storage in DClaw and trigger-time Agent analysis for conditional pushes and periodic summaries, while preserving exact conditional content, reliable delivery, evidence navigation, and bounded long-history processing.

**Architecture:** DClaw gains an append-only, publication-scoped group-history API that never invokes an Agent. WorkTool canonically exports its local group messages to that history, creates durable occurrences ten minutes before target time, analyzes the fixed historical window through bounded transcript chunks, freezes one final decision/content at target time, and sends it through an ambiguity-safe state machine. The existing fact ledger, aggregate variables, live condition state, and `group-ledger` Agent path are removed only after history compatibility, backfill, and executor cutover are verified.

**Tech Stack:** Node.js ESM, built-in `node:test`, Express 5, SQLite through the existing WorkTool adapter, vanilla HTML/CSS/JavaScript, Python 3, FastAPI, Pydantic, SQLAlchemy/SQLite, pytest, DClaw Open API, WorkTool type-203 group sends.

## Global Constraints

- Both repositories stay on `main`; every independently passing task is committed and pushed to its own `origin/main` before continuing.
- All cycle and target-time calculations use `Asia/Shanghai`; the history upper bound is the immutable scheduled target instant `T`, not worker start or completion time.
- DClaw group-history append is storage-only: it must not create a chat message, run, Agent invocation, or token charge.
- The deployed DClaw publication and WorkTool API key must both allow `messages:create` and `messages:read`; missing read capability blocks group-task execution instead of degrading to partial history.
- WorkTool `conversation_messages` remains the UI, evidence, and audit authority; DClaw stores the Agent-readable history view.
- Every exported DClaw history item uses a stable WorkTool local message identity and is idempotent.
- Canonical export must preserve real repeated messages while suppressing the same WorkTool message imported through a second source; sync cursors advance over both exported and deliberately skipped duplicate rows.
- History records preserve occurred time, stable participant identity when available, sender name, direction, source, message type, content/transcript, and opaque metadata; group background and role configuration remain execution context, not customer-visible history.
- Conditional push requires a non-empty natural-language condition. At `T`, Agent output is only `achieved`, a concise decision note, and exact evidence message IDs. When achieved, WorkTool sends the configured content verbatim; the Agent cannot rewrite it or add mentions. When not achieved, nothing is sent.
- An achieved conditional result must cite at least one supplied message. A not-achieved result may have an empty evidence list when the objective fact is the absence of a qualifying event in the complete frozen interval.
- Periodic summary has no condition and is business-mandatory. Its template is a natural-language structure and statistical instruction; the Agent writes the final truthful review. Sparse history may produce a concise “本周期暂无明确记录” style review, but fabrication is forbidden. Technical failure never produces a customer-visible fallback.
- The default analysis range is the current natural day/week/month start through `T`. Template or condition wording that explicitly requests “累计 / 至今 / 从建群”等全量语义 may widen only the relevant analysis scope to group creation through `T`.
- Transcript lines use `M001｜2026-08-05 09:30:00｜P1｜text｜content`; participant names and roles appear once in a header. `Mxxx` must map exactly to a WorkTool `conversation_messages.id` for evidence validation.
- Existing OCR/transcript text may be analyzed. This change does not add media downloading, OCR, speech recognition, or attachment parsing.
- Short history uses one Agent analysis. Long history uses deterministic, full-coverage chunks, task-specific ephemeral chunk outputs, recursive bounded merge, and target-time delta processing. No chunk output becomes a reusable business ledger.
- Failed analysis retries only the failed stage, with one initial attempt plus two retries. Completed chunks are checkpointed and never rerun unless their frozen configuration version changes.
- Multiple trigger days within the same natural week/month remain independent occurrences; they may read overlapping history but never share a mutable cycle result.
- An occurrence is unique by `(task_id, scheduled_for)`, has a lease and heartbeat, and resumes after restart. Occurrences for the same task execute serially.
- The task configuration is snapshotted at `T-10m`. Creation or editing less than ten minutes before the next target skips that target and schedules the next eligible occurrence.
- At `T`, the executor syncs and analyzes only the delta from preanalysis cutoff through `T`, then freezes the final decision/content. Messages after `T` never affect that occurrence.
- If preanalysis overruns `T`, it continues from checkpoints, then processes the fixed cutoff-to-`T` delta and records the delay; it never expands the upper bound to its late completion time.
- WorkTool explicit send failures retry the same frozen payload at most twice. An ambiguous transport result is never retried automatically and becomes `send_unknown` until manual confirmation.
- The UI business statuses are `倒计时`, `执行中`, `已发送`, `未发送`, `执行失败`, and `发送待确认`. It must not display live `已达成/尚未达成/判断暂不可用` before trigger time.
- Internal stages are `queued → reading_history → analyzing_chunks → waiting_target → synthesizing → ready_to_send → sending → sent | not_sent | failed | send_unknown`.
- Agent prompts and output validation must prohibit disclosure of group background, role configuration, system prompts, history tools, internal decision notes, or implementation details.
- The console must not display a standing “提前十分钟分析” explanation; the ten-minute window is an internal scheduling rule.
- Existing private-chat task state, assets, tags, handoff, replies, and private DClaw history are untouched.
- Every WorkTool task, occurrence, sync, history, and evidence query is constrained by the bound workspace/publication, Bot ID, and stable group ID. Group names are display/address data, never authorization keys.
- Structured logs record counts, cursors, ranges, stages, retries, model calls, delays, send resolution, and operator actions, but never full group background, role descriptions, prompts, or unnecessary complete message bodies.
- Physical ledger-table cleanup is gated on DClaw capability readiness and successful history backfill; an unsafe deployment must disable new group-task execution rather than silently fall back to the old ledger.

---

## File Map

### DClaw — new production files

- `src/qwenpaw/app/storage/repos/open_api_group_history_repo.py` — dual SQLAlchemy/SQLite append and keyset-read repository.
- `src/qwenpaw/app/routers/open_api_group_history.py` — authenticated storage-only history endpoints.

### DClaw — modified production files

- `src/qwenpaw/app/open_api/models.py` — history request, response, and page models.
- `src/qwenpaw/app/storage/schema.py` — SQLAlchemy history tables and indexes.
- `src/qwenpaw/app/db.py` — SQLite-compatible history tables and indexes.
- `src/qwenpaw/app/auth.py` — method-aware Open API scope selection for history reads/writes.
- `src/qwenpaw/app/routers/__init__.py` — mount the group-history router.

### DClaw — new/modified tests

- `tests/unit/app/storage/repos/test_open_api_group_history_repo.py`
- `tests/unit/app/test_open_api_group_history_router.py`
- `tests/unit/app/test_open_api_auth.py`
- `tests/unit/app/test_open_api_router.py`

### WorkTool — new production files

- `src/dclaw-group-history.js` — stable group-history identity plus append/page client.
- `src/group-history-sync-worker.js` — durable canonical backfill and incremental sync.
- `src/group-history-transcript.js` — participant dictionary, evidence IDs, token estimate, deterministic chunk packing.

### WorkTool — modified production files

- `src/db.js` — history-sync state, canonical export queries, staged occurrences, chunk checkpoints, attempts, snapshots, cleanup gate.
- `src/dclaw.js` — bounded task-analysis request transport; remove `group-ledger` purpose.
- `src/group-automation-agent.js` — chunk, merge, final conditional/summary contracts and confidentiality validation.
- `src/group-automation-schedule.js` — ten-minute eligibility and immutable target semantics.
- `src/group-automation-task-state.js` — new business and operational states.
- `src/group-summary-template.js` — natural-language template validation and scope-intent detection, no mechanical variable rendering.
- `src/group-automation-worker.js` — trigger-time phase orchestration, fixed-window analysis, frozen send payload, stage retry/resume.
- `src/server.js` — sync wakeups, capability guard, routes, serialization, manual delivery confirmation, worker timers.
- `public/console/group-automation-status.js` — new status labels and countdown rules.
- `public/console/app.js` — task form, cards, conversation summary, run detail, evidence navigation, removal of live judgment UI.
- `public/console/styles.css` — stable card/detail states and responsive execution detail.
- `README.md` — raw-history architecture, operations, deployment order, removed ledger settings.

### WorkTool — new/modified tests

- `tests/dclaw-group-history.test.js`
- `tests/db-group-history-sync.test.js`
- `tests/group-history-sync-worker.test.js`
- `tests/group-history-transcript.test.js`
- `tests/db-group-automation.test.js`
- `tests/group-automation-schedule.test.js`
- `tests/group-automation-agent.test.js`
- `tests/group-automation-worker.test.js`
- `tests/group-automation-large-ledger.test.js` (rename to `tests/group-automation-long-history.test.js`)
- `tests/group-summary-template.test.js`
- `tests/group-automation-display-status.test.js`
- `tests/server-group-automation-boundary.test.js`
- `tests/server-group-conversation-task-summary-boundary.test.js`
- `tests/console-group-automation-boundary.test.js`
- `tests/conversation-message-dedupe.test.js`

---

### Task 1: DClaw durable group-history repository

**Repository:** `/Users/moxi/Desktop/codex space/dclaw-server`

**Files:**
- Create: `src/qwenpaw/app/storage/repos/open_api_group_history_repo.py`
- Modify: `src/qwenpaw/app/storage/schema.py`
- Modify: `src/qwenpaw/app/db.py`
- Create: `tests/unit/app/storage/repos/test_open_api_group_history_repo.py`

- [ ] **Step 1: Write failing repository tests**

Cover publication/group isolation, append idempotency by `external_message_id`, exact preservation of participant/time/type/content, chronological `(occurred_at, id)` ordering, `[from, until]` bounds, opaque keyset pagination, and SQLAlchemy/SQLite parity.

```python
def test_append_is_idempotent_and_pages_in_event_order(group_history_repo, publication):
    first = group_history_repo.append_messages(
        publication_id=publication.id,
        external_group_id="wtg_abc",
        messages=[history_message("wt-message-9", "2026-08-05T01:00:00Z", "张三")],
    )
    second = group_history_repo.append_messages(
        publication_id=publication.id,
        external_group_id="wtg_abc",
        messages=[history_message("wt-message-9", "2026-08-05T01:00:00Z", "张三")],
    )
    assert first.inserted == 1
    assert second.inserted == 0
    assert second.duplicates == 1
    page = group_history_repo.list_messages(
        publication_id=publication.id,
        external_group_id="wtg_abc",
        from_at=None,
        until_at="2026-08-05T02:00:00Z",
        after=None,
        limit=100,
    )
    assert [item.external_message_id for item in page.messages] == ["wt-message-9"]
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `python -m pytest tests/unit/app/storage/repos/test_open_api_group_history_repo.py -q`

Expected: FAIL because the repository and schema do not exist.

- [ ] **Step 3: Add SQLAlchemy and SQLite schema**

Create `open_api_group_histories` with unique `(publication_id, external_group_id)` and `open_api_group_history_messages` with unique `(history_id, external_message_id)`. Add indexes on `(history_id, occurred_at, id)` and publication foreign keys in both schema paths.

- [ ] **Step 4: Implement the dual-backend repository**

```python
class OpenApiGroupHistoryRepository(Protocol):
    def append_messages(
        self,
        *,
        publication_id: int,
        external_group_id: str,
        messages: Sequence[GroupHistoryMessageRecord],
    ) -> AppendGroupHistoryResult: ...

    def list_messages(
        self,
        *,
        publication_id: int,
        external_group_id: str,
        from_at: datetime | None,
        until_at: datetime | None,
        after: str | None,
        limit: int,
    ) -> GroupHistoryPageRecord: ...
```

Encode cursors as URL-safe base64 JSON containing `occurred_at` and row `id`; reject malformed or cross-history cursors. `append_messages` uses insert-ignore semantics and never updates an existing immutable record.

- [ ] **Step 5: Run repository tests**

Run: `python -m pytest tests/unit/app/storage/repos/test_open_api_group_history_repo.py -q`

Expected: PASS.

- [ ] **Step 6: Commit and push DClaw**

```bash
git add src/qwenpaw/app/storage/schema.py src/qwenpaw/app/db.py src/qwenpaw/app/storage/repos/open_api_group_history_repo.py tests/unit/app/storage/repos/test_open_api_group_history_repo.py
git commit -m "feat: add durable open api group history storage"
git push origin main
```

---

### Task 2: DClaw storage-only group-history Open API

**Repository:** `/Users/moxi/Desktop/codex space/dclaw-server`

**Files:**
- Create: `src/qwenpaw/app/routers/open_api_group_history.py`
- Modify: `src/qwenpaw/app/open_api/models.py`
- Modify: `src/qwenpaw/app/auth.py`
- Modify: `src/qwenpaw/app/routers/__init__.py`
- Create: `tests/unit/app/test_open_api_group_history_router.py`
- Modify: `tests/unit/app/test_open_api_auth.py`
- Modify: `tests/unit/app/test_open_api_router.py`

- [ ] **Step 1: Write failing endpoint and auth tests**

Test these exact endpoints:

```text
POST /api/open/v1/targets/{public_id}/group-histories/{external_group_id}/messages
GET  /api/open/v1/targets/{public_id}/group-histories/{external_group_id}/messages
```

POST requires `messages:create`; GET requires `messages:read`. The FastAPI router itself remains rooted at `/open/v1` and the application mounts it below `/api`. Test 1–200 append limit, a bounded total request body, timezone-aware timestamps, 1–500 page limit, idempotent counters, range filters, inaccessible publication, malformed cursor, and a spy proving no runtime/chat/Agent method is invoked.

- [ ] **Step 2: Run tests and confirm 404/model failures**

Run: `python -m pytest tests/unit/app/test_open_api_group_history_router.py tests/unit/app/test_open_api_auth.py -q`

- [ ] **Step 3: Add strict Pydantic models**

```python
class GroupHistoryMessageInput(BaseModel):
    external_message_id: str = Field(min_length=1, max_length=160)
    occurred_at: datetime
    sender_id: str = Field(default="", max_length=200)
    sender_name: str = Field(min_length=1, max_length=300)
    participant_role_id: str = Field(default="", max_length=160)
    direction: Literal["inbound", "outbound"]
    source: str = Field(min_length=1, max_length=100)
    message_type: str = Field(min_length=1, max_length=80)
    content: str = Field(default="", max_length=20000)
    metadata: dict[str, Any] = Field(default_factory=dict)

class AppendGroupHistoryRequest(BaseModel):
    messages: list[GroupHistoryMessageInput] = Field(min_length=1, max_length=200)
```

Add a model-level serialized-content bound of 1.5 MB so one nominally valid 200-message batch cannot exhaust the API worker.

- [ ] **Step 4: Implement router and method-aware scope selection**

Resolve `public_id` through the existing publication/key path. Call only the group-history repository. Normalize datetimes to UTC in responses. Extend the auth middleware so GET history routes require `messages:read`, while POST history and message invocation retain `messages:create`.

- [ ] **Step 5: Run DClaw Open API tests**

Run: `python -m pytest tests/unit/app/test_open_api_group_history_router.py tests/unit/app/test_open_api_auth.py tests/unit/app/test_open_api_router.py -q`

Expected: PASS.

- [ ] **Step 6: Commit and push DClaw**

```bash
git add src/qwenpaw/app/open_api/models.py src/qwenpaw/app/auth.py src/qwenpaw/app/routers/__init__.py src/qwenpaw/app/routers/open_api_group_history.py tests/unit/app/test_open_api_group_history_router.py tests/unit/app/test_open_api_auth.py tests/unit/app/test_open_api_router.py
git commit -m "feat: expose storage only group history api"
git push origin main
```

---

### Task 3: WorkTool DClaw group-history client and capability probe

**Repository:** `/Users/moxi/Desktop/codex space/agent create/worktool-bot-service`

**Files:**
- Create: `src/dclaw-group-history.js`
- Modify: `src/dclaw-conversation-identity.js`
- Create: `tests/dclaw-group-history.test.js`

- [ ] **Step 1: Write failing client tests**

Test stable ASCII group IDs, URL encoding, Authorization propagation, append batches, page cursors, capability probe behavior for 2xx/401/404/5xx, timeout/retry bounds, and response validation.

```js
assert.equal(
  buildDclawGroupHistoryId({ botId: "bot-1", groupId: "群/AAA" }),
  buildDclawGroupHistoryId({ botId: "bot-1", groupId: "群/AAA" })
);
await appendDclawGroupHistory({
  binding,
  externalGroupId: "wtg_deadbeef",
  messages: [{ externalMessageId: "wt-message-7", occurredAt: "2026-08-05T01:00:00.000Z", senderName: "张三", direction: "inbound", source: "local", messageType: "text", content: "完成了" }],
  fetchImpl
});
```

- [ ] **Step 2: Run and confirm missing module failure**

Run: `node --test tests/dclaw-group-history.test.js`

- [ ] **Step 3: Implement identity, append, list, and probe**

```js
export function buildDclawGroupHistoryId({ botId, groupId }) {}
export async function probeDclawGroupHistoryCapability({ binding, fetchImpl, signal }) {}
export async function appendDclawGroupHistory({ binding, externalGroupId, messages, fetchImpl, signal }) {}
export async function listDclawGroupHistory({ binding, externalGroupId, from, until, after, limit = 500, fetchImpl, signal }) {}
```

Derive the history URL from the bound `agentApiUrl` target URL; do not accept a separately configurable host. Split append batches by both 200 records and 1 MB serialized payload. Whitelist only source identifiers, file name/type, and already-produced OCR/transcript metadata; never copy the complete raw webhook payload or private group configuration. Retry only explicit retryable network/5xx failures. A 403 identifies missing publication/key scope, and a 404 identifies unavailable capability; both block group-task cutover.

- [ ] **Step 4: Run client tests**

Run: `node --test tests/dclaw-group-history.test.js`

- [ ] **Step 5: Commit and push WorkTool**

```bash
git add src/dclaw-group-history.js src/dclaw-conversation-identity.js tests/dclaw-group-history.test.js
git commit -m "feat: add dclaw group history client"
git push origin main
```

---

### Task 4: Canonical WorkTool history export and durable sync state

**Repository:** `/Users/moxi/Desktop/codex space/agent create/worktool-bot-service`

**Files:**
- Modify: `src/db.js`
- Modify: `src/conversation-message-dedupe.js`
- Create: `tests/db-group-history-sync.test.js`
- Modify: `tests/conversation-message-dedupe.test.js`

- [ ] **Step 1: Write failing DB tests**

Cover Bot/group isolation, lease claim/heartbeat/retry, source cursor advancement, through-ID cutoff, group deletion, and canonical duplicate behavior across page boundaries. Specifically test a local message followed later by its imported history copy: only the canonical row exports, but the cursor advances past both rows. Two genuine identical local messages remain two records.

- [ ] **Step 2: Run focused DB tests**

Run: `node --test tests/db-group-history-sync.test.js tests/conversation-message-dedupe.test.js`

- [ ] **Step 3: Add sync schema and row APIs**

Add `managed_group_history_sync_states` keyed by `(bot_id, group_id)` with `synced_through_message_id`, `status`, `attempts`, `next_retry_at`, lease owner/expiry, heartbeat, last error, and timestamps.

```js
export function getLatestGroupConversationMessageIdAtOrBefore({ botId, groupId, until }) {}
export function claimGroupHistorySyncJobs({ owner, now, leaseMs, limit }) {}
export function heartbeatGroupHistorySyncJob({ botId, groupId, owner, now, leaseMs }) {}
export function listCanonicalGroupMessagesForHistory({ botId, groupId, afterMessageId, throughMessageId, limit }) {}
export function completeGroupHistorySyncBatch({ botId, groupId, owner, syncedThroughMessageId, now, hasMore }) {}
export function failGroupHistorySyncJob({ botId, groupId, owner, error, nextRetryAt, now }) {}
```

`listCanonicalGroupMessagesForHistory` reads the requested ID page plus the existing ±10-second candidates needed by `dedupeConversationMessages`; it exports only the deterministic winner and returns `processedThroughMessageId` for skipped rows. Export identity is `wt-message-${row.id}`.

- [ ] **Step 4: Run DB tests**

Run: `node --test tests/db-group-history-sync.test.js tests/conversation-message-dedupe.test.js`

- [ ] **Step 5: Commit and push**

```bash
git add src/db.js src/conversation-message-dedupe.js tests/db-group-history-sync.test.js tests/conversation-message-dedupe.test.js
git commit -m "feat: add canonical group history sync state"
git push origin main
```

---

### Task 5: History backfill and incremental sync worker

**Repository:** `/Users/moxi/Desktop/codex space/agent create/worktool-bot-service`

**Files:**
- Create: `src/group-history-sync-worker.js`
- Modify: `src/server.js`
- Create: `tests/group-history-sync-worker.test.js`
- Modify: `tests/server-group-automation-boundary.test.js`

- [ ] **Step 1: Write failing worker tests**

Test initial backfill, incremental wake after inbound/outbound persistence, 200-item/1-MB DClaw batches, skipped duplicate advancement, partial append recovery, lease loss, missing DClaw binding, capability 403/404, sync-lag structured logs, redaction of message bodies from logs, and `ensureSyncedThrough({ throughMessageId })` blocking until the exact cutoff has been processed.

- [ ] **Step 2: Run and confirm failure**

Run: `node --test tests/group-history-sync-worker.test.js tests/server-group-automation-boundary.test.js`

- [ ] **Step 3: Implement injected sync worker**

```js
export function createGroupHistorySyncWorker({
  db,
  resolveDclawBinding,
  probeCapability,
  appendHistory,
  now = () => new Date(),
  logger = console
}) {
  return {
    wake({ botId, groupId }),
    runTick({ owner, limit }),
    ensureSyncedThrough({ botId, groupId, throughMessageId, deadlineAt })
  };
}
```

The worker reads only local persisted messages. It does not poll WorkTool group APIs and never invokes an Agent. Map sender role IDs when a configured role matches, but retain raw sender name and pass current role configuration again at task execution.

- [ ] **Step 4: Wire backfill and write wakeups**

On startup, enqueue every managed group. After every group `insertConversationMessage`, call `wake` without awaiting. Add one bounded DB job timer; do not add WorkTool polling. Expose readiness internally so group automation refuses execution until DClaw history capability is available.

- [ ] **Step 5: Run tests**

Run: `node --test tests/group-history-sync-worker.test.js tests/server-group-automation-boundary.test.js`

- [ ] **Step 6: Commit and push**

```bash
git add src/group-history-sync-worker.js src/server.js tests/group-history-sync-worker.test.js tests/server-group-automation-boundary.test.js
git commit -m "feat: synchronize complete group history to dclaw"
git push origin main
```

---

### Task 6: Durable trigger-time occurrence state machine

**Repository:** `/Users/moxi/Desktop/codex space/agent create/worktool-bot-service`

**Files:**
- Modify: `src/db.js`
- Modify: `src/group-automation-schedule.js`
- Modify: `src/group-automation-task-state.js`
- Modify: `tests/db-group-automation.test.js`
- Modify: `tests/group-automation-schedule.test.js`

- [ ] **Step 1: Write failing state and schedule tests**

Test: conditional condition required; periodic summary condition absent; a task created/edited under ten minutes skips the imminent target; occurrence is created at `T-10m` but retains `scheduledFor=T`; configuration and mentions are frozen in `taskSnapshot`; same-task occurrences are serial; expired leases resume the current stage; unique `(task_id, scheduled_for)` prevents duplicates; status transitions reject regressions.

- [ ] **Step 2: Run focused tests**

Run: `node --test tests/db-group-automation.test.js tests/group-automation-schedule.test.js`

- [ ] **Step 3: Extend schedule eligibility**

```js
export function nextGroupAutomationRunAt(schedule, afterIso, { minimumLeadMs = 0 } = {}) {}
```

Creation/edit calls use `minimumLeadMs: 600_000`. Advancing after a completed occurrence calculates from the previous scheduled target without adding another lead window.

- [ ] **Step 4: Add occurrence stage/checkpoint schema**

Add immutable snapshot, `history_start_at`, `history_end_at`, `preanalysis_cutoff_at`, `stage`, stage attempts, heartbeat, decision note, evidence IDs, frozen payload, delivery state, actual start/completion, delay, and retry metadata. Add `managed_group_automation_chunks` keyed by occurrence/stage/level/ordinal/input hash and `managed_group_automation_attempts` for operator-visible failures.

```js
export function claimPreparatoryGroupAutomationOccurrences({ owner, now, prepareBeforeMs, leaseMs, limit }) {}
export function saveGroupAutomationChunkCheckpoint({ occurrenceId, stage, level, ordinal, inputHash, result, evidenceMessageIds, now }) {}
export function transitionGroupAutomationOccurrence({ occurrenceId, owner, fromStages, toStage, patch, now }) {}
export function heartbeatGroupAutomationOccurrence({ occurrenceId, owner, now, leaseMs }) {}
```

- [ ] **Step 5: Run DB/schedule tests**

Run: `node --test tests/db-group-automation.test.js tests/group-automation-schedule.test.js`

- [ ] **Step 6: Commit and push**

```bash
git add src/db.js src/group-automation-schedule.js src/group-automation-task-state.js tests/db-group-automation.test.js tests/group-automation-schedule.test.js
git commit -m "refactor: add trigger time group occurrence stages"
git push origin main
```

---

### Task 7: Compact transcripts and strict Agent contracts

**Repository:** `/Users/moxi/Desktop/codex space/agent create/worktool-bot-service`

**Files:**
- Create: `src/group-history-transcript.js`
- Modify: `src/group-automation-agent.js`
- Modify: `src/dclaw.js`
- Modify: `src/group-summary-template.js`
- Create: `tests/group-history-transcript.test.js`
- Modify: `tests/group-automation-agent.test.js`
- Modify: `tests/dclaw-retry.test.js`
- Modify: `tests/group-summary-template.test.js`

- [ ] **Step 1: Write failing transcript tests**

Test stable participant codes, escaped separators/newlines, chronological message codes, exact ID lookup, empty/non-text records, safe request budget below DClaw's current request limit, deterministic chunk boundaries, full coverage without overlap/gaps, and cumulative-scope detection.

```js
const built = buildCompactGroupTranscript({ messages, roles, groupBackground });
assert.match(built.header, /P1｜张三｜客户｜家长/);
assert.equal(built.lines[0], "M001｜2026-08-05 09:30:00｜P1｜text｜作业已提交");
assert.equal(built.evidenceMap.M001, 42);
assert.deepEqual(packTranscriptChunks(built, { maxRequestChars: 12_000 }).flatMap(x => x.messageIds), [42]);
```

- [ ] **Step 2: Write failing Agent contract tests**

Cover chunk extraction, recursive merge, conditional final JSON, summary final JSON, evidence IDs outside the supplied transcript, fixed-content immutability, sparse summary, malicious “透露群背景” prompts, model output containing internal metadata, bounded repair, malformed JSON, and first attempt plus two retries.

- [ ] **Step 3: Run tests and confirm old ledger assumptions fail**

Run: `node --test tests/group-history-transcript.test.js tests/group-automation-agent.test.js tests/group-summary-template.test.js tests/dclaw-retry.test.js`

- [ ] **Step 4: Implement transcript and scope helpers**

```js
export function buildCompactGroupTranscript({ messages, roles, groupBackground, startCode = 1 }) {}
export function estimateGroupAnalysisRequestChars({ systemContext, taskContext, transcript }) {}
export function packTranscriptChunks(transcript, { maxRequestChars = 12_000 }) {}
export function detectGroupAutomationHistoryScope({ taskType, conditionText, summaryTemplate }) {}
```

Treat the 12,000-character payload as a conservative application budget beneath the existing 16,000/20,000 transport limits; validate actual serialized request length before every call.

- [ ] **Step 5: Replace ledger/variable contracts**

```js
export async function analyzeGroupHistoryChunk({ task, group, roles, transcriptChunk, signal }) {}
export async function mergeGroupHistoryAnalyses({ task, group, roles, partials, level, signal }) {}
export async function finalizeConditionalPush({ task, group, roles, analyses, deltaAnalysis, signal }) {}
export async function finalizePeriodicSummary({ task, group, roles, analyses, deltaAnalysis, signal }) {}
export function validateCustomerVisibleGroupAutomationContent({ content, forbiddenContext }) {}
```

Conditional final shape:

```json
{"achieved":true,"decisionNote":"客户于今日 18:31 明确提交作业","evidenceMessageCodes":["M042"]}
```

Summary final shape:

```json
{"content":"本周完成 2 次课程……","decisionNote":"按已完成课程与作业记录汇总","evidenceMessageCodes":["M012","M042"]}
```

Remove `group-ledger` from allowed DClaw purposes. Give each occurrence/chunk/merge call a unique deterministic external session identity so parallel histories cannot contaminate one another.

- [ ] **Step 6: Run contract tests**

Run: `node --test tests/group-history-transcript.test.js tests/group-automation-agent.test.js tests/group-summary-template.test.js tests/dclaw-retry.test.js`

- [ ] **Step 7: Commit and push**

```bash
git add src/group-history-transcript.js src/group-automation-agent.js src/dclaw.js src/group-summary-template.js tests/group-history-transcript.test.js tests/group-automation-agent.test.js tests/group-summary-template.test.js tests/dclaw-retry.test.js
git commit -m "refactor: analyze group tasks from bounded raw history"
git push origin main
```

---

### Task 8: Preanalysis, target-time delta, and recursive long-history execution

**Repository:** `/Users/moxi/Desktop/codex space/agent create/worktool-bot-service`

**Files:**
- Rewrite: `src/group-automation-worker.js`
- Modify: `tests/group-automation-worker.test.js`
- Rename: `tests/group-automation-large-ledger.test.js` → `tests/group-automation-long-history.test.js`

- [ ] **Step 1: Write failing phase orchestration tests**

Test one-call short history; full-coverage long history; recursively merged partials; only failed chunk retried; crash/restart resumes checkpoints; heartbeat prevents theft; config snapshot immutability; preanalysis cutoff; no finalization before `T`; delta through exactly `T`; after-`T` exclusion; cumulative range; conditional false; mandatory sparse summary; no send on technical failure; and structured metrics for message count, estimated token/characters, chunks, covered range, stage durations, model calls, retries, and target delay without sensitive prompt/context bodies.

- [ ] **Step 2: Run tests and observe ledger-worker failures**

Run: `node --test tests/group-automation-worker.test.js tests/group-automation-long-history.test.js`

- [ ] **Step 3: Implement phased occurrence processing**

```js
export function createGroupAutomationWorker({
  db,
  historySyncWorker,
  listDclawHistory,
  analyzeChunk,
  mergeAnalyses,
  finalizeConditional,
  finalizeSummary,
  sendGroupMessage,
  now = () => new Date(),
  logger = console
}) {
  return {
    recoverExpiredLeases(),
    runOccurrenceTick({ owner, limit }),
    processOccurrence({ occurrenceId, owner })
  };
}
```

Processing algorithm:

1. Resolve the frozen history range and latest local cutoff ID.
2. `ensureSyncedThrough` that ID, then page DClaw history for the exact interval.
3. Build the compact transcript and either analyze once or persist deterministic chunk results.
4. Recursively merge partials until one bounded preanalysis result remains.
5. Set `waiting_target` without holding a lease continuously.
6. At `T`, sync/read `(preanalysisCutoff, T]`, analyze only that delta, then perform final synthesis.
7. Validate evidence codes against the frozen transcript map and persist WorkTool message IDs.
8. Freeze the exact send payload before entering delivery stages.

- [ ] **Step 4: Add ephemeral cleanup and retry tests**

Delete chunk bodies after the configured retention period only when the occurrence has reached a terminal state; preserve final decision/content/evidence/attempt audit. Retry schedules target a named stage and keep successful chunk hashes.

- [ ] **Step 5: Run worker tests**

Run: `node --test tests/group-automation-worker.test.js tests/group-automation-long-history.test.js`

- [ ] **Step 6: Commit and push**

```bash
git add src/group-automation-worker.js tests/group-automation-worker.test.js tests/group-automation-long-history.test.js
git rm tests/group-automation-large-ledger.test.js
git commit -m "refactor: execute group tasks at target time from history"
git push origin main
```

---

### Task 9: Frozen delivery, ambiguity handling, and manual resolution

**Repository:** `/Users/moxi/Desktop/codex space/agent create/worktool-bot-service`

**Files:**
- Modify: `src/group-automation-worker.js`
- Modify: `src/db.js`
- Modify: `src/server.js`
- Modify: `tests/group-automation-worker.test.js`
- Modify: `tests/server-group-automation-boundary.test.js`

- [ ] **Step 1: Write failing delivery tests**

Test exact conditional content, summary frozen content, native multi-role `atList`, one initial send plus two retries for explicit failure, no regeneration between retries, no auto retry for timeout/ambiguous response, callback confirmation, manual “已送达” and “确认未送达并重试”, idempotent manual actions, and outbound conversation insertion only after confirmed delivery.

- [ ] **Step 2: Run focused tests**

Run: `node --test tests/group-automation-worker.test.js tests/server-group-automation-boundary.test.js`

- [ ] **Step 3: Implement durable delivery resolution**

```js
export function markGroupAutomationSendUnknown({ occurrenceId, owner, transportReference, error, now }) {}
export function confirmGroupAutomationDelivery({ botId, occurrenceId, delivered, operatorId, now }) {}
export function prepareManualGroupAutomationRetry({ botId, occurrenceId, operatorId, now }) {}
```

Manual retry is legal only after the operator explicitly marks the ambiguous send as not delivered. It reuses the stored payload and mentions. It cannot invoke the Agent.

- [ ] **Step 4: Add server routes**

```text
POST /api/bots/:botId/groups/:groupId/automation-occurrences/:occurrenceId/confirm-delivery
POST /api/bots/:botId/groups/:groupId/automation-occurrences/:occurrenceId/confirm-not-delivered-and-retry
```

Both routes verify workspace, Bot, group, and occurrence ownership plus terminal-stage preconditions, and persist the authenticated operator identity and action timestamp.

- [ ] **Step 5: Run delivery tests**

Run: `node --test tests/group-automation-worker.test.js tests/server-group-automation-boundary.test.js`

- [ ] **Step 6: Commit and push**

```bash
git add src/group-automation-worker.js src/db.js src/server.js tests/group-automation-worker.test.js tests/server-group-automation-boundary.test.js
git commit -m "feat: harden group task delivery resolution"
git push origin main
```

---

### Task 10: Server serialization, evidence, and capability cutover

**Repository:** `/Users/moxi/Desktop/codex space/agent create/worktool-bot-service`

**Files:**
- Modify: `src/server.js`
- Modify: `src/db.js`
- Modify: `tests/server-group-automation-boundary.test.js`
- Modify: `tests/server-group-conversation-task-summary-boundary.test.js`
- Modify: `tests/group-automation-stream.test.js`

- [ ] **Step 1: Write failing API tests**

Assert task responses no longer expose cycle facts, live achieved state, variables, ledger refresh, or ledger errors. Assert countdown/operational status, last run, target/actual/delay, decision note, frozen content, evidence IDs, retry history, and send-unknown actions. Test evidence lookup around a message not loaded in the current conversation page.

- [ ] **Step 2: Run tests**

Run: `node --test tests/server-group-automation-boundary.test.js tests/server-group-conversation-task-summary-boundary.test.js tests/group-automation-stream.test.js`

- [ ] **Step 3: Replace task serializer and routes**

Remove calls to `getGroupAutomationCycleState`, ledger refresh enqueue, and ledger evidence tables. Resolve evidence exclusively through `conversation_messages` and the existing around-anchor endpoint. Keep SSE task snapshots but emit only the new task/run state.

- [ ] **Step 4: Add hard capability guard**

Task creation/update may persist configuration while capability is unavailable, but execution is disabled with an operator-visible technical reason. The executor must never fall back to legacy facts. After DClaw becomes ready and backfill reaches the target cutoff, queued eligible runs can proceed.

- [ ] **Step 5: Run server tests**

Run: `node --test tests/server-group-automation-boundary.test.js tests/server-group-conversation-task-summary-boundary.test.js tests/group-automation-stream.test.js`

- [ ] **Step 6: Commit and push**

```bash
git add src/server.js src/db.js tests/server-group-automation-boundary.test.js tests/server-group-conversation-task-summary-boundary.test.js tests/group-automation-stream.test.js
git commit -m "refactor: expose trigger time group task execution state"
git push origin main
```

---

### Task 11: Console task configuration, status, and execution detail

**Repository:** `/Users/moxi/Desktop/codex space/agent create/worktool-bot-service`

**Files:**
- Modify: `public/console/group-automation-status.js`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Modify: `tests/group-automation-display-status.test.js`
- Modify: `tests/console-group-automation-boundary.test.js`
- Modify: `tests/server-group-conversation-task-summary-boundary.test.js`

- [ ] **Step 1: Write failing UI boundary and status tests**

Test exact state labels, countdown to `T`, conditional condition required, summary condition hidden, natural-language summary template help without variable-count parsing, no `已达成/尚未达成/判断暂不可用`, no ledger refresh action, group task cards in both Group Management and Conversation tabs, execution detail fields/actions, no standing ten-minute explanation, and a one-time post-save notice only when the imminent target is skipped for insufficient lead time.

- [ ] **Step 2: Run tests**

Run: `node --test tests/group-automation-display-status.test.js tests/console-group-automation-boundary.test.js tests/server-group-conversation-task-summary-boundary.test.js`

- [ ] **Step 3: Implement new status projection**

```js
export function deriveGroupAutomationDisplayStatus({ task, latestOccurrence, nowMs }) {
  if (latestOccurrence?.status === "sent") return { key: "sent", label: "已发送" };
  if (latestOccurrence?.status === "not_sent") return { key: "not_sent", label: "未发送" };
  if (latestOccurrence?.status === "failed") return { key: "failed", label: "执行失败" };
  if (latestOccurrence?.status === "send_unknown") return { key: "send_unknown", label: "发送待确认" };
  if (latestOccurrence && !["sent", "not_sent", "failed", "send_unknown"].includes(latestOccurrence.status)) {
    return { key: "running", label: "执行中" };
  }
  return { key: "countdown", label: formatCountdown(task.nextRunAt, nowMs) };
}
```

- [ ] **Step 4: Implement stable cards and detail dialog**

Show target time, actual start/completion, delay, decision note, final content, evidence list, failure stage, attempt count, and manual delivery actions. Evidence click reuses the current alert navigation flow: switch to group conversation, fetch the missing page around `messageId`, select it, scroll, and highlight. After save, consume the API's `skippedImminentTarget` flag once to explain that the next eligible schedule was chosen; do not persist that explanation in the page.

- [ ] **Step 5: Run UI tests**

Run: `node --test tests/group-automation-display-status.test.js tests/console-group-automation-boundary.test.js tests/server-group-conversation-task-summary-boundary.test.js`

- [ ] **Step 6: Commit and push**

```bash
git add public/console/group-automation-status.js public/console/app.js public/console/styles.css tests/group-automation-display-status.test.js tests/console-group-automation-boundary.test.js tests/server-group-conversation-task-summary-boundary.test.js
git commit -m "feat: show trigger time group task states"
git push origin main
```

---

### Task 12: Remove the business ledger and perform safe data cleanup

**Repository:** `/Users/moxi/Desktop/codex space/agent create/worktool-bot-service`

**Files:**
- Modify: `src/db.js`
- Modify: `src/server.js`
- Modify: `src/group-automation-worker.js`
- Delete: `tests/db-group-ledger.test.js`
- Modify: `tests/db-group-automation.test.js`
- Modify: `tests/server-group-automation-boundary.test.js`

- [ ] **Step 1: Add failing removal/readiness tests**

Assert no production import/export/reference remains for facts, aggregates, evidence ledger, revisions, ledger jobs, cycle states, `enqueueLive`, `enqueueReindex`, or `runLedgerTick`. Test that physical table cleanup is refused before DClaw capability and all managed-group backfills are ready, succeeds transactionally afterward, and is idempotent.

- [ ] **Step 2: Run removal tests and static search**

Run:

```bash
node --test tests/db-group-automation.test.js tests/server-group-automation-boundary.test.js
rg -n "group-ledger|enqueueLive|enqueueReindex|runLedgerTick|managed_group_(facts|aggregates|evidence|revisions|ledger_jobs|automation_cycle_states)" src public/console
```

Expected before implementation: tests fail and search returns legacy paths.

- [ ] **Step 3: Delete live ledger behavior**

Remove ledger timers, inbound ledger wakeups, reindex routes, ledger serializers, fact variable projection, cycle-state reads, and all Agent prompts based on facts. Legacy conditional tasks with an empty condition are disabled with a persisted `needs_condition` validation reason until edited; they are not converted into a hidden third task type.

- [ ] **Step 4: Add gated one-time cleanup**

```js
export function finalizeLegacyGroupLedgerRemoval({ capabilityReady, allManagedGroupsBackfilled }) {
  if (!capabilityReady || !allManagedGroupsBackfilled) return { removed: false, reason: "history_not_ready" };
  // one transaction: mark migration, drop legacy tables/indexes, preserve task/occurrence audit
}
```

Remove legacy table creation for fresh databases. Existing databases retain tables until the readiness gate succeeds. Preserve historical occurrence rows, but stop reading obsolete fact/variable columns.

- [ ] **Step 5: Verify no production ledger references remain**

Run:

```bash
node --test tests/db-group-automation.test.js tests/server-group-automation-boundary.test.js
rg -n "group-ledger|enqueueLive|enqueueReindex|runLedgerTick|managed_group_(facts|aggregates|evidence|revisions|ledger_jobs|automation_cycle_states)" src public/console
```

Expected: tests PASS; `rg` returns no production references.

- [ ] **Step 6: Commit and push**

```bash
git add src/db.js src/server.js src/group-automation-worker.js tests/db-group-automation.test.js tests/server-group-automation-boundary.test.js
git rm tests/db-group-ledger.test.js
git commit -m "refactor: remove legacy group business ledger"
git push origin main
```

---

### Task 13: Documentation, migration runbook, and full verification

**Repositories:** Both repositories.

**Files:**
- Modify: `/Users/moxi/Desktop/codex space/agent create/worktool-bot-service/README.md`
- Modify: `/Users/moxi/Desktop/codex space/dclaw-server/docs/open-api-user-manual.zh.md`

- [ ] **Step 1: Update documentation**

Document the DClaw history endpoints, required `messages:create`/`messages:read` publication and key scopes, immutable storage semantics, WorkTool backfill/cutover order, trigger-time analysis, long-history chunking, state meanings, ambiguity handling, and exact removal of `GROUP_AUTOMATION_LEDGER_INTERVAL_MS` plus all ledger terminology.

- [ ] **Step 2: Run DClaw full verification**

```bash
cd "/Users/moxi/Desktop/codex space/dclaw-server"
python -m pytest tests/unit/app/storage/repos/test_open_api_group_history_repo.py tests/unit/app/test_open_api_group_history_router.py tests/unit/app/test_open_api_auth.py tests/unit/app/test_open_api_router.py -q
python -m pytest -q
git diff --check
```

Expected: all tests PASS and `git diff --check` produces no output.

- [ ] **Step 3: Run WorkTool focused verification**

```bash
cd "/Users/moxi/Desktop/codex space/agent create/worktool-bot-service"
node --test \
  tests/dclaw-group-history.test.js \
  tests/db-group-history-sync.test.js \
  tests/group-history-sync-worker.test.js \
  tests/group-history-transcript.test.js \
  tests/db-group-automation.test.js \
  tests/group-automation-schedule.test.js \
  tests/group-automation-agent.test.js \
  tests/group-automation-worker.test.js \
  tests/group-automation-long-history.test.js \
  tests/group-summary-template.test.js \
  tests/group-automation-display-status.test.js \
  tests/server-group-automation-boundary.test.js \
  tests/server-group-conversation-task-summary-boundary.test.js \
  tests/console-group-automation-boundary.test.js \
  tests/group-automation-stream.test.js \
  tests/conversation-message-dedupe.test.js
```

- [ ] **Step 4: Run WorkTool full verification and static guards**

```bash
npm test
git diff --check
rg -n "group-ledger|enqueueLive|enqueueReindex|runLedgerTick|判断暂不可用|正在判断|managed_group_(facts|aggregates|evidence|revisions|ledger_jobs|automation_cycle_states)" src public/console README.md
```

Expected: all tests PASS, diff check is clean, and static search returns no legacy production/UI/documentation references.

- [ ] **Step 5: Perform cross-service contract smoke test**

Using an isolated test publication/key and test database:

1. Append the same group message twice and verify DClaw stores one item.
2. Backfill a WorkTool test group containing inbound, outbound, imported duplicate, and multiple speakers.
3. Read DClaw history for the exact cycle and verify chronological identity/time/content completeness.
4. Run one achieved conditional task and verify the exact configured content plus mentions.
5. Run one false conditional task and verify no WorkTool send.
6. Run one long periodic summary and verify chunk coverage, truthful final content, and evidence navigation.
7. Simulate restart at each durable stage and verify one occurrence and at most one confirmed customer send.
8. Simulate an ambiguous send and verify no automatic retry.

- [ ] **Step 6: Commit and push documentation in each changed repository**

```bash
cd "/Users/moxi/Desktop/codex space/dclaw-server"
git add docs/open-api-user-manual.zh.md
git commit -m "docs: describe open api group history"
git push origin main

cd "/Users/moxi/Desktop/codex space/agent create/worktool-bot-service"
git add README.md
git commit -m "docs: describe trigger time group automation"
git push origin main
```

- [ ] **Step 7: Verify both remotes are synchronized**

```bash
git -C "/Users/moxi/Desktop/codex space/dclaw-server" status --short --branch
git -C "/Users/moxi/Desktop/codex space/agent create/worktool-bot-service" status --short --branch
```

Expected for both: `## main...origin/main` with no changed files.

---

## Deployment Order and Rollback Boundary

1. Deploy DClaw schema/repository/API first, ensure the publication and bound WorkTool key include both required scopes, and verify authenticated append/read on the target publication.
2. Deploy WorkTool history client and sync worker with the new executor still guarded by capability/readiness.
3. Let initial managed-group backfill complete; monitor cursor lag and append errors.
4. Enable the trigger-time executor only after every enabled task's group has synced through its required cutoff.
5. Stop all ledger timers and live/reindex writes.
6. Allow the gated cleanup to drop legacy ledger tables after readiness is durable.
7. If DClaw becomes unavailable before final synthesis, leave the occurrence retryable/failed and send nothing. Do not re-enable the old ledger.
8. If an issue appears before ledger cleanup, roll back only the WorkTool executor while retaining raw history sync. After cleanup, rollback requires restoring code without relying on deleted ledger data; raw history remains the recovery source.

## Completion Criteria

- DClaw can idempotently store and page complete publication-scoped group history without invoking an Agent.
- Existing and new WorkTool group messages reach DClaw with canonical identities and bounded retry.
- Conditional pushes and periodic summaries use only the frozen raw-history interval and trigger-time Agent analysis.
- Long conversations are fully covered without exceeding request limits or creating a reusable fact ledger.
- Conditional false, analysis failure, explicit send failure, and ambiguous send each have distinct tested behavior.
- UI and conversation summaries show only the new countdown/execution/result states and can navigate evidence that was not previously loaded.
- Legacy ledger code, prompts, timers, UI, docs, and tables are removed after a tested readiness gate.
- Both repositories pass focused/full suites, are clean, and match `origin/main`.
