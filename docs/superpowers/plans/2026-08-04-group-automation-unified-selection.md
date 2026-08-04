# Group Automation Unified Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make weekly dates, monthly dates, and mention roles use the same whole-card multi-select interaction, and place a real “启用任务” switch to the right of the task name.

**Architecture:** Preserve all native checkbox inputs and existing form serialization, but visually hide the weekly and mention inputs and drive one shared checked/focus card style from their native state. Restructure only the top name row so the existing `enabled` input uses the shared `switch-slider` component beside the name while retaining new/edit state handling.

**Tech Stack:** Static HTML, CSS, JavaScript form state, Node.js built-in test runner.

## Global Constraints

- Weekly dates, monthly dates, and mention roles use the same selected and keyboard-focus styles.
- Native `weeklyDay`, `monthlyDay`, and `mentionRoleId` checkbox values and multi-select behavior remain unchanged.
- The label remains “启用任务”; new tasks default on and edited tasks reflect their saved value.
- The switch stays to the right of the task name on desktop and narrow screens without shrinking.
- Task validation, payloads, APIs, scheduling, and unrelated controls remain unchanged.

---

### Task 1: Unify Weekly, Monthly, and Mention Card Selection

**Files:**
- Modify: `public/console/styles.css:6634-6760,6823-6865`
- Modify: `tests/console-group-automation-boundary.test.js`

**Interfaces:**
- Consumes: direct checkbox children inside `.group-automation-week-days label`, `.group-automation-month-page label`, and `.group-automation-mention-card`.
- Produces: one CSS state contract driven by `input:checked` and `input:focus-visible`.

- [ ] **Step 1: Write a failing shared-selection test**

Add a test requiring the three selectors to share hidden-input, checked-card, and focus-card rules:

```js
test("weekly monthly and mention choices share whole-card selection styles", () => {
  const choiceSelector = /:is\(\.group-automation-week-days label,\s*\.group-automation-month-page label,\s*\.group-automation-mention-card\)/;

  assert.match(
    css,
    new RegExp(`${choiceSelector.source}\\s*>\\s*input\\[type="checkbox"\\]\\s*\\{[^}]*position:\\s*absolute;[^}]*opacity:\\s*0;[^}]*pointer-events:\\s*none;`, "s")
  );
  assert.match(
    css,
    new RegExp(`${choiceSelector.source}:has\\(> input:checked\\)\\s*\\{[^}]*border-color:\\s*var\\(--accent\\);[^}]*background:\\s*var\\(--accent-soft\\);[^}]*color:\\s*var\\(--accent\\);`, "s")
  );
  assert.match(
    css,
    new RegExp(`${choiceSelector.source}:has\\(> input:focus-visible\\)\\s*\\{[^}]*outline:\\s*2px solid var\\(--accent\\);`, "s")
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/console-group-automation-boundary.test.js
```

Expected: FAIL because only monthly dates hide their checkbox and expose whole-card checked/focus styles.

- [ ] **Step 3: Implement the shared CSS contract**

Replace the monthly-only input and state rules with:

