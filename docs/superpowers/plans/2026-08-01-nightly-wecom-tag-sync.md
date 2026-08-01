# Nightly WeCom Tag Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Persist private-customer internal tags as retryable Outbox items and append them to native WeCom contacts during a Bot-scoped nightly window or an administrator-triggered immediate run.

**Architecture:** Internal tags remain the source of truth. Existing tag transactions register Outbox rows, a dedicated worker submits at most one WorkTool type=213 command per Bot, and existing WorkTool command callbacks finalize delivery. The worker reads the existing message_processing lifecycle to yield while customer messages are active; it does not wrap, reorder, or replace any existing customer-visible send path.

**Tech Stack:** Node.js ESM, Express 5, node:sqlite DatabaseSync, native fetch, Node test runner, vanilla HTML/CSS/JavaScript.

## Global Constraints

- Native tags are append-only; never send native delete or replacement operations.
- Sync normal, manual, and customer-add-date tags for private conversations only.
- Never send markName or markExtra.
- Nightly automation defaults off for existing and new Bots.
- Timezone is fixed to Asia/Shanghai. Windows must stay within 22:00-next-day 08:00; default is 03:00-06:00.
- Immediate sync works even when nightly automation is off.
- Persist Outbox, run, lease, retry, and callback state in SQLite.
- Submit at most five tag names per WorkTool command and one in-flight tag command per Bot.
- Do not add a global outbound priority queue.
- Do not change AI reply, manual reply, activation, tag activation, proactive push, group behavior, or Agent behavior.
- Batch friend deletion and group tag synchronization are out of scope.

---

## File Map

- Create src/tag-sync.js for schedule normalization and Beijing night-window calculations.
- Create src/tag-sync-worker.js for scheduling, pause checks, one-command dispatch, retry, and run completion.
- Modify src/worktool.js to build and send the verified type=213 command.
- Modify src/db.js for migrations, config/run/Outbox repositories, transactional registration, backfill, leases, retry, and callback resolution.
- Modify src/server.js for worker wiring, callback finalization, Bot-admin APIs, startup recovery, and interval lifecycle.
- Modify public/console/index.html, app.js, and styles.css for the Bot configuration panel.
- Add focused tests per task and finish with the complete npm test suite.

---

### Task 1: Night Window Domain And WorkTool Command

**Files:**
- Create: src/tag-sync.js
- Modify: src/worktool.js
- Test: tests/tag-sync.test.js
- Test: tests/worktool-tag-sync.test.js

**Interfaces:**
- Produce DEFAULT_TAG_SYNC_CONFIG.
- Produce normalizeTagSyncConfig(input).
- Produce validateTagSyncNightWindow({ windowStart, windowEnd }).
- Produce getTagSyncWindowState(config, now), returning { inside, windowKey, localMinute }.
- Produce buildFriendTagCommand({ targetName, tagNames }).
- Produce syncFriendTags({ robotId, targetName, tagNames, socketType }).

- [ ] **Step 1: Write failing night-window tests**

~~~js
test("tag sync defaults are disabled with a 03:00-06:00 window", () => {
  assert.deepEqual(normalizeTagSyncConfig({}), {
    nightlyEnabled: false,
    windowStart: "03:00",
    windowEnd: "06:00"
  });
});

test("night window accepts valid ranges and rejects daytime", () => {
  assert.doesNotThrow(() => validateTagSyncNightWindow({
    windowStart: "23:30", windowEnd: "04:00"
  }));
  assert.doesNotThrow(() => validateTagSyncNightWindow({
    windowStart: "03:00", windowEnd: "06:00"
  }));
  assert.throws(() => validateTagSyncNightWindow({
    windowStart: "21:00", windowEnd: "03:00"
  }), /night window/i);
  assert.throws(() => validateTagSyncNightWindow({
    windowStart: "03:00", windowEnd: "10:00"
  }), /night window/i);
  assert.throws(() => validateTagSyncNightWindow({
    windowStart: "03:00", windowEnd: "03:00"
  }), /night window/i);
});

