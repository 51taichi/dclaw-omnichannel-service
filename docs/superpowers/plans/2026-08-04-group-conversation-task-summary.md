# Group Conversation Task Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a read-only summary of the selected group conversation's scheduled tasks in the conversation header, using the same width and visual language as the private-chat asset control.

**Architecture:** The flow-session detail response exposes only the stable managed-group identity resolved by `botId + conversationKey`. The console keeps the private asset component and the group task component independent, fetches tasks through the existing group-automation API, and uses a second instance of the existing SSE client so conversation updates do not interfere with the group-management tab.

**Tech Stack:** Node.js ESM, Express, SQLite repository helpers, browser JavaScript, HTML/CSS, Server-Sent Events, built-in `node:test`.

## Global Constraints

- Private conversations continue to show only the existing asset control and panel.
- Group conversations show only `任务 N`; `N` includes enabled and disabled tasks and excludes deleted tasks.
- The conversation task panel is read-only; all editing remains in the group-management tab.
- Group tasks remain separate from the private flow state machine, private assets, and activation tasks.
- Group identity is resolved by `botId + conversationKey`, never by group name.
- Browser responses must not expose group background, role descriptions, ledger facts, prompts, or Agent context.
- Loading, empty, unmanaged-group, failed, and stale-request states must remain distinguishable.
- The task button matches the private asset button's fixed width and does not reflow when labels, counts, or names grow.

---

### Task 1: Expose safe managed-group identity on flow-session details

**Files:**
- Modify: `src/server.js:7351-7400`
- Create: `tests/server-group-conversation-task-summary-boundary.test.js`
- Test: `tests/server-group-automation-boundary.test.js`

**Interfaces:**
- Consumes: `getGroupByConversationKey({ botId, conversationKey })` from `src/db.js`.
- Produces: `managedGroup: null | { id: string, currentName: string }` in `GET /api/flow-sessions/:conversationKey`.

- [ ] **Step 1: Write failing server boundary tests**

Add assertions that the flow-session detail route resolves the group with both Bot and conversation identity and returns only the safe projection:

```js
test("flow session detail exposes only stable managed group identity", () => {
  const marker = '"/api/flow-sessions/:conversationKey"';
  const route = source.slice(source.indexOf(marker), source.indexOf(marker) + 2600);
  assert.match(route, /getGroupByConversationKey\(\{\s*botId,\s*conversationKey\s*\}\)/s);
  assert.match(route, /managedGroup:\s*managedGroup\s*\?\s*\{\s*id:\s*managedGroup\.id,\s*currentName:\s*managedGroup\.currentName\s*\}\s*:\s*null/s);
  assert.doesNotMatch(route, /managedGroup:\s*managedGroup\s*[,}]/);
});
```

- [ ] **Step 2: Run the tests and verify the new assertion fails**

Run: `node --test tests/server-group-conversation-task-summary-boundary.test.js tests/server-group-automation-boundary.test.js`

Expected: FAIL because the flow-session response has no `managedGroup` projection.

- [ ] **Step 3: Add the minimal safe projection**

Resolve the group after the authorized flow session lookup and include only stable identity fields:

```js
const managedGroup = getGroupByConversationKey({ botId, conversationKey });

res.json({
  ok: true,
  session: session ? publicSession : null,
  managedGroup: managedGroup
    ? { id: managedGroup.id, currentName: managedGroup.currentName }
    : null
});
```

Insert this field into the existing response object without removing or renaming its current tags, messages, evidence, events, and assets fields.

- [ ] **Step 4: Run focused server tests**

Run: `node --test tests/server-group-conversation-task-summary-boundary.test.js tests/server-group-automation-boundary.test.js tests/server-auth-boundary.test.js`

Expected: PASS, with existing authorization and private-context exclusion tests unchanged.

- [ ] **Step 5: Commit the server contract**

```bash
git add src/server.js tests/server-group-conversation-task-summary-boundary.test.js tests/server-group-automation-boundary.test.js
git commit -m "feat: expose group identity to conversation summary"
```

### Task 2: Add the independent group-task button and panel lifecycle

**Files:**
- Modify: `public/console/index.html:645-665`
- Modify: `public/console/app.js:130-150, 1100-1170, 4380-4700, 4870-4960, 5100-5220, 6380-6420`
- Test: `tests/console-session-type-boundary.test.js`

**Interfaces:**
- Consumes: `data.managedGroup`, `GET /api/groups/:groupId/automations`, `window.createGroupAutomationClient`, `groupAutomationStatus(task)`, `formatGroupAutomationCountdown`, and existing authenticated `headers()`.
- Produces: `renderConversationGroupTasks(viewModel)`, `loadConversationGroupTasks({ botId, groupId, conversationKey })`, and `disconnectConversationGroupTasks()`.

- [ ] **Step 1: Write failing console boundary tests**

Assert separate DOM controls and mutually exclusive rendering:

