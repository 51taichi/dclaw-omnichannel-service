# Group Management Three Tabs And Task Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split group management into base configuration, group roles, and group tasks while making task cards compact and operationally clear.

**Architecture:** Extend the existing mounted-panel group detail tabs from two to three values, then move existing markup between panels without changing request payloads or API routes. Reuse the current automation renderer and action binder, replacing only the rendered task-card controls and layout.

**Tech Stack:** Vanilla HTML templates in `app.js`, CSS Grid/Flexbox, browser DOM APIs, Node.js built-in test runner.

## Global Constraints

- Tab order is `config`, `roles`, `tasks`, displayed as 基础配置、群角色、群任务.
- Existing group configuration, role, automation, SSE, countdown, dialog, and backend API behavior must remain unchanged.
- “刷新判断” and “复制” disappear only from the task-card UI; backend routes are not removed.
- Destructive delete remains the system danger red and does not inherit Bot theming.
- Only frontend files and frontend boundary tests are changed.

---

### Task 1: Extend Group Detail Navigation To Three Tabs

**Files:**
- Modify: `public/console/group-detail-tabs.js`
- Modify: `public/console/app.js`
- Modify: `tests/group-detail-tabs.test.js`
- Modify: `tests/console-group-automation-boundary.test.js`

**Interfaces:**
- Consumes: `normalizeGroupDetailTab(value)` and `nextGroupDetailTab(currentTab, key)`.
- Produces: the same functions with the supported order `config -> roles -> tasks`.

- [ ] **Step 1: Write failing navigation tests**

Update the helper test expectations so `roles` is valid and arrow, Home, and End navigation follows all three tabs:

```js
assert.equal(normalizeGroupDetailTab("roles"), "roles");
assert.equal(nextGroupDetailTab("config", "ArrowRight"), "roles");
assert.equal(nextGroupDetailTab("roles", "ArrowRight"), "tasks");
assert.equal(nextGroupDetailTab("tasks", "ArrowRight"), "config");
assert.equal(nextGroupDetailTab("tasks", "ArrowLeft"), "roles");
```

Add boundary expectations for `groupDetailRolesTab`, `groupDetailRolesPanel`, and DOM order `config < roles < tasks`.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test tests/group-detail-tabs.test.js tests/console-group-automation-boundary.test.js
```

Expected: failures because `roles` normalizes to `config` and role tab/panel markup does not exist.

- [ ] **Step 3: Implement three-tab navigation and panel ownership**

Change the helper to:

```js
const tabOrder = ["config", "roles", "tasks"];

function normalizeGroupDetailTab(value) {
  return tabOrder.includes(value) ? value : "config";
}
```

In `renderGroupConfig()`, render three buttons in order and move the existing role header/form into:

```html
<div id="groupDetailRolesPanel"
     class="groups-detail-panel groups-role-panel"
     data-group-detail-panel="roles"
     role="tabpanel"
     aria-labelledby="groupDetailRolesTab">
  <!-- existing role header and form -->
</div>
```

Keep base fields inside `groupDetailConfigPanel`, and keep automation content inside `groupAutomationSection`.

- [ ] **Step 4: Run tests and verify GREEN**

Run the same focused test command and expect all tests to pass.

- [ ] **Step 5: Commit**

```bash
git add public/console/group-detail-tabs.js public/console/app.js tests/group-detail-tabs.test.js tests/console-group-automation-boundary.test.js
git commit -m "feat: split group roles into detail tab"
```

---

### Task 2: Rebuild Base And Task Panel Actions

**Files:**
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Modify: `tests/console-group-automation-boundary.test.js`
- Modify: `tests/console-group-management-boundary.test.js`

**Interfaces:**
- Consumes: existing `saveSelectedGroupConfig`, `openGroupAutomationDialog`, `syncGroupDetailTabs`.
- Produces: `#addGroupAutomationButton` inside the task panel and `.groups-panel-footer` for fixed bottom actions.

- [ ] **Step 1: Write failing panel-layout tests**

Assert that:

```js
assert.match(configPanel, />保存配置<\/button>/);
assert.doesNotMatch(configPanel, /保存群配置|群角色/);
assert.match(taskPanel, /id="addGroupAutomationButton"/);
assert.doesNotMatch(taskPanel, /按群内客观事实自动判断|<h3[^>]*>群定时任务/);
```

Require three equal tab columns and fixed panel footers:

```js
assert.match(css, /\.groups-detail-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s);
assert.match(css, /\.groups-panel-footer\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*0/s);
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test tests/console-group-automation-boundary.test.js tests/console-group-management-boundary.test.js
```

Expected: failures from the old two-column tabs, header-level add button, old description, and old save copy.

- [ ] **Step 3: Implement panel-local toolbars**

Remove the add button from `.groups-config-head`. Render a task toolbar inside `groupAutomationSection`:

```html
<div class="group-automation-toolbar">
  <button id="addGroupAutomationButton" class="primary" type="button">
    <!-- plus icon -->新增定时任务
  </button>
</div>
```

Remove the task heading and explanatory paragraph. Rename the base save button to `保存配置` and place it in:

```html
<div class="groups-panel-footer">
  <button class="primary groups-save-config" type="submit">保存配置</button>
</div>
```

Remove the obsolete add-button visibility toggle from `syncGroupDetailTabs()` because the button now exists only in the task panel.

- [ ] **Step 4: Add fixed content/footer layout styles**

Use three equal tab columns, make panel content independently scrollable, and keep each panel toolbar/footer visible. Preserve responsive wrapping at narrow widths without changing the main group workbench dimensions.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Task 2 focused test command and expect all tests to pass.

- [ ] **Step 6: Commit**

```bash
git add public/console/app.js public/console/styles.css tests/console-group-automation-boundary.test.js tests/console-group-management-boundary.test.js
git commit -m "refactor: align group detail panel actions"
```

---

### Task 3: Compact Group Automation Cards

**Files:**
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Modify: `tests/console-group-automation-boundary.test.js`

**Interfaces:**
- Consumes: `groupAutomationScheduleLabel(task)`, `formatGroupAutomationCountdown(nextRunAt)`, `formatGroupAutomationDateTime(value)`, `bindGroupAutomationActions()`.
- Produces: switch input with `data-group-automation-action="toggle"`; unchanged history, edit, and delete action identifiers.

- [ ] **Step 1: Write failing task-card tests**

Require a title-adjacent type chip, two metadata rows, and the retained controls:

```js
assert.match(app, /class="group-automation-type-tag"/);
assert.match(app, /class="group-automation-schedule-row"/);
assert.match(app, /class="group-automation-state-row"/);
assert.match(app, /data-group-automation-action="toggle"[^>]*type="checkbox"/);
assert.match(app, /data-group-automation-action="history"/);
assert.match(app, /data-group-automation-action="edit"/);
assert.match(app, /data-group-automation-action="delete"/);
assert.doesNotMatch(cardRenderer, /data-group-automation-action="refresh"|data-group-automation-action="duplicate"/);
```

Require button minimum widths and one-line schedule/state rows in CSS.

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
node --test tests/console-group-automation-boundary.test.js
```

Expected: failures because task type is a subtitle, metadata is split vertically, toggle is a text button, and refresh/duplicate are still rendered.

- [ ] **Step 3: Implement compact card markup**

Render the title as:

```html
<div class="group-automation-card-title">
  <strong>任务名称</strong>
  <span class="group-automation-type-tag">条件推送</span>
</div>
```

Render schedule and mentions together in `.group-automation-schedule-row`. Render business status, countdown, and next execution together in `.group-automation-state-row`. Add `title` to long mention text.

Replace the text toggle button with the existing switch markup pattern containing a checkbox carrying `data-group-automation-action="toggle"`. Keep the action binder reading the same action value, disable the switch while the PATCH is in flight, and reload the task list afterward.

Render only `记录`, `编辑`, and `删除` buttons after the switch. Do not render refresh or duplicate actions.

- [ ] **Step 4: Implement card and responsive styles**

Use a stable desktop grid, inline-flex metadata rows with `white-space: nowrap`, and ellipsis only on long mention names. Set retained action buttons to a larger shared minimum width. Update the existing container queries so actions move to a full row at 760px and all card sections stack at 520px.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Task 3 focused test command and expect all tests to pass.

- [ ] **Step 6: Run full regression and visual checks**

Run:

```bash
npm test
git diff --check
```

Open the local console at desktop and narrow viewport widths. Verify the three-tab order, fixed save action, panel-local add button, one-line task metadata, switch behavior, and no horizontal overflow.

- [ ] **Step 7: Commit and push**

```bash
git add public/console/app.js public/console/styles.css tests/group-detail-tabs.test.js tests/console-group-automation-boundary.test.js tests/console-group-management-boundary.test.js
git commit -m "feat: refine group task management UI"
git push origin main
```
