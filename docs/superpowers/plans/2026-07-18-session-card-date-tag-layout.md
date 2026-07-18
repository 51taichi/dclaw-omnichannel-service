# Session Card Date Tag Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move customer date tags beside the fixed-width session name and widen the session sidebar for a compact, stable card layout.

**Architecture:** Split date tags from ordinary conversation tags at render time. Render the date in a dedicated first-row slot and keep ordinary tags in the existing second-row zone; CSS controls fixed name width, truncation, slot sizing, and the wider workbench column.

**Tech Stack:** Vanilla JavaScript templates, CSS Grid, Node.js test runner.

## Global Constraints

- Date tags render only when present.
- Names truncate with ellipsis and expose the full value through a native tooltip.
- Existing tag filters, task icons, asset icons, and handoff behavior remain unchanged.
- Do not modify backend persistence or APIs.

---

### Task 1: Lock the card contract with tests

**Files:**
- Modify: `tests/console-handoff-boundary.test.js`
- Modify: `tests/console-tags-boundary.test.js`

**Interfaces:**
- Consumes: `renderFlowSessions()` output and `public/console/styles.css`.
- Produces: regression assertions for `.flow-session-date-tag`, fixed-width name truncation, and a 310px sidebar.

- [ ] **Step 1: Add failing assertions** for separated date rendering, name `title`, first-row slot CSS, and the wider workbench column.
- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/console-handoff-boundary.test.js tests/console-tags-boundary.test.js`

Expected: FAIL because the dedicated date slot and new grid dimensions do not exist.

### Task 2: Implement the compact card layout

**Files:**
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`

**Interfaces:**
- Consumes: `session.tags`, `flowSessionDisplayName(session)`, and the existing handoff switch.
- Produces: `renderConversationDateTag(tags)` and ordinary-tag rendering without date duplication.

- [ ] **Step 1: Separate date and ordinary tags** so the date is rendered once in `.flow-session-date-tag`.
- [ ] **Step 2: Add full-name tooltip** using an escaped `title` attribute on the fixed-width name element.
- [ ] **Step 3: Update CSS Grid** to allocate avatar, fixed name, date, and switch columns; widen `.flow-workbench` to 310px.
- [ ] **Step 4: Run focused tests**

Run: `node --test tests/console-handoff-boundary.test.js tests/console-tags-boundary.test.js`

Expected: all focused tests pass.

### Task 3: Verify and publish

**Files:**
- Verify all modified files.

**Interfaces:**
- Consumes: completed UI implementation.
- Produces: tested commit on `main`.

- [ ] **Step 1: Run the full suite**

Run: `npm test`

Expected: zero failures.

- [ ] **Step 2: Check staged diff** with `git diff --check` and ensure unrelated working-tree files are excluded.
- [ ] **Step 3: Commit and push** only the spec, plan, UI, and focused tests.
