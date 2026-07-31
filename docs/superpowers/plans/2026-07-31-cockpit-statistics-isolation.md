# Cockpit Statistics Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make daily, weekly, and monthly cockpit reports internally consistent while guaranteeing that cockpit failures cannot affect the core reply path.

**Architecture:** Cockpit remains a read-only, asynchronous projection over persisted business outcomes. Every report is generated from one immutable period snapshot; period charts never fall back to all-time state. Scheduled stages use persisted jobs and catch-up scheduling so service restarts cannot silently skip a report.

**Tech Stack:** Node.js ESM, built-in `node:test`, SQLite (`node:sqlite`), Express.

## Global Constraints

- Work directly on `main` as explicitly approved by the user.
- Do not change AI prompts, reply decisions, task transitions, tag decisions, message delivery, or customer records.
- Cockpit recording and processing failures must be swallowed or isolated after logging and must never reject the core reply operation.
- Daily periods are natural days, weekly periods are Monday-through-Sunday natural weeks, and monthly periods are natural calendar months in the Bot timezone.
- All cards and charts in a report must use the same immutable period snapshot.
- Do not resend rebuilt historical reports automatically.

---

### Task 1: Period-only cockpit snapshot

**Files:**
- Modify: `tests/cockpit-aggregator.test.js`
- Modify: `src/cockpit-aggregator.js`

**Interfaces:**
- Consumes: persisted cockpit events and Bot timezone configuration.
- Produces: `aggregateBot({ botId, throughAt, periodTypes })` snapshots whose metrics, node distribution, and tag changes all use the same period.

- [ ] **Step 1: Write failing tests**

Add tests proving that:

```js
assert.deepEqual(saved.charts.nodeDistribution, []);
assert.deepEqual(saved.charts.tags, []);
```

when a period has no matching events, even if historical baseline data exists.

Add a fixture containing events inside and outside the period and assert that only in-period node and tag events appear.

- [ ] **Step 2: Run tests and verify the old baseline fallback fails**

Run:

```bash
node --test tests/cockpit-aggregator.test.js
```

Expected: the period-only chart assertion fails because current code uses `baselineCharts`.

- [ ] **Step 3: Implement period-only charts**

Remove the all-time node fallback and current tag-stock merge from period snapshots. Preserve configuration ordering metadata only; never copy baseline counts into a period result.

- [ ] **Step 4: Run the focused tests**

Run:

```bash
node --test tests/cockpit-aggregator.test.js
```

Expected: all aggregator tests pass.

### Task 2: Exhaustive communication outcome and reconciliation

**Files:**
- Modify: `tests/cockpit-aggregator.test.js`
- Modify: `src/cockpit-aggregator.js`

**Interfaces:**
- Produces: `metrics.neverReplied`, `metrics.stoppedReplying`, and `metrics.effectiveConversations` as mutually exclusive outcomes for the new-customer cohort.
- Produces: snapshot reconciliation metadata without writing to core business tables.

- [ ] **Step 1: Write failing boundary tests**

Create fixtures for never replied, stopped replying, waiting, and effective customers. Assert:

```js
assert.equal(
  metrics.neverReplied + metrics.stoppedReplying + metrics.effectiveConversations,
  metrics.newCustomers
);
```

Also assert customer/reply message counts are derived only from in-period persisted events.

- [ ] **Step 2: Verify the tests fail for any overlapping classification**

Run:

```bash
node --test tests/cockpit-aggregator.test.js
```

- [ ] **Step 3: Implement one-outcome-per-customer classification**

Classify each new customer exactly once. Keep `waiting` and `handoffs` as independent operational states and exclude them from the exhaustive outcome equation.

- [ ] **Step 4: Verify aggregator behavior**

Run:

```bash
node --test tests/cockpit-aggregator.test.js tests/cockpit-domain.test.js
```

### Task 3: Persistent catch-up scheduling

**Files:**
- Modify: `tests/cockpit-worker.test.js`
- Modify: `src/cockpit-worker.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: persisted cockpit jobs through worker callbacks.
- Produces: due stages for the current local date even when the process starts after the configured hour.

- [ ] **Step 1: Write failing restart and catch-up tests**

Test that a worker starting at 04:00 can enqueue/run aggregate, reconcile, and generate in order, while a persisted completion check prevents duplicates.

- [ ] **Step 2: Verify current exact-hour scheduling fails**

Run:

```bash
node --test tests/cockpit-worker.test.js
```

- [ ] **Step 3: Implement catch-up stage selection and persisted idempotency**

Replace the in-memory-only completion decision with injected persisted completion checks. Preserve `forceStage` for administration and testing.

- [ ] **Step 4: Verify worker tests**

Run:

```bash
node --test tests/cockpit-worker.test.js
```

### Task 4: Core reply isolation regression

**Files:**
- Modify: `tests/cockpit-events.test.js`
- Modify: `src/cockpit-events.js`
- Modify only if necessary: `src/server.js`

**Interfaces:**
- Produces: a best-effort cockpit recorder that never rejects or changes the reply result.

- [ ] **Step 1: Write a failing isolation test**

Make the cockpit event persistence dependency throw and assert the surrounding reply-completion operation still resolves with the original reply result.

- [ ] **Step 2: Verify the failure reaches the caller today**

Run:

```bash
node --test tests/cockpit-events.test.js
```

- [ ] **Step 3: Isolate cockpit failures**

Catch recorder failures at the asynchronous cockpit boundary, log a bounded diagnostic, and do not mutate or delay the reply response.

- [ ] **Step 4: Verify failure isolation**

Run:

```bash
node --test tests/cockpit-events.test.js
```

### Task 5: Full verification and delivery

**Files:**
- Review: all changed files

**Interfaces:**
- Produces: a verified commit on `main`.

- [ ] **Step 1: Run the complete test suite**

Run:

```bash
npm test
```

- [ ] **Step 2: Inspect scope**

Run:

```bash
git diff --check
git diff --stat
git diff -- src/cockpit-aggregator.js src/cockpit-worker.js src/cockpit-events.js src/server.js
```

Confirm no core reply decision, task transition, tag decision, or delivery logic changed.

- [ ] **Step 3: Commit and push**

Run:

```bash
git add docs/superpowers/plans/2026-07-31-cockpit-statistics-isolation.md tests src
git commit -m "fix: isolate and reconcile cockpit reporting"
git push origin main
```