test("window state projects UTC onto the Beijing night timeline", () => {
  const config = { nightlyEnabled: true, windowStart: "23:30", windowEnd: "04:00" };
  assert.equal(getTagSyncWindowState(
    config, new Date("2026-08-01T16:00:00.000Z")
  ).inside, true);
  assert.equal(getTagSyncWindowState(
    config, new Date("2026-08-01T21:00:00.000Z")
  ).inside, false);
});
~~~

- [ ] **Step 2: Run node --test tests/tag-sync.test.js**

Expected: FAIL with ERR_MODULE_NOT_FOUND for src/tag-sync.js.

- [ ] **Step 3: Implement the canonical night timeline**

~~~js
export const TAG_SYNC_TIME_ZONE = "Asia/Shanghai";
export const DEFAULT_TAG_SYNC_CONFIG = Object.freeze({
  nightlyEnabled: false,
  windowStart: "03:00",
  windowEnd: "06:00"
});

function nightMinute(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) throw new Error("invalid night window time");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("invalid night window time");
  if (hour >= 22) return hour * 60 + minute;
  if (hour < 8 || (hour === 8 && minute === 0)) {
    return 24 * 60 + hour * 60 + minute;
  }
  throw new Error("night window must stay within 22:00-08:00");
}

export function validateTagSyncNightWindow({ windowStart, windowEnd }) {
  const startMinute = nightMinute(windowStart);
  const endMinute = nightMinute(windowEnd);
  if (endMinute <= startMinute) {
    throw new Error("night window end must be after start");
  }
  return { startMinute, endMinute };
}
~~~

Use Intl.DateTimeFormat with timeZone Asia/Shanghai and hourCycle h23 for getTagSyncWindowState. Map local times before 08:00 to the next-day part of the canonical timeline. For after-midnight points, windowKey is the previous Beijing calendar date.

- [ ] **Step 4: Write failing WorkTool command tests**

~~~js
test("friend tag command deduplicates tags and never changes remarks", () => {
  const command = buildFriendTagCommand({
    targetName: "魔兮",
    tagNames: ["A类", "VIP", "A类"]
  });
  assert.deepEqual(command, {
    type: 213,
    friend: { name: "魔兮", tagList: ["A类", "VIP"] }
  });
  assert.equal("markName" in command.friend, false);
  assert.equal("markExtra" in command.friend, false);
});

test("friend tag command rejects more than five tags", () => {
  assert.throws(() => buildFriendTagCommand({
    targetName: "魔兮",
    tagNames: ["1", "2", "3", "4", "5", "6"]
  }), /five/i);
});
~~~

- [ ] **Step 5: Implement buildFriendTagCommand and syncFriendTags**

~~~js
export function buildFriendTagCommand({ targetName, tagNames = [] }) {
  const name = String(targetName || "").trim();
  const tags = normalizedUniqueNames(tagNames);
  if (!name) throw new Error("targetName is required");
  if (!tags.length) throw new Error("tagNames must not be empty");
  if (tags.length > 5) throw new Error("at most five tags are allowed");
  return { type: 213, friend: { name, tagList: tags } };
}

export async function syncFriendTags({
  robotId, targetName, tagNames, socketType = 2
}) {
  return requestWorkTool("/wework/sendRawMessage", {
    robotId,
    method: "POST",
    body: JSON.stringify({
      socketType,
      list: [buildFriendTagCommand({ targetName, tagNames })]
    })
  });
}
~~~

- [ ] **Step 6: Run node --test tests/tag-sync.test.js tests/worktool-tag-sync.test.js**

Expected: all Task 1 tests PASS.

- [ ] **Step 7: Commit**

~~~bash
git add src/tag-sync.js src/worktool.js tests/tag-sync.test.js tests/worktool-tag-sync.test.js
git commit -m "Add nightly tag sync domain and WorkTool command"
~~~

---

### Task 2: Persistent Config, Outbox, Runs, And Tag Registration

**Files:**
- Modify: src/db.js
- Test: tests/db-tag-sync.test.js
- Test: tests/db-tags.test.js