```css
:is(
  .group-automation-week-days label,
  .group-automation-month-page label,
  .group-automation-mention-card
) {
  cursor: pointer;
  position: relative;
  transition: background 160ms ease, border-color 160ms ease, box-shadow 160ms ease, color 160ms ease;
}

:is(
  .group-automation-week-days label,
  .group-automation-month-page label,
  .group-automation-mention-card
) > input[type="checkbox"] {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  opacity: 0;
  pointer-events: none;
}

:is(
  .group-automation-week-days label,
  .group-automation-month-page label,
  .group-automation-mention-card
):has(> input:checked) {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 26%, transparent);
}

:is(
  .group-automation-week-days label,
  .group-automation-month-page label,
  .group-automation-mention-card
):has(> input:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

Give weekly labels a transparent one-pixel border so selecting them cannot change their dimensions. Keep the mention card’s existing unselected border.

- [ ] **Step 4: Verify GREEN and commit**

Run:

```bash
node --test tests/console-group-automation-boundary.test.js tests/group-automation-schedule-picker.test.js tests/group-automation-schedule.test.js
git diff --check
```

Expected: all focused tests pass.

Commit:

```bash
git add public/console/styles.css tests/console-group-automation-boundary.test.js
git commit -m "fix: unify group automation choice cards"
```

---

### Task 2: Move the Enabled Switch Beside the Task Name

**Files:**
- Modify: `public/console/index.html:1035-1042,1081`
- Modify: `public/console/styles.css:6590-6635,6865`
- Modify: `tests/console-group-automation-boundary.test.js`

**Interfaces:**
- Consumes: the existing `input[name="enabled"]`, `openGroupAutomationDialog()` default/edit hydration, and `saveGroupAutomation()` payload serialization.
- Produces: `.group-automation-name-row` with the name field first and a complete `.switch-toggle.group-automation-enabled` second.

- [ ] **Step 1: Write a failing switch-layout test**

Add a test that requires the name and switch to share one ordered row and verifies unchanged new/edit state behavior:

```js
test("group automation enabled switch sits beside the task name and defaults on", () => {
  const dialog = html.slice(
    html.indexOf('id="groupAutomationDialog"'),
    html.indexOf('id="groupAutomationHistoryDialog"')
  );
  const nameRow = dialog.slice(
    dialog.indexOf('class="group-automation-name-row"'),
    dialog.indexOf('name="taskType"')
  );

  assert.ok(nameRow.indexOf('name="name"') < nameRow.indexOf('name="enabled"'));
  assert.match(nameRow, /name="enabled" type="checkbox" checked/);
  assert.match(nameRow, /class="switch-slider"/);
  assert.match(nameRow, /class="switch-label">启用任务<\/span>/);
  assert.equal((dialog.match(/name="enabled"/g) || []).length, 1);
  assert.match(app, /form\.enabled\.checked = task \? Boolean\(task\.enabled\) : true;/);
  assert.match(app, /enabled: form\.enabled\.checked/);
  assert.match(
    css,
    /\.group-automation-name-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;/s
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/console-group-automation-boundary.test.js
```

Expected: FAIL because no name row exists and the current bottom control does not contain `switch-slider`.

- [ ] **Step 3: Implement the name row and switch markup**

Wrap the task-name field and enabled control in:

```html
<div class="group-automation-name-row">
  <label class="group-automation-name-field">…existing task name field…</label>
  <label class="toggle switch-toggle group-automation-enabled">
    <input name="enabled" type="checkbox" checked />
    <span class="switch-slider" aria-hidden="true"></span>
    <span class="switch-label">启用任务</span>
  </label>
</div>
```

Remove the old enabled control from the bottom of the dialog body.

Add:

```css
.group-automation-name-row {
  align-items: stretch;
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(0, 1fr) auto;
  min-width: 0;
}

.group-automation-name-field {
  min-width: 0;
}

.group-automation-enabled {
  align-self: stretch;
  justify-self: end;
  white-space: nowrap;
  width: auto;
}
```

- [ ] **Step 4: Verify focused behavior and browser layout**

Run:

```bash
node --check public/console/app.js
node --test tests/console-group-automation-boundary.test.js tests/group-automation-schedule-picker.test.js tests/group-automation-schedule.test.js
```

Use a local browser preview to verify:

- weekly and mention cards have no visible checkbox;
- clicking whole cards toggles multiple selections and applies the same style as monthly cards;
- “启用任务” is a working slider to the right of the task name and begins on;
- at desktop and 480px widths the switch does not deform and the dialog does not overflow.

- [ ] **Step 5: Run complete verification, commit, and push**

Run:

```bash
npm test
git diff --check
```

Expected: the complete suite passes and the worktree is clean after commit.

Commit and push:

```bash
git add public/console/index.html public/console/styles.css tests/console-group-automation-boundary.test.js
git commit -m "fix: move group automation enabled switch"
git push origin main
```

Verify the local and remote `main` commit IDs are identical.
