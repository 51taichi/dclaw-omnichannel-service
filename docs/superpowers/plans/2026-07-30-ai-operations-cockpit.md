# Single-Bot AI Operations Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-Bot operations cockpit with low-cost event capture, overnight aggregation, version-safe task/tag analytics, responsive dashboards, archived AI reports, and scheduled WeCom delivery without affecting the customer reply path.

**Architecture:** Customer-facing code appends idempotent analytics events through a fail-open sidecar and never performs aggregation or report generation. A non-overlapping low-priority worker incrementally builds Bot-scoped snapshots, freezes report inputs, generates AI analysis, and sends already-generated summaries later. The console reads snapshots through Bot-authenticated APIs and uses the existing `--bot-accent` theme system.

**Tech Stack:** Node.js 18+, ES modules, Express 5, `node:sqlite` with WAL, native `node:test`, static HTML/CSS/JavaScript, existing WorkTool and DClaw HTTP clients.

## Global Constraints

- The cockpit is strictly single-Bot; no cross-Bot totals, comparisons, or rankings.
- Unlocking or reopening a Bot defaults to the cockpit tab; tab order is `cockpit, sessions, flow, groups, tags, push, logs, config`.
- Opening, refreshing, or switching cockpit periods must not scan historical messages, aggregate data, or invoke AI.
- Reply processing must not await analytics, aggregation, report generation, or delivery. Analytics failures must not change reply status, content, latency policy, flow transitions, or tag decisions.
- Daytime work is limited to append-only events and idempotent constant-time counters. Full funnels, tag analysis, risk classification, reconciliation, and AI reports run in the configured low-traffic window.
- Default Bot timezone is the system timezone. Default overnight stages are aggregate at `01:00`, reconcile at `02:00`, generate at `03:00`, and send at `09:00`.
- Default no-reply timeout is 24 hours; a task node override takes precedence.
- Core cards use period-occurrence semantics. Task funnels use the period's newly-added-customer cohort.
- Task and tag definitions use stable IDs and immutable configuration versions. Cross-version funnels render separately.
- Generated reports and sent reports are immutable. Corrections create a new revision.
- The responsive full report requires workspace-session and Bot authorization; WeCom summaries do not include full transcripts or sensitive customer detail.
- Cockpit typography, spacing, radii, borders, shadows, buttons, forms, and feedback states reuse the current console design language.
- Cockpit sections and metrics use cards with icons from the existing SVG sprite; do not use emoji or introduce a mismatched icon library.
- Information order is conclusion, core metrics, problems, actions, charts, then details. Color is never the only carrier of risk, trend, or status.
- Responsive design reorders content for mobile instead of scaling down the desktop grid. Clickable cards require hover, keyboard-focus, and pressed states.
- Use only existing runtime dependencies unless a later task proves a dependency is necessary and records that decision.

---

## Planned File Structure

**Create**

- `src/cockpit-domain.js` — pure normalization, period, timeout, metric, and chart calculations.
- `src/cockpit-events.js` — fail-open sidecar event helpers; no worker or HTTP concerns.
- `src/cockpit-aggregator.js` — incremental snapshot and reconciliation orchestration.
- `src/cockpit-report-generator.js` — prompt construction, response validation, report document assembly.
- `src/cockpit-worker.js` — non-overlapping staged scheduler and retry policy.
- `src/cockpit-delivery.js` — WeCom summary formatting and delivery.
- `public/console/cockpit.js` — cockpit state, API loading, rendering, drill-down, report history.
- `tests/cockpit-domain.test.js`
- `tests/cockpit-events.test.js`
- `tests/db-cockpit.test.js`
- `tests/cockpit-aggregator.test.js`
- `tests/cockpit-report-generator.test.js`
- `tests/cockpit-worker.test.js`
- `tests/cockpit-delivery.test.js`
- `tests/server-cockpit-boundary.test.js`
- `tests/console-cockpit-boundary.test.js`

**Modify**

- `src/db.js` — cockpit tables, repositories, config-version persistence, deletion coverage.
- `src/server.js` — fail-open event call sites, cockpit APIs, worker startup, report routes.
- `src/config.js` — cockpit worker defaults and bounded environment parsing.
- `src/dclaw.js` — isolated report-purpose request builder; conversation request behavior remains unchanged.
- `public/console/index.html` — cockpit tab/panel, reordered tabs, report/config controls, script include.
- `public/console/app.js` — default-tab behavior, Bot-context hooks, shared cockpit integration.
- `public/console/styles.css` — balanced Bot-theme cockpit and responsive layout.
- `.env.example` — low-traffic stage, concurrency, timeout, and retention settings.
- `README.md` — operating model, schedules, failure behavior, and manual rebuild instructions.

---