**Interfaces:**
- Produce getTagSyncConfig(botId).
- Produce saveTagSyncConfig({ botId, config }).
- Produce ensureTagSyncInitialBackfill({ botId }).
- Produce startTagSyncRun({ botId, triggerType, windowKey, startedAt }).
- Produce listRunnableTagSyncConfigs(), getActiveTagSyncRun(botId), and getTagSyncStatus(botId).
- Produce hasRecentBotMessageProcessing({ botId, sinceIso }).
- Produce claimNextTagSyncBatch({ botId, runId, nowIso, leaseExpiresAt, limit }).
- Produce markTagSyncCommandSubmitted, markTagSyncCommandSubmitFailed, resolveTagSyncCommandCallback, recoverExpiredTagSyncLeases, updateTagSyncRunStatus, and finishTagSyncRunIfDrained.

- [ ] **Step 1: Write failing config and migration tests**

~~~js
test("tag sync config defaults off and validates saved windows", () => {
  assert.equal(db.getTagSyncConfig("bot_sync").nightlyEnabled, false);
  const saved = db.saveTagSyncConfig({
    botId: "bot_sync",
    config: {
      nightlyEnabled: true,
      windowStart: "23:30",
      windowEnd: "04:00"
    }
  });
  assert.equal(saved.windowStart, "23:30");
  assert.throws(() => db.saveTagSyncConfig({
    botId: "bot_sync",
    config: {
      nightlyEnabled: true,
      windowStart: "09:00",
      windowEnd: "12:00"
    }
  }), /night window/i);
});
~~~

- [ ] **Step 2: Run node --test tests/db-tag-sync.test.js**

Expected: FAIL because getTagSyncConfig is not exported.

- [ ] **Step 3: Add migration-safe tables and indexes**

~~~sql
CREATE TABLE IF NOT EXISTS bot_tag_sync_configs (
  bot_id TEXT PRIMARY KEY,
  nightly_enabled INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL DEFAULT '03:00',
  window_end TEXT NOT NULL DEFAULT '06:00',
  initial_backfill_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tag_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  window_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  pending_before INTEGER NOT NULL DEFAULT 0,
  succeeded_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  pause_reason TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tag_sync_runs_active
ON tag_sync_runs (bot_id)
WHERE status IN ('running', 'paused');

CREATE TABLE IF NOT EXISTS tag_sync_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  conversation_key TEXT NOT NULL,
  target_name TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  run_id INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  run_attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  claimed_at TEXT,
  lease_expires_at TEXT,
  worktool_message_id TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  succeeded_at TEXT,
  UNIQUE(bot_id, conversation_key, tag_name)
);

CREATE INDEX IF NOT EXISTS idx_tag_sync_outbox_claim
ON tag_sync_outbox (bot_id, status, next_retry_at, id);

CREATE INDEX IF NOT EXISTS idx_tag_sync_outbox_callback
ON tag_sync_outbox (bot_id, worktool_message_id);
~~~

Do not alter or rewrite existing business tables.

- [ ] **Step 4: Write failing backfill and registration tests**

~~~js
test("initial backfill includes normal manual and date tags for private chats only", () => {
  seedPrivateTags(["A类", "VIP", "20260801"]);
  seedGroupTags(["群标签"]);
  const first = db.ensureTagSyncInitialBackfill({ botId: "bot_sync" });
  const second = db.ensureTagSyncInitialBackfill({ botId: "bot_sync" });
  assert.equal(first.insertedCount, 3);
  assert.equal(second.insertedCount, 0);
  assert.deepEqual(listOutboxNames(), ["20260801", "A类", "VIP"]);
});

test("tag insert transactions register durable Outbox rows after initialization", () => {
  db.ensureTagSyncInitialBackfill({ botId: "bot_sync" });
  applyAgentOutcomeAdding("A类");
  applyManualChangeAdding("VIP");
  db.upsertSystemDateTag({
    botId: "bot_sync",
    agentId: "agent_sync",
    conversationKey: "bot_sync:private:客户甲",
    dateTagId: "20260801"
  });
  assert.deepEqual(listOutboxNames(), ["20260801", "A类", "VIP"]);
});

test("remove and repeated add never create native delete or duplicate rows", () => {
  addRemoveAndReAddTag("A类");
  assert.equal(countOutbox("A类"), 1);
});
~~~

- [ ] **Step 5: Implement transaction-local registration**

