# Hide Cockpit Statistics Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the customer-facing statistics timezone and no-reply threshold controls while enforcing fixed `Asia/Shanghai` and `24` values in the existing cockpit configuration payload.

**Architecture:** Replace the two visible labeled controls with hidden form inputs using the confirmed defaults. Keep their existing names and make cockpit configuration hydration restore the fixed defaults, so `submitCockpitConfig` continues to use the same form contract without server changes.

**Tech Stack:** Static HTML, browser form APIs, Node.js built-in test runner.

## Global Constraints

- Statistics timezone stays `Asia/Shanghai`.
- Default no-reply threshold stays `24` hours.
- Preserve input names `timezone` and `defaultNoReplyHours` exactly.
- Do not change API requests, database normalization, aggregation, or report generation.
- Keep the existing three-column recipient layout and mobile fallback.

---

### Task 1: Hide System Statistics Defaults

**Files:**
- Modify: `tests/console-cockpit-boundary.test.js`
- Modify: `public/console/index.html`

**Interfaces:**
- Consumes: `cockpitConfigForm.timezone` and `cockpitConfigForm.defaultNoReplyHours` used by `public/console/app.js`.
- Produces: Hidden form controls with values `Asia/Shanghai` and `24`, retaining the same names and submission behavior.

- [x] **Step 1: Write the failing boundary test**

Add this test beside the existing cockpit report configuration boundary tests:

```js
test("cockpit keeps statistics rules as hidden system defaults", () => {
  const panelStart = html.indexOf('id="cockpitConfigPanel"');
  const panelEnd = html.indexOf('id="botBindingPanel"', panelStart);
  const panel = html.slice(panelStart, panelEnd);

  assert.doesNotMatch(panel, />统计时区</);
  assert.doesNotMatch(panel, />未回复阈值</);
  assert.match(panel, /<input name="timezone" type="hidden" value="Asia\/Shanghai" \/>/);
  assert.match(panel, /<input name="defaultNoReplyHours" type="hidden" value="24" \/>/);
});
```

- [x] **Step 2: Run the focused test and verify the expected failure**

Run:

```bash
node --test tests/console-cockpit-boundary.test.js
```

Expected: FAIL because the two settings are still rendered as visible labeled controls and the hidden inputs do not exist.

- [x] **Step 3: Replace the visible controls with fixed hidden inputs**

In `cockpitConfigForm`, replace the two current `<label>` blocks for statistics timezone and no-reply threshold with:

```html
<input name="timezone" type="hidden" value="Asia/Shanghai" />
<input name="defaultNoReplyHours" type="hidden" value="24" />
```

Update `public/console/app.js` so cockpit configuration hydration assigns `Asia/Shanghai` and `24` rather than persisted values. Keep the existing form reads and API payload shape unchanged.

- [x] **Step 4: Run focused and full verification**

Run:

```bash
node --test tests/console-cockpit-boundary.test.js
npm test
git diff --check
```

Expected: the focused test and complete suite pass with zero failures, and `git diff --check` exits successfully.

- [x] **Step 5: Commit and push only the related files**

```bash
git add docs/superpowers/specs/2026-08-01-hide-cockpit-statistics-defaults-design.md docs/superpowers/plans/2026-08-01-hide-cockpit-statistics-defaults.md public/console/index.html public/console/app.js tests/console-cockpit-boundary.test.js
git commit -m "Hide cockpit statistics defaults"
git push origin main
```