### Task 1: Cockpit Navigation and Empty Shell

**Files:**
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Test: `tests/console-cockpit-boundary.test.js`

**Interfaces:**
- Consumes: existing `switchWorkspaceTab(tabName, options)`, `setBindingState(bot)`, `--bot-accent`.
- Produces: `[data-workspace-tab="cockpit"]`, `[data-tab-panel="cockpit"]`, `window.cockpitConsole.setBotContext(context)`, and `window.cockpitConsole.clear()`.

- [ ] **Step 1: Write the failing console boundary tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");

test("cockpit is the first workspace tab and config is last", () => {
  const names = [...html.matchAll(/data-workspace-tab="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(names, ["cockpit", "sessions", "flow", "groups", "tags", "push", "logs", "config"]);
});

test("an unlocked bot defaults to cockpit for admin and employee roles", () => {
  assert.match(app, /switchWorkspaceTab\("cockpit",\s*\{\s*force:\s*true\s*\}\)/);
  assert.doesNotMatch(app, /state\.currentRole === "admin" \? "config" : "sessions"/);
});

test("cockpit panel loads its dedicated client", () => {
  assert.match(html, /data-tab-panel="cockpit"/);
  assert.match(html, /src="\.\/cockpit\.js"/);
});
```

- [ ] **Step 2: Run the tests and verify the new contract fails**

Run: `node --test tests/console-cockpit-boundary.test.js`
Expected: FAIL because the cockpit tab, panel, script, and default behavior do not exist.

- [ ] **Step 3: Add the tab, empty panel, and integration hooks**

Add the cockpit button before sessions and move config after logs. Add a cockpit icon to the existing SVG sprite using the same stroke treatment as current icons. Add a `cockpitTab` panel containing loading, stale, empty, and content roots. In `app.js`, call:

```js
window.cockpitConsole?.setBotContext({
  botId: state.selectedBotId,
  role: state.currentRole,
  accent: getComputedStyle(document.documentElement).getPropertyValue("--bot-accent").trim()
});
switchWorkspaceTab("cockpit", { force: true });
```

Call `window.cockpitConsole?.clear()` from `clearBotScopedContent()`.

- [ ] **Step 4: Add minimal balanced-theme shell styles**

Use only `var(--bot-accent)`, `color-mix()`, and existing global tokens. Match current panel, border, radius, shadow, typography, button, and focus treatment. Do not add chart styling yet.

- [ ] **Step 5: Run the focused and existing console tests**

Run: `node --test tests/console-cockpit-boundary.test.js tests/console-workspace-boundary.test.js tests/console-auth-boundary.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/console/index.html public/console/app.js public/console/styles.css tests/console-cockpit-boundary.test.js
git commit -m "feat: add cockpit workspace shell"
```

### Task 2: Cockpit Schema and Bot-Scoped Repositories

**Files:**
- Modify: `src/db.js`
- Test: `tests/db-cockpit.test.js`

**Interfaces:**
- Produces:
  - `appendCockpitEvent(input): { inserted: boolean, eventId: number | null }`
  - `listCockpitEvents({ botId, afterId, throughAt, limit }): CockpitEvent[]`
  - `incrementCockpitDailyCounter({ botId, localDate, metricKey, amount }): number`
  - `getCockpitDailyCounters({ botId, localDate }): Record<string, number>`
  - `upsertCockpitConfig({ botId, config }): CockpitConfig`
  - `getCockpitConfig(botId): CockpitConfig`
  - `saveCockpitDefinitionVersion(input): CockpitDefinitionVersion`
  - `getCockpitAggregationCursor(botId): CockpitAggregationCursor`
  - `saveCockpitAggregationCursor(input): CockpitAggregationCursor`
  - `saveCockpitSnapshot(input): CockpitSnapshot`
  - `getLatestCockpitSnapshot({ botId, periodType, periodStart }): CockpitSnapshot | null`
  - `createCockpitReport(input): CockpitReport`
  - `createCockpitReportRevision(input): CockpitReport`
  - `listCockpitReports(input): { items, total }`
  - `createCockpitDelivery(input): CockpitDelivery`
  - `claimDueCockpitDeliveries({ now, limit }): CockpitDelivery[]`
  - `createCockpitJob(input): CockpitJob`
  - `claimDueCockpitJobs({ stage, now, limit }): CockpitJob[]`

- [ ] **Step 1: Write failing repository tests**

Cover all of these assertions with concrete Bot IDs `bot-a` and `bot-b`:

```js
assert.equal(db.appendCockpitEvent(event).inserted, true);
assert.equal(db.appendCockpitEvent(event).inserted, false); // same eventKey
assert.deepEqual(db.listCockpitEvents({ botId: "bot-b", afterId: 0, limit: 100 }), []);
assert.equal(db.getCockpitConfig("bot-a").defaultNoReplyHours, 24);
assert.equal(db.createCockpitReportRevision({ reportId: first.id, ...input }).revision, 2);
```

Also test that `deleteBotData("bot-a")` deletes only `bot-a` cockpit events, versions, counters, snapshots, reports, and deliveries.

- [ ] **Step 2: Run the repository tests**

Run: `node --test tests/db-cockpit.test.js`
Expected: FAIL on missing exports.

- [ ] **Step 3: Add tables and indexes**

Add:

```sql
cockpit_events(event_key UNIQUE, bot_id, conversation_key, customer_key, event_type,
  occurred_at, received_at, flow_version_id, tag_version_id, payload_json, source_ref_json)
cockpit_daily_counters(bot_id, local_date, metric_key, metric_value, updated_at,
  PRIMARY KEY(bot_id, local_date, metric_key))
cockpit_configs(bot_id PRIMARY KEY, config_json, created_at, updated_at)
cockpit_definition_versions(id, bot_id, definition_type, semantic_hash, version_number,
  revision_number, config_json, effective_at, created_at,
  UNIQUE(bot_id, definition_type, version_number, revision_number))
cockpit_aggregation_cursors(bot_id PRIMARY KEY, last_event_id, last_success_at, last_error, updated_at)
cockpit_snapshots(id, bot_id, period_type, period_start, period_end, status,
  source_through_event_id, metrics_json, charts_json, definitions_json, generated_at, created_at)
cockpit_reports(id, bot_id, snapshot_id, report_type, period_start, period_end, revision,
  status, summary_json, document_json, ai_error, generated_at, created_at,
  UNIQUE(bot_id, report_type, period_start, period_end, revision))
cockpit_deliveries(id, report_id, bot_id, recipient, status, attempt_number,
  due_at, sent_at, error_message, worktool_response_json, created_at, updated_at)
cockpit_jobs(id, bot_id, stage, payload_json, status, attempt_number, due_at,
  processing_started_at, finished_at, error_message, created_at, updated_at)
```

Add indexes for event cursor reads, snapshot period reads, due deliveries, due jobs, and report history.

- [ ] **Step 4: Add row mappers and exact repository exports**

Normalize JSON at the boundary and return camelCase objects. Default config:

```js
{
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  defaultNoReplyHours: 24,
  nodeNoReplyHours: {},
  schedules: {
    daily: { enabled: false, sendAt: "09:00", recipients: [] },
    weekly: { enabled: false, sendAt: "09:00", recipients: [] },
    monthly: { enabled: false, sendAt: "09:00", recipients: [] }
  }
}
```

- [ ] **Step 5: Run the repository and Bot-isolation tests**

Run: `node --test tests/db-cockpit.test.js tests/db-bot-isolation.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db.js tests/db-cockpit.test.js
git commit -m "feat: add cockpit persistence"
```

### Task 3: Fail-Open Event Sidecar

**Files:**
- Create: `src/cockpit-events.js`
- Modify: `src/server.js`
- Test: `tests/cockpit-events.test.js`
- Test: `tests/server-cockpit-boundary.test.js`

**Interfaces:**
- Consumes: `appendCockpitEvent(input)` from Task 2 and existing logger.
- Produces:
  - `createCockpitEventRecorder({ appendEvent, incrementCounter, logWarn })`
  - `recorder.record(input): void`
  - `cockpitEventKey(input): string`

- [ ] **Step 1: Write fail-open and idempotency tests**

```js
test("record never throws when persistence fails", () => {
  const recorder = createCockpitEventRecorder({
    appendEvent() { throw new Error("disk busy"); },
    incrementCounter() { throw new Error("not reached"); },
    logWarn() {}
  });
  assert.doesNotThrow(() => recorder.record({
    botId: "bot-a",
    eventType: "customer_message",
    sourceType: "incoming_message",
    sourceId: "m-1",
    occurredAt: "2026-07-30T10:00:00.000Z"
  }));
});
```

Test that duplicate source identity produces the same key and increments a daily counter only when the event insert reports `inserted: true`.

- [ ] **Step 2: Run the event tests**

Run: `node --test tests/cockpit-events.test.js`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the synchronous fail-open recorder**

`record()` catches every exception, logs `cockpit.event.failed`, returns immediately, and never returns a Promise. Counter keys are limited to `new_customer`, `successful_invitation`, and `effective_conversation` in this task.

- [ ] **Step 4: Add post-success call sites**

Add sidecar calls only after existing business persistence succeeds:

- after `insertIncomingMessage()` for private customer messages;
- after confirmed outgoing message persistence for AI and manual replies;
- after friend-added handling succeeds;
- after flow transition persistence succeeds;
- after accepted tag add/remove persistence succeeds;
- after handoff state persistence succeeds.

Do not add `await`, do not change existing return values, and do not move existing statements.

- [ ] **Step 5: Add static reply-path boundary tests**

Assert:

```js
assert.doesNotMatch(serverSource, /await\s+cockpitEventRecorder\.record/);
assert.match(serverSource, /cockpitEventRecorder\.record/);
assert.doesNotMatch(cockpitEventSource, /aggregate|generateReport|invokeDclaw/);
```

- [ ] **Step 6: Run focused reply regression tests**

Run: `node --test tests/cockpit-events.test.js tests/server-cockpit-boundary.test.js tests/server-reply-contract.test.js tests/server-agent-invocation-concurrency-boundary.test.js tests/worktool-callbacks.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/cockpit-events.js src/server.js tests/cockpit-events.test.js tests/server-cockpit-boundary.test.js
git commit -m "feat: record cockpit events fail open"
```

### Task 4: Immutable Flow and Tag Definition Versions

**Files:**
- Create: `src/cockpit-domain.js`
- Modify: `src/db.js`
- Modify: `src/server.js`
- Test: `tests/cockpit-domain.test.js`
- Test: `tests/db-cockpit.test.js`
- Test: `tests/server-cockpit-boundary.test.js`

**Interfaces:**
- Produces:
  - `semanticFlowDefinition(config): object`
  - `semanticTagDefinition(config): object`
  - `definitionSemanticHash(type, config): string`
  - `ensureCockpitDefinitionVersion({ botId, type, config, effectiveAt }): CockpitDefinitionVersion`

- [ ] **Step 1: Write semantic-version tests**

Use explicit fixtures proving:

- node rename with the same stable ID keeps the semantic version, increments `revisionNumber`, and stores an immutable display snapshot;
- node addition, deletion, transition change, or meaning-field change increments the flow version;
- tag rename with the same stable ID keeps the semantic version and increments `revisionNumber`;
- tag add/delete, group move, merge/split, or rule change increments the tag version;
- two Bots with the same config receive distinct version records.

- [ ] **Step 2: Run the version tests**

Run: `node --test tests/cockpit-domain.test.js tests/db-cockpit.test.js`
Expected: FAIL on missing functions.

- [ ] **Step 3: Implement canonical semantic hashing**

Sort groups, tags, nodes, transitions, and object keys by stable ID before hashing. Exclude presentation-only names from the semantic hash. Every changed saved config creates an immutable revision; only a changed semantic hash increments `versionNumber`.

- [ ] **Step 4: Version successful config saves**

After successful `PUT /api/flow-machines/:botId` and `PUT /api/tag-schemas/:botId`, call `ensureCockpitDefinitionVersion()` and append `flow_definition_changed` or `tag_definition_changed` when the semantic version increments.

- [ ] **Step 5: Run flow/tag and cockpit regression tests**

Run: `node --test tests/cockpit-domain.test.js tests/db-cockpit.test.js tests/server-cockpit-boundary.test.js tests/server-tags-api-boundary.test.js tests/flow-assets.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cockpit-domain.js src/db.js src/server.js tests/cockpit-domain.test.js tests/db-cockpit.test.js tests/server-cockpit-boundary.test.js
git commit -m "feat: version cockpit definitions"
```

### Task 5: Pure Period, Timeout, Funnel, and Tag Aggregation

**Files:**
- Modify: `src/cockpit-domain.js`
- Test: `tests/cockpit-domain.test.js`

**Interfaces:**
- Produces:
  - `periodBounds({ type, anchor, timezone }): { start, end, label }`
  - `classifyReplyRisk({ events, now, defaultNoReplyHours, nodeNoReplyHours }): "waiting" | "never_replied" | "stopped_replying" | "none"`
  - `aggregateOccurrenceMetrics(input): object`
  - `aggregateCohortFunnels(input): object[]`
  - `aggregateTagChanges(input): object[]`

- [ ] **Step 1: Add failing period and timezone tests**

Cover natural day, Monday-to-Sunday week, prior calendar month, leap day, and a period crossing UTC midnight in `Asia/Shanghai`.

- [ ] **Step 2: Add failing risk tests**

Cover never replied, previously replied then stopped, terminal task, still waiting, Bot 24-hour default, and a Node 12-hour override.

- [ ] **Step 3: Add failing aggregation tests**

Fixtures must prove:

- occurrence cards count an invitation completed today for a customer added earlier;
- cohort funnel excludes customers added before the period;
- “reached Node” counts once despite repeated transitions;
- current-stay distribution uses the latest node;
- flow versions produce separate funnels;
- tag current/add/remove/net values are correct;
- removed definitions remain in a historical result with `inactive: true`.

- [ ] **Step 4: Run and observe failures**

Run: `node --test tests/cockpit-domain.test.js`
Expected: FAIL on the new exports.

- [ ] **Step 5: Implement pure calculations**

Keep this module free of database, HTTP, environment, timers, and global clock access. All timestamps, timezones, and configs arrive as function arguments.

- [ ] **Step 6: Run the pure-domain tests**

Run: `node --test tests/cockpit-domain.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/cockpit-domain.js tests/cockpit-domain.test.js
git commit -m "feat: calculate cockpit metrics"
```

### Task 6: Incremental Aggregator, Snapshot Freezing, and Reconciliation

**Files:**
- Create: `src/cockpit-aggregator.js`
- Modify: `src/db.js`
- Test: `tests/cockpit-aggregator.test.js`
- Test: `tests/db-cockpit.test.js`

**Interfaces:**
- Consumes: Task 2 repositories and Task 5 pure functions.
- Produces:
  - `createCockpitAggregator(deps)`
  - `aggregator.aggregateBot({ botId, throughAt, periodTypes }): CockpitSnapshot[]`
  - `aggregator.reconcileBot({ botId, throughAt }): { corrected, unchanged }`
  - `aggregator.rebuildBot({ botId, from, throughAt }): CockpitSnapshot[]`

- [ ] **Step 1: Write incremental cursor tests**

Test that the first run reads from event ID 0, the second run starts after the saved cursor, an exception leaves the cursor unchanged, and a successful snapshot stores `sourceThroughEventId`.

- [ ] **Step 2: Write atomic snapshot tests**

Verify readers see the prior complete snapshot while a rebuild is running and see the new snapshot only after status becomes `ready`.

- [ ] **Step 3: Write reconciliation tests**

Inject a late event with an old `occurredAt`. Verify reconciliation creates a corrected snapshot and a revision candidate without mutating an already-sent report.

- [ ] **Step 4: Run the aggregator tests**

Run: `node --test tests/cockpit-aggregator.test.js tests/db-cockpit.test.js`
Expected: FAIL because the aggregator and cursor functions do not exist.

- [ ] **Step 5: Implement aggregation orchestration**

Use bounded event batches and SQLite transactions only around cursor/snapshot writes. Do calculation outside write transactions. Persist `definitionsJson` with every snapshot.

- [ ] **Step 6: Run focused tests**

Run: `node --test tests/cockpit-aggregator.test.js tests/db-cockpit.test.js tests/cockpit-domain.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/cockpit-aggregator.js src/db.js tests/cockpit-aggregator.test.js tests/db-cockpit.test.js
git commit -m "feat: aggregate cockpit snapshots"
```

### Task 7: Cockpit Config and Read APIs

**Files:**
- Modify: `src/server.js`
- Test: `tests/server-cockpit-boundary.test.js`
- Test: `tests/server-bot-isolation-boundary.test.js`
- Test: `tests/server-workspace-boundary.test.js`

**Interfaces:**
- Produces:
  - `GET /api/cockpit/:botId/overview?periodType=&anchor=`
  - `GET /api/cockpit/:botId/drilldown?kind=&key=&periodType=&anchor=&page=`
  - `GET /api/cockpit/:botId/reports?page=`
  - `GET /api/cockpit/:botId/reports/:reportId`
  - `GET /api/cockpit/:botId/config`
  - `PUT /api/cockpit/:botId/config`
  - `POST /api/cockpit/:botId/rebuild`

- [ ] **Step 1: Write route contract tests**

Assert exact response shapes. Overview:

```js
{
  ok: true,
  freshness: { completeAt, todayAt, delayed },
  period: { type, start, end, label },
  today: { newCustomers, successfulInvitations, effectiveConversations },
  metrics: {},
  funnels: [],
  nodeDistribution: [],
  tagGroups: [],
  latestReport: null
}
```

- [ ] **Step 2: Write authorization tests**

Verify wrong-Bot token, unassigned workspace, and locked Bot return the existing authorization error. Verify employee can read overview/report/drill-down but receives 403 for config update and rebuild.

- [ ] **Step 3: Run the server tests**

Run: `node --test tests/server-cockpit-boundary.test.js tests/server-bot-isolation-boundary.test.js tests/server-workspace-boundary.test.js`
Expected: FAIL because the routes do not exist.

- [ ] **Step 4: Add thin routes**

Routes validate inputs, call repositories/services, and return bounded payloads. They must not call `aggregateBot`, `reconcileBot`, `rebuildBot`, or report generation from overview/drill-down/report GET routes.

- [ ] **Step 5: Add async rebuild admission**

`POST /rebuild` creates a queued rebuild request and returns `202` with `{ ok: true, status: "queued" }`; it does not execute the rebuild in the request.

- [ ] **Step 6: Run the API tests**

Run: `node --test tests/server-cockpit-boundary.test.js tests/server-bot-isolation-boundary.test.js tests/server-workspace-boundary.test.js tests/server-auth-boundary.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server.js tests/server-cockpit-boundary.test.js tests/server-bot-isolation-boundary.test.js tests/server-workspace-boundary.test.js
git commit -m "feat: expose cockpit APIs"
```

### Task 8: Responsive Bot-Themed Cockpit UI

**Files:**
- Create: `public/console/cockpit.js`
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Test: `tests/console-cockpit-boundary.test.js`

**Interfaces:**
- Consumes: overview, drill-down, and reports APIs from Task 7.
- Produces: `window.cockpitConsole = { setBotContext, clear, refresh }`.

- [ ] **Step 1: Expand failing UI boundary tests**

Assert IDs for period switcher, freshness labels, AI summary, metric grid, funnel panel, node distribution, dynamic tag root, problems/actions, report history, and drill-down dialog. Assert every major card has an SVG icon and an accessible label. Assert CSS contains `var(--bot-accent)`, keyboard focus treatment, pressed state, and a mobile breakpoint.

- [ ] **Step 2: Run the UI boundary tests**

Run: `node --test tests/console-cockpit-boundary.test.js`
Expected: FAIL on missing elements and rendering functions.

- [ ] **Step 3: Implement request-state isolation**

Track `{ botId, contextVersion, abortController }`. Abort old requests on Bot switch, ignore stale responses, and never retain one Bot's metrics after another Bot is selected.

- [ ] **Step 4: Render the confirmed information hierarchy**

Implement:

1. period/freshness controls;
2. fixed AI summary slots;
3. occurrence metric cards with prior-period delta and tooltips;
4. separate versioned cohort funnels;
5. current node distribution;
6. dynamic tag groups and add/remove/net values;
7. problems, evidence links, actions, and priority customers;
8. report history and drill-down.

Use accessible HTML/CSS charts; do not add a chart dependency in the first version. Pair semantic colors with icons, text labels, and numeric values so color is never the only signal.

- [ ] **Step 5: Implement responsive behavior**

At narrow widths, order AI conclusion, metrics, problems, actions, then collapsible charts/details. Ensure horizontal metric scrolling has labels and keyboard access.

- [ ] **Step 6: Run console regression tests**

Run: `node --test tests/console-cockpit-boundary.test.js tests/console-workspace-boundary.test.js tests/console-session-type-boundary.test.js tests/console-tags-boundary.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add public/console/cockpit.js public/console/index.html public/console/app.js public/console/styles.css tests/console-cockpit-boundary.test.js
git commit -m "feat: render operations cockpit"
```

### Task 9: Fixed-Skeleton AI Report Generation

**Files:**
- Create: `src/cockpit-report-generator.js`
- Modify: `src/dclaw.js`
- Test: `tests/cockpit-report-generator.test.js`
- Test: `tests/dclaw-request-sanitization.test.js`

**Interfaces:**
- Produces:
  - `buildCockpitReportRequest({ binding, snapshot, evidence }): object`
  - `validateCockpitReportAnalysis(value): CockpitReportAnalysis`
  - `assembleCockpitReport({ snapshot, analysis }): CockpitReportDocument`
  - `createCockpitReportGenerator(deps).generate({ botId, snapshotId }): Promise<CockpitReport>`

- [ ] **Step 1: Write fixed-schema tests**

Require:

```js
{
  executiveSummary: string,
  topImprovement: { title, evidenceRefs: string[] },
  topProblem: { title, cause, evidenceRefs: string[] },
  primaryAction: { title, rationale },
  problems: [{ title, cause, affectedCount, evidenceRefs }],
  actions: [{ title, ownerHint, priority, relatedProblemIndex }],
  priorityCustomers: [{ conversationKey, reason }]
}
```

Reject unknown conversation keys, missing evidence references, invented metric keys, and raw transcript leakage.

- [ ] **Step 2: Run the generator tests**

Run: `node --test tests/cockpit-report-generator.test.js`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Add report-purpose DClaw request construction**

Use a distinct `dclawPurpose: "cockpit-report"` identity and a request payload containing only the frozen snapshot, bounded evidence excerpts, and the exact response schema. Do not modify the existing conversation prompt or response contract.

- [ ] **Step 4: Implement validation and immutable assembly**

Always assemble the fixed report skeleton from trusted snapshot numbers. AI supplies narrative fields only. If AI fails validation, save the statistical report with `aiError` and keep narrative slots unavailable.

- [ ] **Step 5: Run focused DClaw and report tests**

Run: `node --test tests/cockpit-report-generator.test.js tests/dclaw-request-sanitization.test.js tests/server-reply-contract.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cockpit-report-generator.js src/dclaw.js tests/cockpit-report-generator.test.js tests/dclaw-request-sanitization.test.js
git commit -m "feat: generate cockpit reports"
```

### Task 10: Low-Traffic Worker and Core-Reply Isolation

**Files:**
- Create: `src/cockpit-worker.js`
- Modify: `src/config.js`
- Modify: `src/server.js`
- Modify: `.env.example`
- Test: `tests/cockpit-worker.test.js`
- Test: `tests/server-cockpit-boundary.test.js`
- Test: `tests/server-agent-invocation-concurrency-boundary.test.js`

**Interfaces:**
- Consumes: aggregator, report generator, repositories.
- Produces: `createCockpitWorker(deps)` with `runOnce(now)`, `start()`, and `stop()`.

- [ ] **Step 1: Write stage and non-overlap tests**

Use a fake clock to prove aggregate, reconcile, generate, rebuild, and delivery claims only run in their stage; repeated ticks do not start a second run while the first is active.

- [ ] **Step 2: Write reply-isolation tests**

Prove the worker:

- is disabled by `COCKPIT_WORKER_ENABLED=false`;
- limits report AI concurrency to `COCKPIT_REPORT_MAX_CONCURRENCY=1`;
- never submits report work to the realtime conversation queue;
- catches top-level failures and schedules retry without rejecting the server interval;
- processes Bots in deterministic staggered batches.

- [ ] **Step 3: Run the worker tests**

Run: `node --test tests/cockpit-worker.test.js tests/server-agent-invocation-concurrency-boundary.test.js`
Expected: FAIL because the worker does not exist.

- [ ] **Step 4: Implement bounded configuration**

Add exact defaults:

```text
COCKPIT_WORKER_ENABLED=true
COCKPIT_WORKER_INTERVAL_MS=60000
COCKPIT_WORKER_BATCH_SIZE=5
COCKPIT_AGGREGATE_HOUR=1
COCKPIT_RECONCILE_HOUR=2
COCKPIT_GENERATE_HOUR=3
COCKPIT_REPORT_MAX_CONCURRENCY=1
COCKPIT_EVENT_BATCH_SIZE=1000
COCKPIT_RETRY_BASE_MS=60000
```

- [ ] **Step 5: Implement worker composition**

Start one non-overlapping interval after existing startup initialization. Report calls run through a cockpit-only concurrency limiter and only in the generate stage. No worker function is imported by `src/cockpit-events.js`.

- [ ] **Step 6: Run worker and reply-path regressions**

Run: `node --test tests/cockpit-worker.test.js tests/server-cockpit-boundary.test.js tests/server-agent-invocation-concurrency-boundary.test.js tests/agent-invocation-queue.test.js tests/server-reply-contract.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/cockpit-worker.js src/config.js src/server.js .env.example tests/cockpit-worker.test.js tests/server-cockpit-boundary.test.js tests/server-agent-invocation-concurrency-boundary.test.js
git commit -m "feat: schedule cockpit processing"
```

### Task 11: WeCom Summary Delivery and Report Authentication

**Files:**
- Create: `src/cockpit-delivery.js`
- Modify: `src/server.js`
- Modify: `src/db.js`
- Test: `tests/cockpit-delivery.test.js`
- Test: `tests/server-cockpit-boundary.test.js`
- Test: `tests/worktool-callbacks.test.js`

**Interfaces:**
- Produces:
  - `formatCockpitSummary({ report, bot, reportUrl }): string`
  - `createCockpitDeliveryService(deps).sendDue({ now, limit }): Promise<object[]>`
  - `GET /console/:slug/reports/:reportId`
  - `GET /api/cockpit/reports/:reportId/document`
  - `POST /api/cockpit/:botId/config/test-delivery`

- [ ] **Step 1: Write summary privacy tests**

Assert the summary contains Bot name, period, core metrics, top problem, primary action, and full report URL; assert it does not contain transcript excerpts, customer identifiers, or priority-customer names.

- [ ] **Step 2: Write retry and immutability tests**

First WorkTool send fails, second succeeds, attempts increment, and the report document/revision does not change.

- [ ] **Step 3: Write report-link authorization tests**

Verify the report document is denied without a valid workspace session, denied when the report Bot is not assigned to that workspace, and allowed for authorized employee/admin sessions.

- [ ] **Step 4: Run delivery tests**

Run: `node --test tests/cockpit-delivery.test.js tests/server-cockpit-boundary.test.js`
Expected: FAIL because delivery and report routes do not exist.

- [ ] **Step 5: Implement summary delivery**

Use existing `sendTextMessage({ robotId, targets, content })`. Create one delivery record per recipient. Mark success only after WorkTool accepts the command. Apply bounded exponential backoff and save the WorkTool response.

- [ ] **Step 6: Implement authenticated responsive report entry**

The page reuses the workspace authentication shell. After authentication, fetch the immutable report document API and render the same fixed hierarchy as the cockpit without exposing unrelated Bot data.

- [ ] **Step 7: Run delivery and WorkTool regressions**

Run: `node --test tests/cockpit-delivery.test.js tests/server-cockpit-boundary.test.js tests/worktool-callbacks.test.js tests/workspace-auth.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/cockpit-delivery.js src/server.js src/db.js tests/cockpit-delivery.test.js tests/server-cockpit-boundary.test.js tests/worktool-callbacks.test.js
git commit -m "feat: deliver cockpit reports"
```

### Task 12: Admin Configuration UI, History, and Manual Operations

**Files:**
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/cockpit.js`
- Modify: `public/console/styles.css`
- Test: `tests/console-cockpit-boundary.test.js`
- Test: `tests/server-cockpit-boundary.test.js`

**Interfaces:**
- Consumes: cockpit config, history, rebuild, manual generation, and test-delivery APIs.

- [ ] **Step 1: Add failing config UI tests**

Assert controls for per-report enablement, send time, recipients, timezone, default timeout, node overrides, test delivery, rebuild, generation history, and delivery history exist inside the config tab's admin-only area.

- [ ] **Step 2: Add the missing manual-generate API contract**

Test and implement:

```text
POST /api/cockpit/:botId/reports
body: { reportType, anchor }
response: 202 { ok: true, status: "queued", requestId }
```

The request queues generation; it does not call AI in the HTTP request.

- [ ] **Step 3: Implement config load/save with validation**

Reject duplicate/blank recipients, invalid IANA timezone, send times outside `HH:mm`, timeout outside `1..720` hours, and node override IDs absent from the current definition.

- [ ] **Step 4: Implement history/status UI**

Display report revision, generated time, sent/pending/failed delivery counts, AI status, and rebuild status. Keep employee view read-only.

- [ ] **Step 5: Run focused UI/API tests**

Run: `node --test tests/console-cockpit-boundary.test.js tests/server-cockpit-boundary.test.js tests/console-auth-boundary.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/console/index.html public/console/app.js public/console/cockpit.js public/console/styles.css src/server.js tests/console-cockpit-boundary.test.js tests/server-cockpit-boundary.test.js
git commit -m "feat: configure cockpit reports"
```

### Task 13: Full Regression, Operational Documentation, and Acceptance

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Test: all tests

**Interfaces:**
- Produces: documented deployment, rollback, rebuild, and verification procedure.

- [ ] **Step 1: Add operating documentation**

Document:

- no-request-time aggregation rule;
- 01:00/02:00/03:00/09:00 defaults;
- worker and concurrency environment variables;
- event, snapshot, report, and delivery retention behavior;
- manual rebuild and test-delivery operations;
- failure indicators and log event names;
- disabling `COCKPIT_WORKER_ENABLED` leaves reply behavior intact;
- historical reports remain immutable through flow/tag changes.

- [ ] **Step 2: Run formatting and placeholder checks**

Run:

```bash
git diff --check
rg -n "T[B]D|T[O]DO|implement[[:space:]]+later|fill[[:space:]]+in" src public tests README.md .env.example
```

Expected: no new formatting errors or cockpit placeholders.

- [ ] **Step 3: Run the complete test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Run the zero-intrusion acceptance subset again**

Run:

```bash
node --test \
  tests/cockpit-events.test.js \
  tests/cockpit-worker.test.js \
  tests/server-cockpit-boundary.test.js \
  tests/server-reply-contract.test.js \
  tests/server-agent-invocation-concurrency-boundary.test.js \
  tests/agent-response-gateway.test.js \
  tests/worktool-callbacks.test.js
```

Expected: all tests pass; no cockpit failure changes customer reply behavior.

- [ ] **Step 5: Perform manual responsive verification**

Start with `npm run dev`, unlock two differently colored Bots, and verify:

- each opens cockpit by default;
- theme changes without stale data;
- desktop multi-column and mobile single-column order match the design;
- refresh performs only GET requests;
- cross-version funnels render separately;
- report links require workspace authorization;
- disabling the worker does not affect inbound reply handling.

- [ ] **Step 6: Commit**

```bash
git add README.md .env.example
git commit -m "docs: operate AI cockpit"
```

## Execution Order and Review Gates

Tasks are sequential because later interfaces depend on earlier ones. Review after every commit. The minimum safe release boundary is Tasks 1–8 with AI reports and delivery disabled; Tasks 9–12 add report intelligence and distribution without changing cockpit read semantics. Do not enable scheduled delivery in production until Task 13 passes in full.
