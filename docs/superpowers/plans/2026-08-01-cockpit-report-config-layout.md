# Cockpit Report Configuration Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the cockpit report configuration fields compact, aligned, and readable while preserving the existing save behavior.

**Architecture:** Keep the existing form and field names intact. Add presentation-only label icons, a visual hour suffix, and one native help tooltip in the panel header, then apply scoped CSS so global console forms are unaffected.

**Tech Stack:** Static HTML, CSS, Node.js built-in test runner.

## Global Constraints

- Do not change API requests, form field names, or report persistence behavior.
- Use the existing SVG icon sprite and native `title` tooltips.
- Keep recipient textareas full width and vertically center their compact labels.
- Keep the first row as two equal-width fields.

---

### Task 1: Lock The Compact Report Field Contract

**Files:**
- Modify: `tests/console-cockpit-boundary.test.js`
- Test: `tests/console-cockpit-boundary.test.js`

**Interfaces:**
- Consumes: `public/console/index.html` and `public/console/styles.css` as static source text.
- Produces: Regression assertions for compact copy, field icons, the hour unit, shared help text, and scoped alignment rules.

- [x] **Step 1: Write the failing test**

Add a boundary test that requires icon-prefixed labels named `统计时区`, `未回复阈值`, `日报接收人`, `周报接收人`, and `月报接收人`; requires one `小时` suffix and one native recipient help tooltip; rejects repeated recipient instructions in field labels; and checks the scoped label width and textarea-label alignment CSS.

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/console-cockpit-boundary.test.js`

Expected: FAIL because the current HTML still uses long labels without icons or a shared help control.

- [x] **Step 3: Commit the test with implementation**

The test ships with Task 2 after the implementation makes it pass.

### Task 2: Implement The Compact Report Configuration Layout

**Files:**
- Modify: `public/console/index.html`
- Modify: `public/console/styles.css`
- Test: `tests/console-cockpit-boundary.test.js`

**Interfaces:**
- Consumes: Existing form field names and the console SVG symbol sprite.
- Produces: A presentation-only layout that remains compatible with the current form submit handler.

- [x] **Step 1: Add compact icon labels and shared help**

Use `icon-clock` for timezone, `icon-history` for the no-reply threshold, and `icon-users` for recipient fields. Add a header help icon with `title="日报、周报和月报接收人每行填写一个企微联系人"`.

- [x] **Step 2: Add the visual hour suffix**

Wrap the existing `defaultNoReplyHours` input in `.cockpit-unit-control` and append `.cockpit-field-unit` containing `小时`. Keep the input `name`, type, minimum, default, and required attributes unchanged.

- [x] **Step 3: Add scoped alignment styles**

Set cockpit report labels to a consistent `148px` label column, vertically center recipient labels, and style the unit wrapper as a two-column control without adding a second border.

- [x] **Step 4: Run focused tests**

Run: `node --test tests/console-cockpit-boundary.test.js`

Expected: PASS.

- [x] **Step 5: Run the full test suite**

Run: `npm test`

Expected: all tests pass.

- [x] **Step 6: Commit and push**

```bash
git add docs/superpowers/plans/2026-08-01-cockpit-report-config-layout.md public/console/index.html public/console/styles.css tests/console-cockpit-boundary.test.js
git commit -m "Polish cockpit report configuration fields"
git push origin main
```
