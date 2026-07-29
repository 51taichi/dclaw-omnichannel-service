# Group Management Responsive UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make group management compact, visually distinct, responsive, and internally scrollable while reusing the task rule and push target interaction patterns.

**Architecture:** Keep all backend APIs and form payloads unchanged. Update the existing console HTML, rendering functions, and scoped CSS; reuse `expand-on-focus`, target-card semantics, avatar helpers, and the supplied `group.png` asset instead of creating a new component framework.

**Tech Stack:** Static HTML, vanilla JavaScript, CSS, Node.js built-in test runner.

## Global Constraints

- Do not change group reply, tag, role recognition, or WorkTool API behavior.
- Do not add polling or live member-state tracking.
- Use `public/console/assets/group.png` for group-specific visual identity.
- Keep desktop group roles in six columns and use vertical cards on narrow screens.
- Run test-first red/green cycles before production changes.

---

### Task 1: Group identity and compact background

**Files:**
- Modify: `tests/console-group-management-boundary.test.js`
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`

**Interfaces:**
- Consumes: existing `expand-on-focus` textarea behavior and `group.background`.
- Produces: `.group-asset-icon` image usage and `.groups-background-field` compact background editor.

- [ ] **Step 1: Write the failing boundary test**

Add assertions that group management references `assets/group.png`, the group background textarea has `expand-on-focus`, and the removed role explanation is absent:

```js
assert.match(html, /data-workspace-tab="groups"[\s\S]*?assets\/group\.png/);
assert.match(app, /groups-background-field[\s\S]*?expand-on-focus/);
assert.doesNotMatch(app, /角色由你维护，用于识别发言人与回复策略/);
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test tests/console-group-management-boundary.test.js
```

Expected: FAIL because the tab still uses `#icon-users`, the background is always expanded, and the role explanation still exists.

- [ ] **Step 3: Implement group asset and compact background**

Use an image inside the group tab:

```html
<img class="workspace-tab-image" src="./assets/group.png" alt="" aria-hidden="true" />
```

Render the background editor as:

```html
<label class="groups-background-field">
  <span class="field-label">群背景</span>
  <textarea class="expand-on-focus" name="background" rows="1"></textarea>
</label>
```

Remove the role explanation paragraph. Replace group-purpose SVGs in group list/dialog/config title with:

```html
<img class="group-asset-icon" src="./assets/group.png" alt="" aria-hidden="true" />
```

- [ ] **Step 4: Run focused tests and syntax check**

Run:

```bash
node --test tests/console-group-management-boundary.test.js
node --check public/console/app.js
```

Expected: PASS and exit code 0.

### Task 2: Responsive workbench and role layout

**Files:**
- Modify: `tests/console-group-management-boundary.test.js`
- Modify: `public/console/styles.css`
- Modify: `public/console/app.js`

**Interfaces:**
- Consumes: `.groups-workbench`, `.groups-sidebar`, `.groups-config`, `.groups-role-row`.
- Produces: bounded desktop workbench with independent scroll regions and non-overflowing role rows.

- [ ] **Step 1: Write the failing layout assertions**

Add assertions for viewport-bounded workbench and overflow rules:

```js
assert.match(css, /#groupsTab\s*\{[^}]*height:\s*100%/s);
assert.match(css, /\.groups-panel\s*\{[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)/s);
assert.match(css, /\.groups-sidebar[\s\S]*?overflow-y:\s*auto/s);
assert.match(css, /\.groups-config[\s\S]*?overflow-y:\s*auto/s);
assert.match(css, /\.groups-role-row\s*\{[^}]*width:\s*100%/s);
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test tests/console-group-management-boundary.test.js
```

Expected: FAIL because the group workbench currently uses only `min-height`.

- [ ] **Step 3: Implement bounded scrolling and safe role columns**

Reuse the workspace's viewport-aware height like the task Tab:

```css
#groupsTab {
  height: 100%;
  min-height: 0;
}

.groups-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  overflow: hidden;
}

.groups-workbench {
  min-height: 0;
  overflow: hidden;
}

.groups-sidebar,
.groups-config {
  min-height: 0;
  overflow-y: auto;
}
```

Ensure the role form and rows stay inside the right pane:

```css
.groups-roles-form,
.groups-role-list,
.groups-role-row {
  max-width: 100%;
  min-width: 0;
  width: 100%;
}
```

Adjust the six-column grid so the fixed action column fits and flexible columns can shrink. In the existing `@media (max-width: 900px)` block, restore natural height and vertical cards:

```css
.groups-workbench { height: auto; }
.groups-sidebar, .groups-config { overflow: visible; }
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test tests/console-group-management-boundary.test.js tests/console-auth-boundary.test.js
```

Expected: all focused tests PASS.

### Task 3: Push-style contact selector and final verification

**Files:**
- Modify: `tests/console-group-management-boundary.test.js`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`

**Interfaces:**
- Consumes: `state.createGroupContacts`, `state.createGroupContactIds`, `targetTypeAvatar("private")`, and push Tab target-card visual semantics.
- Produces: `.groups-contact-grid` containing `.groups-contact-card` buttons with avatar, name, and selected checkbox.

- [ ] **Step 1: Write the failing contact selector test**

Add assertions that the create-group renderer uses a card button, private avatar helper, and selected state:

```js
assert.match(app, /groups-contact-card \$\{selected \? "selected" : ""\}/);
assert.match(app, /targetTypeAvatar\("private"\)/);
assert.match(app, /groups-contact-checkbox/);
assert.match(css, /\.groups-contact-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,/s);
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test tests/console-group-management-boundary.test.js
```

Expected: FAIL because contacts are currently checkbox labels without avatars or card selection.

- [ ] **Step 3: Implement push-style contact cards**

Render each contact as a button:

```js
const selected = state.createGroupContactIds.has(target.targetName);
return `
  <button class="groups-contact-card ${selected ? "selected" : ""}" data-create-group-contact="${escapeHtml(target.targetName)}" type="button">
    <img class="target-avatar private" src="${escapeHtml(targetTypeAvatar("private"))}" alt="" aria-hidden="true" />
    <span class="groups-contact-name">${escapeHtml(target.displayName || target.targetName)}</span>
    <span class="groups-contact-checkbox ${selected ? "checked" : ""}" aria-hidden="true">
      <svg class="icon"><use href="#icon-check"></use></svg>
    </span>
  </button>`;
```

Attach click handlers that toggle `state.createGroupContactIds` and rerender the filtered list. Style `.groups-contact-grid` as a four-column desktop grid with five rows per 20-person page, the same selected border, avatar, and checkbox treatment as `.target-list`/`.target-card`, and a right-aligned shared pagination bar below it.

- [ ] **Step 4: Run all verification**

Run:

```bash
node --test tests/console-group-management-boundary.test.js tests/console-auth-boundary.test.js
node --check public/console/app.js
npm test
git diff --check
```

Expected: focused tests and full suite PASS, syntax check exits 0, and diff check produces no output.

- [ ] **Step 5: Commit and push**

```bash
git add public/console/index.html public/console/app.js public/console/styles.css tests/console-group-management-boundary.test.js
git commit -m "Refine responsive group management UI"
git push origin release/group-management-v1
```