Add registerTagSyncOutboxRows inside src/db.js. It must:
1. Return without work until initial_backfill_at exists.
2. Query conversations and allow only room_type 2 or 4.
3. Use the latest conversations.received_name as the audit target_name.
4. INSERT OR IGNORE by bot_id, conversation_key, and tag_name.
5. Execute before COMMIT inside applyConversationTagChanges and applyAgentTagOutcome.
6. Refactor upsertSystemDateTag to commit the date tag and Outbox registration in one BEGIN IMMEDIATE transaction.

Before initialization, current tag writes do not create Outbox rows because the first backfill captures current state. After initialization, registration continues even when nightly_enabled is false so immediate sync can drain pending changes.

- [ ] **Step 6: Write failing claim, callback, lease, and activity tests**

~~~js
test("claim groups five tags for one customer and blocks a second in-flight batch", () => {
  const run = db.startTagSyncRun({
    botId: "bot_sync",
    triggerType: "manual"
  });
  const batch = db.claimNextTagSyncBatch({
    botId: "bot_sync",
    runId: run.id,
    nowIso: "2026-08-01T16:00:00.000Z",
    leaseExpiresAt: "2026-08-01T16:02:00.000Z",
    limit: 5
  });
  assert.equal(batch.rows.length, 5);
  assert.equal(db.claimNextTagSyncBatch({
    botId: "bot_sync",
    runId: run.id,
    nowIso: "2026-08-01T16:00:01.000Z",
    leaseExpiresAt: "2026-08-01T16:02:01.000Z",
    limit: 5
  }), null);
});

test("one callback completes every row sharing its WorkTool message id", () => {
  db.markTagSyncCommandSubmitted({
    botId: "bot_sync",
    outboxIds: [1, 2],
    worktoolMessageId: "wt-tags-1"
  });
  const result = db.resolveTagSyncCommandCallback({
    botId: "bot_sync",
    worktoolMessageId: "wt-tags-1",
    succeeded: true,
    error: ""
  });
  assert.equal(result.succeededCount, 2);
});

test("message processing pauses only its own Bot", () => {
  db.beginMessageProcessing({
    messageKey: "incoming-1",
    botId: "bot_sync",
    conversationKey: "bot_sync:private:客户甲",
    messageId: "m-1"
  });
  assert.equal(db.hasRecentBotMessageProcessing({
    botId: "bot_sync",
    sinceIso: "2026-08-01T15:45:00.000Z"
  }), true);
  assert.equal(db.hasRecentBotMessageProcessing({
    botId: "other_bot",
    sinceIso: "2026-08-01T15:45:00.000Z"
  }), false);
});
~~~

- [ ] **Step 7: Implement atomic run and Outbox transitions**

startTagSyncRun returns an existing running or paused run for the Bot. Otherwise it initializes backfill if needed, resets run_attempt_count to zero on retryable failed rows, counts pending plus failed rows, and inserts one run.

claimNextTagSyncBatch returns null when the Bot already has processing rows. Otherwise it resolves the latest private-conversation received_name, selects the oldest eligible customer, selects at most five eligible tags for that conversation, and atomically marks them processing with run_id, claim time, lease, and incremented attempt counters.

Callback failure and lease expiry move rows to failed with last_error and next_retry_at. Rows with run_attempt_count below three remain eligible in the same run after 30-second, 2-minute, then 5-minute backoff. A new scheduled or manual run resets run_attempt_count but never resets lifetime attempt_count.

finishTagSyncRunIfDrained completes the run when there are no processing rows and no pending or failed rows eligible within the current three-attempt budget.

- [ ] **Step 8: Run node --test tests/db-tag-sync.test.js tests/db-tags.test.js**

Expected: all focused database and existing tag tests PASS.

- [ ] **Step 9: Commit**

~~~bash
git add src/db.js tests/db-tag-sync.test.js tests/db-tags.test.js
git commit -m "Add persistent WeCom tag sync outbox"
~~~

---

### Task 3: Dedicated Low-Priority Worker

**Files:**
- Create: src/tag-sync-worker.js
- Test: tests/tag-sync-worker.test.js

**Interfaces:**
- Produce createTagSyncWorker(dependencies).
- Returned methods: tick(now), runBot(botId, now), handleCommandCallback(input), recover(now), and stop().
- Dependencies are injected so worker behavior is tested without SQLite or HTTP.

- [ ] **Step 1: Write failing worker tests**

