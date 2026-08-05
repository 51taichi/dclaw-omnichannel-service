# Group List Name Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give group names the full flexible width of the sidebar card while keeping the date and local pin controls readable.

**Architecture:** Keep the existing group data and click handlers unchanged. Reorganize each card's inner grid into two rows, add a native full-name title, and lock the expected layout through the existing console boundary test.

**Tech Stack:** Vanilla JavaScript, CSS Grid, Node.js built-in test runner.

## Global Constraints

- Preserve the current group card height and list density.
- Preserve group selection and browser-local pin behavior.
- Keep the full eight-digit date visible.
- Do not modify backend code or APIs.

---

### Task 1: Readable Two-Row Group Cards

**Files:**
- Modify: `tests/console-group-management-boundary.test.js`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`

**Interfaces:**
- Consumes: the existing `renderGroupList()` group objects and pin state.
- Produces: a two-row `.groups-list-item-main` grid and a native `title` on the group name.

- [x] **Step 1: Write the failing boundary test**

Require the group name to render with `title="${escapeHtml(group.currentName)}"`, require a two-column grid with two rows, require the avatar to span both rows, and require the date badge to occupy the second row with no fixed minimum width.

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/console-group-management-boundary.test.js`

Expected: FAIL because the current layout uses three columns and the group name has no title.

- [x] **Step 3: Implement the minimal layout change**

Add the native title in `renderGroupList()`. Change `.groups-list-item-main` to `grid-template-columns: 44px minmax(0, 1fr)` and `grid-template-rows: auto auto`; make the avatar span rows 1 through 3, keep the copy in row 1, and place the date badge at the start of row 2.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/console-group-management-boundary.test.js tests/group-pins.test.js`

Expected: PASS.

- [x] **Step 5: Run full verification and inspect the page**

Run: `npm test` and `git diff --check`.

Inspect long and short group names in the browser, confirming that names, dates, and pin controls do not overlap and the card height remains stable.

- [x] **Step 6: Commit and push**

```bash
git add public/console/app.js public/console/styles.css tests/console-group-management-boundary.test.js docs/superpowers/plans/2026-08-06-group-list-name-layout-plan.md
git commit -m "fix: prioritize group names in sidebar cards"
git push origin main
```
