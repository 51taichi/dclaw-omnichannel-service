# Group Pinning And Active Task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add browser-local common-group pinning and a branded active visual state for enabled group automation cards.

**Architecture:** Put storage-key construction, pin toggling, stale-ID filtering, and stable sorting in a small browser helper loaded before `app.js`. Keep rendering and DOM event binding in `app.js`; represent enabled automation state with a CSS class so the existing API and toggle behavior remain unchanged.

**Tech Stack:** Vanilla JavaScript, browser `localStorage`, HTML/CSS, Node.js built-in test runner.

## Global Constraints

- Pin state is local to the browser and isolated by workspace slug plus Bot ID.
- Pinning never changes server group data or task APIs.
- Enabled-task animation never changes card dimensions or control positions.
- Respect `prefers-reduced-motion`.
- Delete controls remain system red.

---

### Task 1: Browser-Local Group Pin State

**Files:**
- Create: `public/console/group-pins.js`
- Modify: `public/console/index.html`
- Create: `tests/group-pins.test.js`
- Test: `tests/console-group-management-boundary.test.js`

**Interfaces:**
- Consumes: `workspaceSlug: string`, `botId: string`, `groupId: string`, and a Storage-compatible object.
- Produces: `window.GroupPins.readPinnedGroupIds`, `window.GroupPins.togglePinnedGroupId`, and `window.GroupPins.sortGroupsByPinned`.

- [ ] **Step 1: Write failing unit tests**

Cover workspace/Bot key isolation, toggle persistence, malformed stored JSON, stale group IDs, and stable ordering within pinned and unpinned partitions.

- [ ] **Step 2: Run unit tests and verify RED**

Run: `node --test tests/group-pins.test.js`

Expected: FAIL because `public/console/group-pins.js` does not exist.

- [ ] **Step 3: Implement the helper and script boundary**

Create an IIFE that exposes:

```js
window.GroupPins = {
  readPinnedGroupIds(storage, workspaceSlug, botId),
  togglePinnedGroupId(storage, workspaceSlug, botId, groupId),
  sortGroupsByPinned(groups, pinnedIds)
};
```

Load `group-pins.js` before `app.js` in `index.html`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test tests/group-pins.test.js tests/console-group-management-boundary.test.js`

Expected: PASS.

### Task 2: Group Card Pin Interaction

**Files:**
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Modify: `tests/console-group-management-boundary.test.js`

**Interfaces:**
- Consumes: `window.GroupPins` and `window.WorkspaceContext.slug`.
- Produces: a stable pinned-first group list and icon-only `[data-group-pin]` controls.

- [ ] **Step 1: Write failing rendering boundary tests**

Assert that group rendering sorts through `GroupPins`, provides pin/unpin `title` and `aria-label`, marks pinned cards, and stops pin clicks from loading group detail.

- [ ] **Step 2: Run boundary tests and verify RED**

Run: `node --test tests/console-group-management-boundary.test.js`

Expected: FAIL because the pin control and sorting call are absent.

- [ ] **Step 3: Implement rendering and interaction**

Read pins for the active workspace/Bot, sort `state.groups`, render the pin button at the right edge of each card, and handle its click with `preventDefault()` plus `stopPropagation()`. Toggle local storage and rerender without calling `loadGroupDetail()`.

- [ ] **Step 4: Add stable responsive styles**

Give the pin control a fixed square dimension, preserve name ellipsis and the full date tag, and use the current Bot accent for the pinned state without changing card height.

- [ ] **Step 5: Run boundary tests and verify GREEN**

Run: `node --test tests/group-pins.test.js tests/console-group-management-boundary.test.js`

Expected: PASS.

### Task 3: Enabled Automation Running Effect

**Files:**
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Modify: `tests/console-group-automation-boundary.test.js`

**Interfaces:**
- Consumes: `task.enabled: boolean`.
- Produces: mutually exclusive `is-enabled` and `is-disabled` card classes.

- [ ] **Step 1: Write failing visual boundary tests**

Assert enabled cards render `is-enabled`, disabled cards render `is-disabled`, enabled cards use a branded gradient and sheen pseudo-element, and reduced-motion disables the animation.

- [ ] **Step 2: Run boundary tests and verify RED**

Run: `node --test tests/console-group-automation-boundary.test.js`

Expected: FAIL because enabled cards currently have no explicit state class or animation.

- [ ] **Step 3: Implement the state class and CSS effect**

Add `is-enabled` during rendering. Use a low-contrast cyan/orange surface, accent border, and slow non-blocking sheen; keep all card children above the pseudo-element and preserve the existing disabled style.

- [ ] **Step 4: Run boundary tests and verify GREEN**

Run: `node --test tests/console-group-automation-boundary.test.js`

Expected: PASS.

### Task 4: Visual And Full-Suite Verification

**Files:**
- Modify only files required by defects found during verification.

**Interfaces:**
- Consumes: completed group pin and task-state UI.
- Produces: verified desktop/narrow layouts and a clean commit.

- [ ] **Step 1: Run focused tests**

Run: `node --test tests/group-pins.test.js tests/console-group-management-boundary.test.js tests/console-group-automation-boundary.test.js`

- [ ] **Step 2: Run full tests**

Run: `npm test`

- [ ] **Step 3: Inspect desktop and narrow viewports**

Verify the pin never overlaps the group name/date, pin clicks do not select a different group, pinned order survives rerender, and the enabled-task sheen does not shift layout.

- [ ] **Step 4: Check and commit the scoped diff**

Run: `git diff --check` and confirm no backend files changed. Commit only the helper, console UI, tests, spec, and plan; then push `main`.