~~~js
test("disabled nightly config never starts a scheduled run", async () => {
  const harness = createHarness({ nightlyEnabled: false });
  await harness.worker.tick(new Date("2026-08-01T19:00:00.000Z"));
  assert.equal(harness.startedRuns.length, 0);
});

test("manual run works while nightly automation is disabled", async () => {
  const harness = createHarness({
    nightlyEnabled: false,
    activeRun: { id: 9, triggerType: "manual", status: "running" }
  });
  await harness.worker.runBot("bot_sync", new Date());
  assert.equal(harness.sent.length, 1);
});

test("customer processing pauses claim and finished processing resumes it", async () => {
  const harness = createHarness({ realtimeActive: true });
  await harness.worker.runBot("bot_sync", new Date());
  assert.equal(harness.sent.length, 0);
  assert.equal(harness.runStatus, "paused");
  harness.realtimeActive = false;
  await harness.worker.runBot("bot_sync", new Date());
  assert.equal(harness.sent.length, 1);
});

test("worker waits for callback before a second command", async () => {
  const harness = createHarness({ batches: [batchOne, batchTwo] });
  await harness.worker.runBot("bot_sync", new Date());
  await harness.worker.runBot("bot_sync", new Date());
  assert.equal(harness.sent.length, 1);
  await harness.worker.handleCommandCallback({
    botId: "bot_sync",
    messageId: "wt-1",
    payload: { errorCode: 0, successList: ["客户甲"], failList: [] }
  });
  await harness.worker.runBot("bot_sync", new Date());
  assert.equal(harness.sent.length, 2);
});
~~~

- [ ] **Step 2: Run node --test tests/tag-sync-worker.test.js**

Expected: FAIL with ERR_MODULE_NOT_FOUND.

- [ ] **Step 3: Implement the worker**

~~~js
export function createTagSyncWorker(deps) {
  let ticking = false;
  let stopped = false;

  async function runBot(botId, now = new Date()) {
    const config = deps.getConfig(botId);
    const window = deps.getWindowState(config, now);
    let run = deps.getActiveRun(botId);

    if (!run && config.nightlyEnabled && window.inside) {
      run = deps.startRun({
        botId,
        triggerType: "scheduled",
        windowKey: window.windowKey
      });
    }
    if (!run) return { status: "idle" };

    if (
      run.triggerType === "scheduled"
      && (!config.nightlyEnabled || !window.inside)
    ) {
      deps.setRunStatus({
        runId: run.id,
        status: "stopped",
        reason: "window_closed"
      });
      return { status: "stopped" };
    }

    if (deps.hasRealtimeActivity(botId)) {
      deps.setRunStatus({
        runId: run.id,
        status: "paused",
        reason: "customer_message"
      });
      return { status: "paused" };
    }

    deps.setRunStatus({ runId: run.id, status: "running", reason: "" });
    const batch = deps.claimBatch({ botId, runId: run.id, limit: 5 });
    if (!batch) return deps.finishRunIfDrained({ botId, runId: run.id });

    try {
      const response = await deps.sendTags({
        robotId: botId,
        targetName: batch.targetName,
        tagNames: batch.tagNames
      });
      deps.markSubmitted({
        botId,
        outboxIds: batch.rows.map((row) => row.id),
        worktoolMessageId: response.data
      });
      return { status: "submitted" };
    } catch (error) {
      deps.markSubmitFailed({
        botId,
        outboxIds: batch.rows.map((row) => row.id),
        error: error.message
      });
      return { status: "failed" };
    }
  }

  return { tick, runBot, handleCommandCallback, recover, stop };
}
~~~

tick uses a non-overlap guard and Promise.allSettled across Bots. hasRealtimeActivity checks message_processing newer than 15 minutes; this avoids stale crash residue blocking forever while preserving the existing reply lifecycle. Callback success requires errorCode zero, target absent from failList, and either an empty successList or target present in successList.

- [ ] **Step 4: Run node --test tests/tag-sync-worker.test.js**

Expected: all Task 3 tests PASS.

- [ ] **Step 5: Commit**

~~~bash
git add src/tag-sync-worker.js tests/tag-sync-worker.test.js
git commit -m "Add low priority WeCom tag sync worker"
~~~