```js
test("group conversations use an independent read-only task summary", () => {
  assert.match(html, /id="groupTasksButton"[^>]*hidden/);
  assert.match(html, /id="groupTasksCount">--<\/span>/);
  assert.match(html, /id="groupTasksPanel"[^>]*hidden/);
  assert.match(app, /function renderConversationGroupTasks\(/);
  assert.match(app, /flowSessionType\(session\) === "group"/);
  assert.match(app, /els\.assetsButton\.hidden = true/);
  assert.match(app, /els\.groupTasksButton\.hidden = false/);
  assert.match(app, /GET \/api\/groups\/|\/api\/groups\/\$\{encodeURIComponent\(groupId\)\}\/automations/);
});

test("conversation task summary owns a separate automation stream", () => {
  assert.match(app, /const conversationGroupAutomationClient = window\.createGroupAutomationClient/);
  assert.match(app, /function disconnectConversationGroupTasks\(\)/);
  assert.doesNotMatch(app, /state\.groupAutomations\s*=.*conversationGroup/s);
});
```

- [ ] **Step 2: Run the console boundary test and verify it fails**

Run: `node --test tests/console-session-type-boundary.test.js`

Expected: FAIL because the group task DOM and lifecycle functions do not exist.

- [ ] **Step 3: Add task-summary DOM beside the asset control**

Add an independent button and panel:

```html
<button id="groupTasksButton" class="secondary asset-button group-tasks-button" type="button" hidden aria-expanded="false">
  <svg class="icon" aria-hidden="true"><use href="#icon-clock"></use></svg>
  任务 <span id="groupTasksCount">--</span>
</button>
<div id="groupTasksPanel" class="assets-panel group-tasks-panel" hidden></div>
```

Keep `assetsButton` and `assetsPanel` unchanged.

- [ ] **Step 4: Add isolated state and rendering**

Use a dedicated state object rather than `state.groupAutomations`:

```js
let currentConversationGroupTasks = {
  botId: "",
  groupId: "",
  conversationKey: "",
  phase: "idle",
  tasks: [],
  error: ""
};
```

`renderConversationGroupTasks()` must render these phases exactly:

```js
const labels = {
  loading: "--",
  ready: String(tasks.length),
  unmanaged: "0",
  error: "--"
};
```

For ready tasks:

```js
const stateLabel = !task.enabled
  ? "已停用"
  : task.taskType === "periodic_summary"
    ? "周期汇总"
    : groupAutomationStatus(task)?.label || "尚未达成";
```

Disabled tasks show no countdown. Enabled tasks use the existing local countdown formatter and `data-next-run-at`.

- [ ] **Step 5: Add stale-request fencing and independent SSE updates**

`loadConversationGroupTasks()` captures all three identities before requesting:

```js
const requestIdentity = { botId, groupId, conversationKey };
const data = await request(`/api/groups/${encodeURIComponent(groupId)}/automations?botId=${encodeURIComponent(botId)}`, { botId });
if (
  state.selectedBotId !== requestIdentity.botId ||
  state.selectedFlowConversationKey !== requestIdentity.conversationKey ||
  currentConversationGroupTasks.groupId !== requestIdentity.groupId
) return;
```

Create `conversationGroupAutomationClient` with snapshot/update handlers that mutate only `currentConversationGroupTasks.tasks`. Connect it only for the selected group conversation; disconnect it on private selection, empty selection, Bot reset, conversation deletion, tab departure, and hidden-document state.

- [ ] **Step 6: Wire group and private rendering into `openFlowSession`**

After the detail response arrives:

```js
if (flowSessionType(currentFlowSession) === "group") {
  renderConversationAssets({ fields: [], totalCount: 0, collectedCount: 0 });
  if (data.managedGroup?.id) {
    await loadConversationGroupTasks({
      botId,
      groupId: data.managedGroup.id,
      conversationKey
    });
  } else {
    renderConversationGroupTasks({ phase: "unmanaged", tasks: [] });
  }
} else {
  disconnectConversationGroupTasks();
  hideConversationGroupTasks();
  renderConversationAssets(data.assets || { fields: [], totalCount: 0, collectedCount: 0 });
}
```

Loading the task summary must not delay message rendering: start the task request after rendering the conversation detail, and handle its failure inside the task component rather than rejecting `openFlowSession`.

- [ ] **Step 7: Add button, retry, outside-close, and Escape interactions**

- Button toggles only `groupTasksPanel` and updates `aria-expanded`.
- Retry invokes `loadConversationGroupTasks()` using the current identity.
- Asset and task panels close each other before opening.
- Escape, external click, session switch, and tab switch close the task panel.
- The error phase shows `任务信息加载失败` and a `重试` button.
- The unmanaged phase shows `该群尚未配置`.
- The ready empty phase shows `暂无群定时任务`.

- [ ] **Step 8: Run focused console tests**

Run: `node --test tests/console-session-type-boundary.test.js tests/console-group-automation-boundary.test.js tests/group-automation-display-status.test.js`

Expected: PASS.

- [ ] **Step 9: Commit the component lifecycle**

```bash
git add public/console/index.html public/console/app.js tests/console-session-type-boundary.test.js
git commit -m "feat: show group tasks in conversations"
```

### Task 3: Add stable card layout and navigation to the selected group

