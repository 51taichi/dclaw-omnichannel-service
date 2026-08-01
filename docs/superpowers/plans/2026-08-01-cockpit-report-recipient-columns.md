# Cockpit Report Recipient Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the daily, weekly, and monthly report recipient fields as three equal desktop columns with a single-column mobile fallback.

**Architecture:** Add one presentation-only wrapper around the three existing labels and scope a responsive CSS grid to that wrapper. Preserve every textarea name and the existing form submission path.

**Tech Stack:** Static HTML, CSS, Node.js built-in test runner.

## Global Constraints

- Preserve `dailyRecipients`, `weeklyRecipients`, and `monthlyRecipients` exactly.
- Do not change API requests or server persistence.
- Use three equal columns on desktop and one column at `760px` or below.

---

### Task 1: Add And Verify The Recipient Grid

**Files:**
- Modify: `tests/console-cockpit-boundary.test.js`
- Modify: `public/console/index.html`
- Modify: `public/console/styles.css`

**Interfaces:**
- Consumes: Existing cockpit report recipient labels and fields.
- Produces: `.cockpit-recipient-grid`, containing the three unchanged recipient controls.

- [x] **Step 1: Write the failing boundary test**

Require one `.cockpit-recipient-grid` containing all three textarea names, desktop `repeat(3, minmax(0, 1fr))`, and a `760px` single-column rule.

- [x] **Step 2: Run the focused test and verify failure**

Run: `node --test tests/console-cockpit-boundary.test.js`

Expected: FAIL because the wrapper and grid rules do not exist.

- [x] **Step 3: Implement the wrapper and responsive grid**

Wrap the three labels in `<div class="cockpit-recipient-grid wide">` and add scoped desktop and mobile CSS without changing field attributes.

- [x] **Step 4: Run focused and full tests**

Run: `node --test tests/console-cockpit-boundary.test.js && npm test`

Expected: all tests pass.

- [x] **Step 5: Commit and push**

```bash
git add docs/superpowers/plans/2026-08-01-cockpit-report-recipient-columns.md public/console/index.html public/console/styles.css tests/console-cockpit-boundary.test.js
git commit -m "Compact cockpit report recipients"
git push origin main
```