---

### Task 4: Server Wiring, Callbacks, And Bot-Admin APIs

**Files:**
- Modify: src/server.js
- Test: tests/server-tag-sync-boundary.test.js

**Interfaces:**
- Add GET and PUT /api/bots/:botId/tag-sync/config.
- Add GET /api/bots/:botId/tag-sync/status.
- Add POST /api/bots/:botId/tag-sync/run.
- Extend both existing command-callback handlers after their current outgoing and proactive updates.

- [ ] **Step 1: Write failing route and regression-boundary tests**

~~~js
test("tag sync APIs require Bot administrator access", () => {
  for (const route of [
    '"/api/bots/:botId/tag-sync/config"',
    '"/api/bots/:botId/tag-sync/status"',
    '"/api/bots/:botId/tag-sync/run"'
  ]) {
    assert.match(routeBody(serverSource, route),
      /assertAdminForBot\(req, req\.params\.botId\)/);
  }
});

test("command callbacks preserve old updates and finalize tag sync", () => {
  for (const route of [
    'app.post("/worktool/:botId/command-callback"',
    'app.post("/worktool/command-callback"'
  ]) {
    const body = handlerBody(serverSource, route);
    assert.match(body, /updateOutgoingMessageFromCommandCallback/);
    assert.match(body, /updateProactiveTargetFromCommandCallback/);
    assert.match(body, /tagSyncWorker\.handleCommandCallback/);
  }
});

test("tag sync does not wrap old customer-visible sends", () => {
  assert.doesNotMatch(serverSource, /tagSync.*sendTextMessage/);
  assert.doesNotMatch(serverSource, /tagSync.*sendActivation/);
  assert.match(serverSource, /hasRecentBotMessageProcessing/);
});
~~~

- [ ] **Step 2: Run node --test tests/server-tag-sync-boundary.test.js**

Expected: FAIL because routes and worker wiring are absent.

- [ ] **Step 3: Instantiate one worker and a non-overlapping two-second loop**

~~~js
const tagSyncWorker = createTagSyncWorker({
  getConfig: getTagSyncConfig,
  listConfigs: listRunnableTagSyncConfigs,
  getActiveRun: getActiveTagSyncRun,
  startRun: startTagSyncRun,
  setRunStatus: updateTagSyncRunStatus,
  hasRealtimeActivity: (botId) => hasRecentBotMessageProcessing({
    botId,
    sinceIso: new Date(Date.now() - tagSyncRealtimeActivityTtlMs).toISOString()
  }),
  claimBatch: claimNextTagSyncBatch,
  markSubmitted: markTagSyncCommandSubmitted,
  markSubmitFailed: markTagSyncCommandSubmitFailed,
  resolveCallback: resolveTagSyncCommandCallback,
  finishRunIfDrained: finishTagSyncRunIfDrained,
  recoverLeases: recoverExpiredTagSyncLeases,
  sendTags: syncFriendTags,
  getWindowState: getTagSyncWindowState,
  log(event, fields) {
    if (event.endsWith("failed")) logWarn(event, fields);
    else logInfo(event, fields);
  }
});
~~~

Recover expired leases once at startup. The worker loop must not call or wrap sendTextMessage, enqueueAgentInvocation, activation workers, proactive workers, or group operations.

- [ ] **Step 4: Finalize tag sync in both command callbacks**

After the existing outgoing and proactive callback updates, call tagSyncWorker.handleCommandCallback with botId, messageId, and payload. Unrelated callback IDs return matched false. Preserve the existing response body and old update order.

- [ ] **Step 5: Implement Bot-admin APIs**

~~~js
app.get("/api/bots/:botId/tag-sync/config", asyncHandler(async (req, res) => {
  assertAdminForBot(req, req.params.botId);
  res.json({ ok: true, config: getTagSyncConfig(req.params.botId) });
}));

app.put("/api/bots/:botId/tag-sync/config", asyncHandler(async (req, res) => {
  assertAdminForBot(req, req.params.botId);
  const config = saveTagSyncConfig({
    botId: req.params.botId,
    config: req.body || {}
  });
  if (config.nightlyEnabled && !config.initialBackfillAt) {
    ensureTagSyncInitialBackfill({ botId: req.params.botId });
  }
  res.json({ ok: true, config: getTagSyncConfig(req.params.botId) });
}));

