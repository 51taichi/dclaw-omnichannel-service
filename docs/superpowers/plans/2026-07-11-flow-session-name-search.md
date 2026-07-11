# Flow Session Name Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace low-value date filters in the customer conversation module with a fuzzy name search.

**Architecture:** Keep filtering client-side in `public/console/app.js` because the session list is already loaded in memory. Update the console HTML and tests to reflect the new search control.

**Tech Stack:** Plain HTML, CSS, browser JavaScript, Node test runner.

## Global Constraints

- Do not change server APIs.
- Preserve asset filter, task state filter, human handoff pinning, and session sorting.
- Search `receivedName`, `groupName`, and `conversationKey`.

---

### Task 1: Replace Date Filters With Search

**Files:**
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `tests/console-handoff-boundary.test.js`

**Interfaces:**
- Consumes: existing `currentFlowSessions` array and `getVisibleFlowSessions()`.
- Produces: `flowSessionSearchInput` DOM control used by `getVisibleFlowSessions()`.

- [ ] **Step 1: Update tests first**

Change the flow-session filter test so it expects `flowSessionSearchInput` and no longer expects date inputs.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm test -- tests/console-handoff-boundary.test.js`

Expected: FAIL because `flowSessionSearchInput` does not exist yet.

- [ ] **Step 3: Update the HTML**

Remove the two date labels and add one search input with id `flowSessionSearchInput`.

- [ ] **Step 4: Update filtering logic**

Replace date parsing in `getVisibleFlowSessions()` with case-insensitive text matching against `receivedName`, `groupName`, and `conversationKey`. Change event wiring from `change` on date inputs to `input` on the search input.

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- tests/console-handoff-boundary.test.js
npm test
node --check public/console/app.js
```

Expected: all pass.
