# Group Automation Schedule Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overflowing monthly schedule choices with a fixed-height three-page horizontal picker and make weekly choices one row of seven equal columns.

**Architecture:** Put month-page calculation in a small browser-safe helper so it can be unit tested without the DOM. Keep selection values in the existing checkboxes, while `app.js` owns only the transient visible page and synchronizes arrow buttons, scroll position, and edit-mode initialization. The existing API payload and schedule validation remain unchanged.

**Tech Stack:** Browser JavaScript, HTML, CSS Grid, CSS Scroll Snap, Node.js built-in test runner.

## Global Constraints

- Monthly values remain limited to integers `1` through `28` and `month_end`.
- Monthly and weekly schedules remain multi-select and retain their current API payload shape.
- Monthly pages are exactly `1–10`, `11–20`, and `21–28 + 月底`.
- Weekly choices stay in one row of seven equal-width columns.
- The picker has fixed layout height and must not cover or push the fields below it unpredictably.
- Do not add polling; scroll synchronization must be event-driven.
- All work stays on the existing `main` branch.

---

### Task 1: Month-page domain helper

**Files:**
- Create: `public/console/group-automation-schedule-picker.js`
- Create: `tests/group-automation-schedule-picker.test.js`
- Modify: `public/console/index.html:1096-1104`

**Interfaces:**
- Produces: `window.GroupAutomationSchedulePicker.MONTH_DAY_PAGES`
- Produces: `window.GroupAutomationSchedulePicker.clampMonthPage(pageIndex): number`
- Produces: `window.GroupAutomationSchedulePicker.monthPageForScheduleDays(scheduleDays): number`
- Consumes: array values represented as numbers, numeric strings, or `month_end`.

- [ ] **Step 1: Write the failing helper tests**

```js
test("monthly schedule dates are split into three stable pages", () => {
  assert.deepEqual([...MONTH_DAY_PAGES[0]], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual([...MONTH_DAY_PAGES[1]], [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  assert.deepEqual([...MONTH_DAY_PAGES[2]], [21, 22, 23, 24, 25, 26, 27, 28, "month_end"]);
});

test("editing a monthly task opens the page containing its earliest selection", () => {
  assert.equal(monthPageForScheduleDays([18, 3, "month_end"]), 0);
  assert.equal(monthPageForScheduleDays([18, 25]), 1);
  assert.equal(monthPageForScheduleDays(["month_end"]), 2);
  assert.equal(monthPageForScheduleDays([]), 0);
});

test("month page indexes clamp at the first and last page", () => {
  assert.equal(clampMonthPage(-1), 0);
  assert.equal(clampMonthPage(1), 1);
  assert.equal(clampMonthPage(3), 2);
  assert.equal(clampMonthPage(Number.NaN), 0);
});
```

- [ ] **Step 2: Run the helper tests and verify RED**

Run: `node --test tests/group-automation-schedule-picker.test.js`

Expected: FAIL because `public/console/group-automation-schedule-picker.js` does not exist.

- [ ] **Step 3: Implement the browser-safe helper**

```js
(function exposeGroupAutomationSchedulePicker(global) {
  const MONTH_DAY_PAGES = Object.freeze([
    Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    Object.freeze([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]),
    Object.freeze([21, 22, 23, 24, 25, 26, 27, 28, "month_end"])
  ]);

  function clampMonthPage(pageIndex) {
    const value = Number(pageIndex);
    if (!Number.isFinite(value)) return 0;
    return Math.min(MONTH_DAY_PAGES.length - 1, Math.max(0, Math.trunc(value)));
  }

  function monthPageForScheduleDays(scheduleDays = []) {
    const selected = new Set(scheduleDays.map(String));
    const pageIndex = MONTH_DAY_PAGES.findIndex((page) => page.some((day) => selected.has(String(day))));
    return pageIndex < 0 ? 0 : pageIndex;
  }

  global.GroupAutomationSchedulePicker = Object.freeze({
    MONTH_DAY_PAGES,
    clampMonthPage,
    monthPageForScheduleDays
  });
})(typeof window !== "undefined" ? window : globalThis);
```

Load the new helper after `group-automation-status.js` and before `app.js`.

- [ ] **Step 4: Run helper tests and verify GREEN**

Run: `node --test tests/group-automation-schedule-picker.test.js`

Expected: all helper tests PASS.

- [ ] **Step 5: Commit the helper**

```bash
git add public/console/group-automation-schedule-picker.js public/console/index.html tests/group-automation-schedule-picker.test.js
git commit -m "feat: add monthly schedule page model"
```

