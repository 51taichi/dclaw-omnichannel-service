# Group Management Detail Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the selected-group detail area into “基础配置” and “群任务” sub-tabs, with the task creation action in the group header and the existing task form kept as a dialog.

**Architecture:** Keep both detail panels mounted inside `renderGroupConfig()` and introduce one isolated `state.groupDetailTab` plus a `syncGroupDetailTabs()` view synchronizer. Tab changes only toggle `hidden`, active styling, ARIA state, and the header task action; group changes still rebuild the selected group detail while preserving the chosen sub-tab.

**Tech Stack:** Existing vanilla HTML/CSS/JavaScript console, Node.js boundary tests, existing group automation dialog and SSE client.

## Global Constraints

- Development stays on `main`.
- The first selected group defaults to `基础配置`.
- Switching sub-tabs must not rerender the selected group or discard unsaved form drafts.
- Switching groups and leaving/re-entering the group-management workspace preserves the current sub-tab for the current page lifetime.
- “新增定时任务” appears only when `群任务` is active and opens the existing `groupAutomationDialog`.
- Existing task APIs, SSE updates, countdowns, task actions, and task dialog validation remain unchanged.
- Both panels stay mounted; visibility changes only through the `hidden` attribute.

---

### Task 1: Lock the detail-tab contract with a failing boundary test

**Files:**
- Modify: `tests/console-group-automation-boundary.test.js`
- Test: `tests/console-group-automation-boundary.test.js`

**Interfaces:**
- Consumes: the generated HTML string inside `renderGroupConfig()` and the existing `openGroupAutomationDialog()` handler.
- Produces: regression assertions for `state.groupDetailTab`, `syncGroupDetailTabs()`, `data-group-detail-tab`, `data-group-detail-panel`, and the header-level `addGroupAutomationButton`.

- [ ] **Step 1: Write the failing tests**

Add assertions that require:

```js
assert.match(app, /groupDetailTab:\s*"config"/);
assert.match(app, /data-group-detail-tab="config"/);
assert.match(app, /data-group-detail-tab="tasks"/);
assert.match(app, /data-group-detail-panel="config"/);
assert.match(app, /data-group-detail-panel="tasks"/);
assert.match(app, /function syncGroupDetailTabs\(\)/);
assert.match(app, /panel\.hidden\s*=\s*panel\.dataset\.groupDetailPanel\s*!==\s*activeTab/);
assert.match(app, /addButton\.hidden\s*=\s*activeTab\s*!==\s*"tasks"/);
```

Slice the `renderGroupConfig()` source and assert that `id="addGroupAutomationButton"` appears in `groups-config-head` before the sub-tab markup, while the `group-automation-head` slice no longer contains the button.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/console-group-automation-boundary.test.js
```

Expected: FAIL because the detail-tab state, markup, and synchronizer do not exist yet.

- [ ] **Step 3: Commit the red test together with the implementation in Task 2 after GREEN**

Do not commit a deliberately failing tree.

---

### Task 2: Implement the mounted dual-panel interaction

**Files:**
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Test: `tests/console-group-automation-boundary.test.js`

**Interfaces:**
- Consumes: `state.selectedGroupDetail`, `renderGroupConfig()`, `renderGroupAutomationList()`, and `openGroupAutomationDialog()`.
- Produces: `state.groupDetailTab: "config" | "tasks"` and `syncGroupDetailTabs(): void`.

- [ ] **Step 1: Add the minimal state and synchronizer**

Initialize:

```js
groupDetailTab: "config",
```

Implement `syncGroupDetailTabs()` so it normalizes unknown values to `config`, updates each `[data-group-detail-tab]` button’s `active` class and `aria-selected`, toggles each `[data-group-detail-panel]` with `hidden`, and shows `#addGroupAutomationButton` only for `tasks`.

- [ ] **Step 2: Split `renderGroupConfig()` into two mounted panels**

Change the rendered structure to:

