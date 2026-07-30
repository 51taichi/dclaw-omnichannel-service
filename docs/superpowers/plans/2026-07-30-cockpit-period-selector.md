# Cockpit Period Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add daily, weekly, and monthly period inputs to the cockpit and load only the selected generated snapshot.

**Architecture:** Keep period selection in the cockpit client state and pass an ISO `anchor` to the existing read-only overview route. The server resolves the natural period with existing domain logic and performs an exact snapshot lookup whenever an anchor is supplied.

**Tech Stack:** Browser JavaScript, Express, SQLite, Node test runner, CSS.

## Global Constraints

- Do not trigger aggregation or AI from cockpit reads.
- Do not modify the core reply pipeline.
- Daily defaults to yesterday, weekly to the previous complete Monday-Sunday week, and monthly to the previous month.
- Remove the complete-statistics timestamp and help icon.

---

### Task 1: Period selection behavior

**Files:**
- Modify: `tests/console-cockpit-boundary.test.js`
- Modify: `public/console/cockpit.js`
- Modify: `public/console/styles.css`

**Interfaces:**
- Consumes: browser date values from `input[type=date|week|month]`
- Produces: `state.anchor` as an ISO timestamp passed in the overview query

- [ ] Add failing assertions for all three input types, the anchor query parameter, right-aligned controls, and removal of freshness markup.
- [ ] Run `node --test tests/console-cockpit-boundary.test.js` and confirm the new assertions fail.
- [ ] Add default-period helpers, render one input for the selected report type, bind its change event, and pass `anchor`.
- [ ] Update toolbar CSS to use a right-aligned control group and delete obsolete freshness styles.
- [ ] Run the boundary test and confirm it passes.

### Task 2: Exact historical snapshot reads

**Files:**
- Modify: `tests/server-cockpit-boundary.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: optional `req.query.anchor`
- Produces: exact snapshot/report data for the resolved `period.start`

- [ ] Add a failing route-source assertion requiring explicit-anchor detection and prohibiting fallback when it is present.
- [ ] Run `node --test tests/server-cockpit-boundary.test.js` and confirm failure.
- [ ] Select by exact `periodStart` when anchor is supplied; retain latest fallback only for legacy requests without anchor.
- [ ] Filter report history to the selected report type and period start.
- [ ] Run the server boundary test and confirm it passes.

### Task 3: Verification and delivery

**Files:**
- Verify all changed files

**Interfaces:**
- Consumes: completed Tasks 1 and 2
- Produces: tested commit on `main`

- [ ] Run targeted cockpit tests and JavaScript syntax checks.
- [ ] Run `npm test` and confirm zero failures.
- [ ] Run `git diff --check`, review the diff, commit, rebase on `origin/main`, and push `main`.