---

### Task 2: Picker markup and event-driven page state

**Files:**
- Modify: `public/console/index.html:1048-1063`
- Modify: `public/console/app.js:1-110, 6132-6177, 6856-6863`
- Modify: `tests/console-group-automation-boundary.test.js:135-205`

**Interfaces:**
- Consumes: `MONTH_DAY_PAGES`, `clampMonthPage`, and `monthPageForScheduleDays` from Task 1.
- Produces: `syncGroupAutomationMonthPage({ scroll, behavior }): void`.
- Produces: DOM ids `groupAutomationMonthPrev`, `groupAutomationMonthNext`, `groupAutomationMonthViewport`, and `groupAutomationMonthPageStatus`.
- Keeps: existing checkbox names `weeklyDay` and `monthlyDay` and existing `groupAutomationScheduleDays(form)` behavior.

- [ ] **Step 1: Write failing boundary tests for the required structure and behavior**

```js
test("weekly scheduling is one seven-column row", () => {
  assert.match(html, /id="groupAutomationWeeklyDays"[^>]*group-automation-week-days/);
});

test("monthly scheduling uses three fixed horizontal pages", () => {
  assert.match(html, /id="groupAutomationMonthPrev"[^>]*aria-label="上一组执行日期"/);
  assert.match(html, /id="groupAutomationMonthNext"[^>]*aria-label="下一组执行日期"/);
  assert.match(html, /id="groupAutomationMonthViewport"/);
  assert.match(html, /data-month-page="0"[\s\S]*value="1"[\s\S]*value="10"/);
  assert.match(html, /data-month-page="1"[\s\S]*value="11"[\s\S]*value="20"/);
  assert.match(html, /data-month-page="2"[\s\S]*value="21"[\s\S]*value="month_end"/);
  assert.match(app, /monthPageForScheduleDays\(task\?\.cadence === "monthly" \? task\.scheduleDays : \[\]\)/);
  assert.match(app, /requestAnimationFrame\(/);
  assert.match(app, /Math\.round\(viewport\.scrollLeft \/ viewport\.clientWidth\)/);
});
```

- [ ] **Step 2: Run the boundary test and verify RED**

Run: `node --test tests/console-group-automation-boundary.test.js`

Expected: FAIL because the paging controls, page wrappers, state synchronization, and seven-column class are absent.

- [ ] **Step 3: Replace the weekly and monthly picker markup**

Use `group-automation-week-days` on the weekly fieldset. Wrap monthly choices in:

```html
<div class="group-automation-month-picker">
  <button id="groupAutomationMonthPrev" class="secondary group-automation-month-nav" type="button" aria-label="上一组执行日期">…</button>
  <div id="groupAutomationMonthViewport" class="group-automation-month-viewport" tabindex="0">
    <div class="group-automation-month-track">
      <div class="group-automation-month-page" data-month-page="0">1–10 日复选框</div>
      <div class="group-automation-month-page" data-month-page="1">11–20 日复选框</div>
      <div class="group-automation-month-page" data-month-page="2">21–28 日、月底复选框</div>
    </div>
  </div>
  <button id="groupAutomationMonthNext" class="secondary group-automation-month-nav" type="button" aria-label="下一组执行日期">…</button>
</div>
<div id="groupAutomationMonthPageStatus" class="group-automation-month-page-status" aria-live="polite">1 / 3</div>
```

Each monthly page must contain its real existing checkbox inputs; do not duplicate or replace their names and values.

- [ ] **Step 4: Add transient page state and synchronization**

Add `groupAutomationMonthPage: 0` to `state`, cache the four new controls in `els`, and destructure the Task 1 helper from `window.GroupAutomationSchedulePicker`.

Implement:

```js
function syncGroupAutomationMonthPage({ scroll = false, behavior = "smooth" } = {}) {
  const viewport = els.groupAutomationMonthViewport;
  if (!viewport) return;
  state.groupAutomationMonthPage = clampMonthPage(state.groupAutomationMonthPage);
  els.groupAutomationMonthPrev.disabled = state.groupAutomationMonthPage === 0;
  els.groupAutomationMonthNext.disabled = state.groupAutomationMonthPage === MONTH_DAY_PAGES.length - 1;
  els.groupAutomationMonthPageStatus.textContent = `${state.groupAutomationMonthPage + 1} / ${MONTH_DAY_PAGES.length}`;
  if (scroll && viewport.clientWidth) {
    viewport.scrollTo({ left: state.groupAutomationMonthPage * viewport.clientWidth, behavior });
  }
}
```