**Files:**
- Modify: `public/console/app.js:500-580, 5680-5760`
- Modify: `public/console/styles.css:4285-4310, 4610-4665, responsive sections`
- Test: `tests/console-session-type-boundary.test.js`
- Test: `tests/console-group-automation-boundary.test.js`

**Interfaces:**
- Consumes: `switchWorkspaceTab("groups")`, `state.selectedGroupId`, `loadGroups()`, existing group task status/countdown icon helpers.
- Produces: `openSelectedConversationGroupManagement()` and responsive `.group-conversation-task-*` styles.

- [ ] **Step 1: Write failing layout and navigation boundary tests**

```js
test("group task summary matches the asset control and bounds long task content", () => {
  assert.match(css, /\.asset-button,\s*\.group-tasks-button\s*\{[^}]*width:\s*112px/s);
  assert.match(css, /\.group-tasks-panel\s*\{[^}]*max-height:[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.group-conversation-task-name\s*\{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s);
  assert.match(app, /function openSelectedConversationGroupManagement\(\)/);
  assert.match(app, /state\.selectedGroupId = currentConversationGroupTasks\.groupId/);
  assert.match(app, /switchWorkspaceTab\("groups"/);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test tests/console-session-type-boundary.test.js tests/console-group-automation-boundary.test.js`

Expected: FAIL because the fixed-width and task-card styles and navigation helper are missing.

- [ ] **Step 3: Add fixed-width button and bounded panel styles**

Use a shared exact width rather than content-dependent minimum width:

```css
.asset-button,
.group-tasks-button {
  width: 112px;
  min-width: 112px;
  min-height: 38px;
  white-space: nowrap;
}

.group-tasks-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
}

.group-conversation-task-list {
  max-height: 320px;
  overflow-y: auto;
}

.group-conversation-task-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

Task rows use fixed grid responsibilities for icon/title, state, and countdown. At narrow panel widths they become one column via a container or media query, without moving the conversation header controls.

- [ ] **Step 4: Implement stable-ID navigation**

```js
async function openSelectedConversationGroupManagement() {
  const groupId = currentConversationGroupTasks.groupId;
  if (!state.selectedBotId || !groupId) return;
  state.selectedGroupId = groupId;
  switchWorkspaceTab("groups");
  await loadGroups();
  if (!state.groups.some((group) => group.id === groupId)) {
    toast("未找到当前群配置");
    return;
  }
  if (state.selectedGroupDetail?.group?.id !== groupId) {
    await loadGroupDetail(groupId);
  }
}
```

The helper uses the existing `loadGroups()` and `loadGroupDetail(groupId)` functions and preserves the stable `groupId` across the list refresh, so duplicate group names cannot affect selection.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/console-session-type-boundary.test.js tests/console-group-automation-boundary.test.js`

Expected: PASS.

- [ ] **Step 6: Commit layout and navigation**

```bash
git add public/console/app.js public/console/styles.css tests/console-session-type-boundary.test.js tests/console-group-automation-boundary.test.js
git commit -m "fix: stabilize conversation group task summary"
```

### Task 4: Verify integration, responsive behavior, and regressions

**Files:**
- Verify: `public/console/app.js`, `public/console/styles.css`, `src/server.js`
- Test: `tests/console-session-type-boundary.test.js`
- Test: `tests/server-group-conversation-task-summary-boundary.test.js`

**Interfaces:**
- Consumes: the safe server projection, independent console component, SSE client, and navigation helper from Tasks 1-3.
- Produces: a verified end-to-end group task summary with no private-chat regression.

- [ ] **Step 1: Run all focused automated tests**

```bash
node --test \
  tests/server-group-conversation-task-summary-boundary.test.js \
  tests/server-group-automation-boundary.test.js \
  tests/console-session-type-boundary.test.js \
  tests/console-group-automation-boundary.test.js \
  tests/group-automation-display-status.test.js \
  tests/group-automation-stream.test.js
```

Expected: PASS.

- [ ] **Step 2: Run syntax and full regression checks**

```bash
node --check src/server.js
node --check public/console/app.js
npm test
```

Expected: all commands exit 0.

- [ ] **Step 3: Verify browser behavior at four widths**

At 1440px, 1280px, 900px, and 700px viewport widths, verify:

1. Private chat shows only the `资产 X/Y` button and its existing panel.
2. Group chat shows only the equal-width `任务 N` button.
3. Zero, multiple, disabled, conditional, and periodic-summary tasks render without overlap.
4. A long task name truncates without moving state or countdown.
5. Many tasks scroll inside the panel and do not resize the message area.
6. Switching rapidly between two groups never displays the first group's data in the second.
7. “前往群管理” selects the correct stable group ID.
8. Failed loading shows `任务 --` and retry; an empty list shows `任务 0`.

- [ ] **Step 4: Run diff hygiene checks**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only intended files changed.

- [ ] **Step 5: Commit any verification fixes**

If browser or regression verification required a correction, commit only the correction and its test:

```bash
git add public/console/app.js public/console/styles.css src/server.js tests
git commit -m "fix: close group task summary edge cases"
```