```html
<div class="section-head groups-config-head">
  <div><h3><img class="group-asset-icon" src="./assets/group.png" alt="" aria-hidden="true" />${escapeHtml(group.currentName)}</h3></div>
  <button id="addGroupAutomationButton" class="primary" type="button" hidden><svg class="icon" aria-hidden="true"><use href="#icon-plus"></use></svg>新增定时任务</button>
</div>
<div class="segmented groups-detail-tabs" role="tablist" aria-label="群详情配置">
  <button data-group-detail-tab="config" role="tab" type="button"><svg class="icon" aria-hidden="true"><use href="#icon-tool"></use></svg>基础配置</button>
  <button data-group-detail-tab="tasks" role="tab" type="button"><svg class="icon" aria-hidden="true"><use href="#icon-clock"></use></svg>群任务</button>
</div>
<div class="groups-detail-panel" data-group-detail-panel="config"></div>
<section id="groupAutomationSection" class="group-automation-section groups-detail-panel" data-group-detail-panel="tasks">
  <div class="group-automation-head"><div><h3 id="groupAutomationTitle"><svg class="icon" aria-hidden="true"><use href="#icon-clock"></use></svg>群定时任务</h3><p>按群内客观事实自动判断、推送或生成周期汇总。</p></div></div>
  <div id="groupAutomationList" class="group-automation-list"><div class="empty-state">正在加载群定时任务…</div></div>
</section>
```

Move the existing `#groupConfigForm`, `.groups-role-head`, and `#groupRolesForm` nodes unchanged inside the `config` panel. Remove the duplicate add button from `.group-automation-head`.

- [ ] **Step 3: Bind tab and dialog actions without rerendering**

Bind each tab button to set `state.groupDetailTab`, then call `syncGroupDetailTabs()`. Keep the existing `#addGroupAutomationButton` click handler, and call `syncGroupDetailTabs()` once after all markup and event handlers are installed.

- [ ] **Step 4: Add fixed responsive styling**

Add card-and-icon styling for `.groups-detail-tabs` and `.groups-detail-panel`. Keep the header group-name cell `min-width: 0`, protect the name with ellipsis, and keep the header action from shrinking. On narrow containers allow the header action to wrap below the group name without changing button text or panel width. Ensure `[hidden]` panels use `display: none` and the task list retains its existing bounded internal scroll.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
node --test tests/console-group-automation-boundary.test.js tests/console-group-management-boundary.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit the feature**

```bash
git add public/console/app.js public/console/styles.css tests/console-group-automation-boundary.test.js
git commit -m "feat: split group details into config and task tabs"
```

---

### Task 3: Verify layout and regressions

**Files:**
- Verify: `public/console/app.js`
- Verify: `public/console/styles.css`
- Verify: `tests/console-group-automation-boundary.test.js`

**Interfaces:**
- Consumes: completed Task 2 behavior.
- Produces: verification evidence only; no new product behavior.

- [ ] **Step 1: Check JavaScript syntax and whitespace**

Run:

```bash
node --check public/console/app.js
git diff --check
```

Expected: both commands exit 0.

- [ ] **Step 2: Run related automation and conversation tests**

Run:

```bash
node --test \
  tests/console-group-automation-boundary.test.js \
  tests/console-group-management-boundary.test.js \
  tests/console-session-type-boundary.test.js
```

Expected: all tests PASS.

- [ ] **Step 3: Perform browser layout checks**

Use the existing console styling with representative current-group data and verify desktop, medium, and narrow viewport widths. Confirm the title ellipsizes, tabs stay aligned, the add button is visible only in `群任务`, switching tabs does not change the outer workbench height, and long task lists scroll internally without horizontal overflow.

- [ ] **Step 4: Run the complete suite**

Run:

```bash
npm test
```

Expected: 0 failures.

- [ ] **Step 5: Confirm repository state**

Run:

```bash
git status --short
git log -3 --oneline
```

Expected: clean worktree containing the design, plan, and implementation commits on `main`.
