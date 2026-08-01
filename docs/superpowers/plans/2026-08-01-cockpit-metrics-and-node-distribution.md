# Cockpit Metrics And Node Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep four-digit cockpit metrics readable and make task-node distribution reflect each period-active customer's latest recognized task state.

**Architecture:** Preserve the existing cockpit rendering and aggregation boundaries. Update the console formatter and CSS in place, then update `periodNodeDistribution` so activity selects the population while pre-period node history supplies the latest state; no API or persistence schema changes are required.

**Tech Stack:** Node.js ESM, built-in `node:test`, server-rendered aggregation objects, vanilla JavaScript and CSS.

## Global Constraints

- Values from `0` through `9999` display as complete integers.
- Values from `10000` retain the existing `万` and `亿` compaction.
- Full comma-separated values remain available in native `title` tooltips.
- Node rows include only configured task nodes and visible percentages total 100%.
- Do not alter message processing, task transitions, API contracts, or persisted schemas.

---

### Task 1: Four-Digit Cockpit Metrics

**Files:**
- Modify: `tests/console-cockpit-boundary.test.js`
- Modify: `public/console/cockpit.js`
- Modify: `public/console/styles.css`

**Interfaces:**
- Consumes: `formatDashboardNumber(value)` and the existing metric-card markup.
- Produces: unchanged formatted string output contract and unchanged cockpit DOM structure.

- [x] **Step 1: Write the failing boundary assertions**

Replace the existing thousand-unit assertions with source-boundary assertions requiring no `千` branch, retaining `10000`/`万` and `100000000`/`亿`, a `76px` value column, and a maximum metric font size of `26px`.

- [x] **Step 2: Run the focused boundary test and verify failure**

Run: `node --test tests/console-cockpit-boundary.test.js`

Expected: FAIL because the formatter still contains the `千` branch and the CSS still reserves `58px`.

- [x] **Step 3: Implement the formatter and layout update**

Remove the `number >= 1000` compact branch from `formatDashboardNumber`, change `.cockpit-metric-card` to `grid-template-columns: minmax(5em, 1fr) 76px`, and reduce the strong-value clamp maximum to `26px`. Keep tabular numerals, right alignment, ellipsis protection, and the exact `title` value.

- [x] **Step 4: Run the focused boundary test and verify success**

Run: `node --test tests/console-cockpit-boundary.test.js`

Expected: PASS.

### Task 2: Latest Recognized Task-Node Distribution

**Files:**
- Modify: `tests/cockpit-aggregator.test.js`
- Modify: `src/cockpit-aggregator.js`

**Interfaces:**
- Consumes: `periodNodeDistribution({ events, period, definitions })` through `createCockpitAggregator().aggregateBot(...)`.
- Produces: `charts.nodeDistribution` rows shaped as `{ nodeId, nodeName, reached, share, basis: "period_final_state" }`.

- [x] **Step 1: Write the failing aggregation test**

Build a daily-period fixture containing: an active customer whose latest node predates the period; an active customer whose later node before period end overrides an earlier node; an active customer with no node; and an active customer whose latest node is unknown. Assert that only configured latest nodes remain, no `__conversation__` row is emitted, configured order is preserved, and visible shares sum to `1`.

- [x] **Step 2: Run the focused aggregation test and verify failure**

Run: `node --test tests/cockpit-aggregator.test.js`

Expected: FAIL because the current implementation scans only same-period node events and adds an `其他（未进入任务）` row.

- [x] **Step 3: Implement latest-state aggregation**

Keep active-customer discovery period-scoped. For those customers, scan all `node_reached` events strictly before `period.end`, select the latest event by timestamp and then ID, discard customers whose latest node is absent from `definitions`, count recognized nodes, and divide by the recognized count. Return an empty array when there are no recognized nodes.

- [x] **Step 4: Run the focused aggregation test and verify success**

Run: `node --test tests/cockpit-aggregator.test.js`

Expected: PASS.

### Task 3: Regression Verification And Delivery

**Files:**
- Verify: `public/console/cockpit.js`
- Verify: `public/console/styles.css`
- Verify: `src/cockpit-aggregator.js`
- Verify: `tests/console-cockpit-boundary.test.js`
- Verify: `tests/cockpit-aggregator.test.js`

**Interfaces:**
- Consumes: Tasks 1 and 2 implementations.
- Produces: a tested commit on `main` pushed to `origin/main`.

- [x] **Step 1: Run both focused test files together**

Run: `node --test tests/console-cockpit-boundary.test.js tests/cockpit-aggregator.test.js`

Expected: PASS.

- [x] **Step 2: Run the complete test suite**

Run: `npm test`

Expected: PASS with no failures.

- [x] **Step 3: Review the scoped diff**

Run: `git diff --check && git diff -- public/console/cockpit.js public/console/styles.css src/cockpit-aggregator.js tests/console-cockpit-boundary.test.js tests/cockpit-aggregator.test.js`

Expected: no whitespace errors and no unrelated changes.

- [x] **Step 4: Commit and push**

```bash
git add docs/superpowers/plans/2026-08-01-cockpit-metrics-and-node-distribution.md \
  public/console/cockpit.js public/console/styles.css src/cockpit-aggregator.js \
  tests/console-cockpit-boundary.test.js tests/cockpit-aggregator.test.js
git commit -m "Fix cockpit metric and node distribution display"
git push origin main
```
