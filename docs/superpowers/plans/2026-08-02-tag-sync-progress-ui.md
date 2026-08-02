# Tag Sync Progress UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the visible Bot binding panel and make manual tag synchronization reflect the real background-run lifecycle.

**Architecture:** Keep the existing tag-sync worker and status API unchanged. The console starts or resumes a run-specific polling loop, derives button busy state from that loop, and renders one terminal result row only after the tracked run finishes.

**Tech Stack:** Static HTML, CSS, browser JavaScript, Node.js test runner.

## Global Constraints

- Do not change tag-sync worker, database, WorkTool command, callback, or retry behavior.
- Treat `running` and `paused` as active states.
- Stop stale polling when the selected Bot context changes.
- Keep the hidden Bot form only as a compatibility state holder.

---

### Task 1: Define the console contract

**Files:**
- Modify: `tests/console-tag-sync-boundary.test.js`
- Modify: `tests/console-auth-boundary.test.js`
- Modify: `tests/console-cockpit-boundary.test.js`

**Interfaces:**
- Consumes: existing console HTML, JavaScript, and CSS source files.
- Produces: failing assertions for hidden Bot state form, run polling, busy button, and terminal result row.

- [ ] **Step 1: Write failing boundary tests**

Assert that `botBindingPanel` is absent, `botForm` is hidden, `runTagSyncNow` starts run tracking, and the CSS contains busy and result-row states.

- [ ] **Step 2: Run the focused tests**

Run: `node --test tests/console-tag-sync-boundary.test.js tests/console-auth-boundary.test.js tests/console-cockpit-boundary.test.js`

Expected: FAIL because the visible binding panel and stale status implementation still exist.

### Task 2: Implement the progress interaction

**Files:**
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`

**Interfaces:**
- Consumes: `POST /api/bots/:botId/tag-sync/run` and `GET /api/bots/:botId/tag-sync/status`.
- Produces: `trackTagSyncRun`, `setTagSyncBusy`, and terminal `renderTagSyncResult` behavior.

- [ ] **Step 1: Remove the visible panel and retain hidden fields**

Move the existing `botForm` fields into a hidden compatibility form outside the visible panel.

- [ ] **Step 2: Add run-specific polling**

Track the returned run ID, poll once per second, keep paused runs active, and invalidate polling on Bot-context changes.

- [ ] **Step 3: Add the busy and result visuals**

Disable the run button while tracking, rotate its refresh icon, and render the terminal counts in a full-width row below the actions.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/console-tag-sync-boundary.test.js tests/console-auth-boundary.test.js tests/console-cockpit-boundary.test.js`

Expected: PASS.

### Task 3: Verify and integrate

**Files:**
- Verify all modified files.

**Interfaces:**
- Consumes: repository test suite and Git history.
- Produces: one scoped commit pushed to `origin/main`.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 2: Review the diff**

Run: `git diff --check && git diff --stat && git status --short`

- [ ] **Step 3: Commit and push**

Commit only the design, plan, console UI, and associated boundary tests, then push `main`.