app.post("/api/bots/:botId/tag-sync/run", asyncHandler(async (req, res) => {
  assertAdminForBot(req, req.params.botId);
  ensureTagSyncInitialBackfill({ botId: req.params.botId });
  const run = startTagSyncRun({
    botId: req.params.botId,
    triggerType: "manual"
  });
  void tagSyncWorker.runBot(req.params.botId, new Date());
  res.status(202).json({
    ok: true,
    run,
    status: getTagSyncStatus(req.params.botId)
  });
}));
~~~

Map time validation errors to HTTP 400. Reuse an existing running or paused run rather than creating a duplicate.

- [ ] **Step 6: Run focused server regressions**

~~~bash
node --test \
  tests/server-tag-sync-boundary.test.js \
  tests/server-auth-boundary.test.js \
  tests/server-tags-boundary.test.js \
  tests/server-activation-worker-boundary.test.js \
  tests/server-proactive-scheduling-boundary.test.js
~~~

Expected: all focused tests PASS.

- [ ] **Step 7: Commit**

~~~bash
git add src/server.js tests/server-tag-sync-boundary.test.js
git commit -m "Wire nightly WeCom tag sync service"
~~~

---

### Task 5: Bot Configuration UI

**Files:**
- Modify: public/console/index.html
- Modify: public/console/app.js
- Modify: public/console/styles.css
- Test: tests/console-tag-sync-boundary.test.js

**Interfaces:**
- Add tagSyncPanel, tagSyncForm, tagSyncNightlyEnabled, tagSyncWindowStart, tagSyncWindowEnd, tagSyncRunButton, and tagSyncStatus.
- Add loadTagSyncConfig(botId), saveTagSyncConfig(event), runTagSyncNow(), renderTagSyncStatus(status), and buildNightTagSyncTimeOptions().

- [ ] **Step 1: Write failing UI boundary tests**

~~~js
test("Bot config contains an admin-only nightly sync panel", () => {
  assert.match(html, /id="tagSyncPanel"[^>]*admin-only-panel/);
  assert.match(html, /夜间自动同步/);
  assert.match(html, /id="tagSyncRunButton"/);
});

test("schedule uses restricted selects and protects stale Bot loads", () => {
  assert.doesNotMatch(html, /tagSyncWindowStart[^>]*type="time"/);
  assert.match(client, /buildNightTagSyncTimeOptions/);
  const loadBody = functionBody(client, "loadTagSyncConfig");
  assert.match(loadBody, /requestVersion/);
  assert.match(loadBody, /state\.currentBotId !== botId/);
});
~~~

- [ ] **Step 2: Run node --test tests/console-tag-sync-boundary.test.js**

Expected: FAIL because tagSyncPanel is missing.

- [ ] **Step 3: Add the admin-only config panel**

~~~html
<section id="tagSyncPanel"
  class="panel bot-context-panel collapsible-panel admin-only-panel">
  <div class="section-head">
    <h2 class="module-title">
      <svg class="icon"><use href="#icon-tag"></use></svg>企微标签同步
    </h2>
    <button class="collapse-button" data-collapse-target="tagSyncPanel"
      type="button" aria-label="收起企微标签同步">
      <svg class="icon"><use href="#icon-chevron"></use></svg>
    </button>
  </div>
  <div class="collapsible-content">
    <form id="tagSyncForm" class="form-grid compact-form tag-sync-form">
      <label class="toggle switch-toggle">
        <input id="tagSyncNightlyEnabled" name="nightlyEnabled"
          type="checkbox" />
        <span class="switch-slider"></span>
        <span class="switch-label">夜间自动同步</span>
      </label>
      <label><span class="field-label">开始时间</span>
        <select id="tagSyncWindowStart" name="windowStart"></select>
      </label>
      <label><span class="field-label">结束时间</span>
        <select id="tagSyncWindowEnd" name="windowEnd"></select>
      </label>
      <div id="tagSyncStatus" class="tag-sync-status"
        aria-live="polite"></div>
      <div class="actions tag-sync-actions">
        <button type="submit"><svg class="icon">
          <use href="#icon-save"></use></svg>保存配置</button>
        <button id="tagSyncRunButton" class="primary" type="button">
          <svg class="icon"><use href="#icon-refresh"></use></svg>立即同步
        </button>
      </div>
    </form>
  </div>