On dialog open, calculate the initial page with `monthPageForScheduleDays(...)`, unhide the dialog, then use `requestAnimationFrame` to perform an immediate aligned scroll. On cadence change to monthly, reset to page 0 only when the form is creating a new task; otherwise preserve the calculated edit page.

Bind previous/next click handlers to clamp the page and call `syncGroupAutomationMonthPage({ scroll: true })`. Bind the viewport `scroll` event through one `requestAnimationFrame` guard and calculate `Math.round(viewport.scrollLeft / viewport.clientWidth)` so touch and trackpad movement updates status without a timer.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node --test tests/group-automation-schedule-picker.test.js tests/console-group-automation-boundary.test.js`

Expected: all focused tests PASS; existing schedule extraction tests continue to pass.

- [ ] **Step 6: Commit the DOM behavior**

```bash
git add public/console/app.js public/console/index.html tests/console-group-automation-boundary.test.js
git commit -m "feat: paginate monthly schedule choices"
```

---

### Task 3: Stable responsive layout and end-to-end verification

**Files:**
- Modify: `public/console/styles.css:6620-6660, 7125-7160`
- Modify: `tests/console-group-automation-boundary.test.js:184-205`

**Interfaces:**
- Consumes: markup classes from Task 2.
- Produces: one-row seven-column weekly layout and one-row fixed-height month pages with scroll snapping.

- [ ] **Step 1: Write failing CSS boundary assertions**

```js
assert.match(css, /\.group-automation-week-days\s*\{[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/s);
assert.match(css, /\.group-automation-month-viewport\s*\{[^}]*overflow-x:\s*auto[^}]*scroll-snap-type:\s*x mandatory/s);
assert.match(css, /\.group-automation-month-track\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(3,\s*100%\)/s);
assert.match(css, /\.group-automation-month-page\s*\{[^}]*grid-template-columns:\s*repeat\(10,\s*minmax\(0,\s*1fr\)\)[^}]*scroll-snap-align:\s*start/s);
assert.match(css, /\.group-automation-month-picker\s*\{[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto/s);
assert.doesNotMatch(css, /\.group-automation-month-days\s*\{[^}]*overflow-y:\s*auto/s);
```

- [ ] **Step 2: Run the CSS boundary test and verify RED**

Run: `node --test tests/console-group-automation-boundary.test.js`

Expected: FAIL because the current month picker uses wrapping flex layout and vertical scrolling.

- [ ] **Step 3: Implement fixed responsive styles**

Use CSS Grid for the weekly fieldset and each monthly page. The month viewport hides its scrollbar while retaining scrolling, the track has three `100%` columns, and each page has ten equal slots with `scroll-snap-align: start`. Give the third page a generated empty final slot or an explicit inert spacer so its nine choices keep the same width as all other pages.

At `max-width: 700px`, reduce gaps and label padding but retain seven weekly columns and ten monthly columns. Date labels must use `min-width: 0`, centered content, and `white-space: nowrap` so text length cannot resize the grid.

- [ ] **Step 4: Run focused automated verification**

Run:

```bash
node --check public/console/app.js
node --check public/console/group-automation-schedule-picker.js
git diff --check
node --test tests/group-automation-schedule-picker.test.js tests/console-group-automation-boundary.test.js tests/group-automation-schedule.test.js
```

Expected: syntax and diff checks exit 0; all focused tests PASS.

- [ ] **Step 5: Run browser interaction verification**

Verify at desktop and narrow Dialog widths:

- Weekly mode shows exactly one row of seven equal-width choices.
- Monthly mode opens on page 1 for a new task.
- Arrow buttons move exactly one complete page and disable correctly at pages 1 and 3.
- Trackpad/touch horizontal scroll snaps to a complete page and updates `1 / 3`, `2 / 3`, or `3 / 3`.
- Selecting dates on multiple pages preserves every checkbox selection and produces the original schedule array.
- Editing a task with day 18 opens page 2; editing a task with only `month_end` opens page 3.
- The month picker never overlaps “达成条件” or changes height between pages.

- [ ] **Step 6: Run the full regression suite**

Run: `npm test`

Expected: all tests PASS with no failures, warnings, or unhandled errors.

- [ ] **Step 7: Commit the layout and verification changes**

```bash
git add public/console/styles.css tests/console-group-automation-boundary.test.js
git commit -m "fix: stabilize group schedule picker layout"
```
