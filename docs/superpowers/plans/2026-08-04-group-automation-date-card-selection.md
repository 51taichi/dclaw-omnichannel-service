# Group Automation Date Card Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the visible monthly-day checkbox controls and make each full date card communicate its selected state while preserving native multi-select behavior.

**Architecture:** Keep the existing `monthlyDay` checkbox inputs, values, form serialization, and month-page navigation unchanged. Scope new presentation rules to `.group-automation-month-page` so weekly choices and unrelated checkboxes retain their current UI; use the checked input state to style the containing label.

**Tech Stack:** Static HTML, CSS, Node.js built-in test runner.

## Global Constraints

- Keep the visible labels `1日` through `28日` and `月底` unchanged.
- Keep native checkbox semantics and form values while hiding only their visible square control.
- Preserve monthly multi-select, three-page navigation, keyboard behavior, responsive layout, and all weekly controls.
- Do not modify server scheduling or persistence logic.

---

### Task 1: Monthly Date Card Selection Styling

**Files:**
- Modify: `public/console/styles.css`
- Modify: `tests/console-group-automation-boundary.test.js`

**Interfaces:**
- Consumes: existing markup `label > input[name="monthlyDay"]` inside `.group-automation-month-page`.
- Produces: visually hidden native monthly checkbox controls and label-level checked styling via `.group-automation-month-page label:has(input:checked)`.

- [ ] **Step 1: Write the failing boundary test**

Add assertions to `tests/console-group-automation-boundary.test.js` that require monthly-only checkbox hiding and label-level checked styling:

```js
assert.match(
  css,
  /\.group-automation-month-page\s+label\s*>\s*input\[type="checkbox"\]\s*\{[^}]*position:\s*absolute;[^}]*opacity:\s*0;/
);
assert.match(
  css,
  /\.group-automation-month-page\s+label:has\(input:checked\)\s*\{[^}]*border-color:\s*var\(--accent\);[^}]*background:/
);
assert.doesNotMatch(css, /\.group-automation-week-days[^}]*opacity:\s*0;/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/console-group-automation-boundary.test.js
```

Expected: FAIL because the monthly date inputs still use the visible global checkbox styling and the full label has no checked-state rule.

- [ ] **Step 3: Implement the minimal monthly-only CSS**

Add scoped rules in `public/console/styles.css`:

```css
.group-automation-month-page label {
  position: relative;
  cursor: pointer;
}

.group-automation-month-page label > input[type="checkbox"] {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  opacity: 0;
  pointer-events: none;
}

.group-automation-month-page label:has(input:checked) {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 26%, transparent);
}

.group-automation-month-page label:has(input:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

- [ ] **Step 4: Run focused and complete verification**

Run:

```bash
node --test tests/group-automation-schedule-picker.test.js tests/console-group-automation-boundary.test.js tests/group-automation-schedule.test.js
npm test
git diff --check
```

Expected: all focused tests and the complete suite pass, and `git diff --check` reports no whitespace errors.

- [ ] **Step 5: Commit**

```bash
git add public/console/styles.css tests/console-group-automation-boundary.test.js
git commit -m "fix: use cards for monthly date selection"
```