</section>
~~~

- [ ] **Step 4: Implement restricted schedule controls and requests**

Generate 15-minute options from 22:00 through 23:45, then 00:00 through 08:00. Display after-midnight values as 次日 04:00 while submitting 04:00. Disable end options not later than the canonical start.

loadTagSyncConfig increments state.tagSyncLoadVersion, fetches config and status, and applies them only when the version and state.currentBotId still match. Invoke it from the existing admin Bot-context load path and reset it in clearBotContext.

runTagSyncNow uses the existing confirm dialog with:

~~~text
立即同步企微标签？
同步会使用当前 Bot 的 WorkTool 客户端队列；收到客户消息时会自动暂停，回复后继续。
~~~

Do not add browser polling. Refresh status only on Bot load, save response, and immediate-run response.

- [ ] **Step 5: Add stable responsive CSS**

~~~css
.tag-sync-form {
  grid-template-columns:
    minmax(180px, .8fr) minmax(150px, .6fr)
    minmax(150px, .6fr) minmax(280px, 1.4fr) auto;
  align-items: center;
}

.tag-sync-status {
  display: flex;
  min-height: 42px;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.tag-sync-actions {
  justify-content: flex-end;
  flex-wrap: nowrap;
}

@media (max-width: 980px) {
  .tag-sync-form { grid-template-columns: 1fr 1fr; }
  .tag-sync-status,
  .tag-sync-actions { grid-column: 1 / -1; }
}
~~~

When nightly automation is off, disable only the two schedule selects. Keep status and immediate sync enabled.

- [ ] **Step 6: Run focused console tests**

~~~bash
node --test \
  tests/console-tag-sync-boundary.test.js \
  tests/console-auth-boundary.test.js \
  tests/console-tags-boundary.test.js
~~~

Expected: all focused tests PASS.

- [ ] **Step 7: Commit**

~~~bash
git add \
  public/console/index.html \
  public/console/app.js \
  public/console/styles.css \
  tests/console-tag-sync-boundary.test.js
git commit -m "Add Bot nightly tag sync controls"
~~~

---

### Task 6: Full Regression And Operational Documentation

**Files:**
- Modify: .env.example
- Modify: README.md
- Test: complete suite

- [ ] **Step 1: Document optional worker defaults**

~~~dotenv
TAG_SYNC_WORKER_INTERVAL_MS=2000
TAG_SYNC_WORKER_LEASE_MS=120000
TAG_SYNC_REALTIME_ACTIVITY_TTL_MS=900000
~~~

Document that nightly sync defaults off, is limited to Beijing 22:00-next-day 08:00, and immediate sync is available to the Bot administrator.

- [ ] **Step 2: Run all focused feature tests**

~~~bash
node --test \
  tests/tag-sync.test.js \
  tests/worktool-tag-sync.test.js \
  tests/db-tag-sync.test.js \
  tests/tag-sync-worker.test.js \
  tests/server-tag-sync-boundary.test.js \
  tests/console-tag-sync-boundary.test.js
~~~

Expected: zero failures.

- [ ] **Step 3: Run the full suite and static checks**

~~~bash
npm test
git diff --check
~~~

Expected: npm test reports zero failures and git diff --check prints nothing.

- [ ] **Step 4: Smoke-test only in a disposable local or test environment**

1. Verify the panel defaults off with 03:00-06:00.
2. Add a private-customer internal tag and verify Outbox state survives restart.
3. Click immediate sync and verify one type=213 command contains no remark fields.
4. Verify pending count decreases only after a successful command callback.
5. Insert a recent processing message for the Bot and verify no new tag command is claimed.
6. Finish that message-processing row and verify the worker resumes.

- [ ] **Step 5: Commit documentation**

~~~bash
git add .env.example README.md
git commit -m "Document nightly WeCom tag synchronization"
~~~

- [ ] **Step 6: Request review and push**

Use superpowers:requesting-code-review, address verified findings, rerun npm test, and push origin main. Include no unrelated dirty files.

