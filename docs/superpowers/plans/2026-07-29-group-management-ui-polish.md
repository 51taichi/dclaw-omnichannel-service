# Group Management UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the annotated group-management layout defects and add consistent icons without changing group-management behavior.

**Architecture:** Keep the existing HTML, dynamic JavaScript rendering, and CSS structure. Introduce semantic `groups-*` subcomponents for group cards, tag cards, role headers/rows, and group dialogs so generic confirmation styles cannot distort them.

**Tech Stack:** Browser-native HTML/CSS/JavaScript, inline SVG symbols, Node.js test runner.

## Global Constraints

- Remove the group-management title and explanatory sentence while keeping the actions right aligned.
- Preserve the existing 30/70 workbench.
- Reuse existing SVG symbols and CSS variables.
- Scope layout changes to `groups-*` selectors.
- Do not change backend routes or group business behavior.

---

### Task 1: Lock the polished UI contract with failing boundary tests

**Files:**
- Modify: `tests/console-group-management-boundary.test.js`

**Interfaces:**
- Consumes: `public/console/index.html`, `public/console/app.js`, and `public/console/styles.css` as text fixtures.
- Produces: assertions for the final semantic classes and icon markers.

- [ ] **Step 1: Add failing assertions**

Assert that:

```js
assert.doesNotMatch(panel, /这里只配置群/);
assert.match(app, /groups-list-item-main/);
assert.match(app, /groups-tag-card/);
assert.match(app, /groups-role-columns/);
assert.match(html, /groups-dialog-header/);
assert.match(css, /\.groups-dialog\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
```

- [ ] **Step 2: Run the focused test**

Run:

```bash
node --test tests/console-group-management-boundary.test.js
```

Expected: FAIL because the semantic layout classes and dedicated dialog grid do not exist.

- [ ] **Step 3: Commit only after Tasks 2 and 3 make the contract pass**

The test and implementation form one reviewable UI change and will be committed together.

### Task 2: Rebuild group cards, tags, roles, and icons

**Files:**
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Test: `tests/console-group-management-boundary.test.js`

**Interfaces:**
- Consumes: existing `escapeHtml`, `groupRoleRow`, `renderGroupList`, and `renderGroupConfig`.
- Produces: semantic group-card, tag-card, and role-grid markup using existing data attributes.

- [ ] **Step 1: Remove the redundant group header copy**

Replace the group panel header with:

```html
<div class="groups-toolbar section-actions">
  <button id="refreshGroupsButton" class="secondary" type="button">...</button>
  <button id="createGroupButton" class="primary" type="button">...</button>
</div>
```

Include `icon-refresh` and `icon-plus`.

- [ ] **Step 2: Structure group cards**

Render `groups-list-item-main`, `groups-list-item-copy`, and
`groups-list-item-meta` children with `icon-users`, `icon-edit`, and
`icon-send`.

- [ ] **Step 3: Structure configuration fields and tag cards**

Add field icons and render every tag-group binding as `.groups-tag-card`.
Use `icon-calendar` plus `icon-lock` for the required date binding and
`icon-tag` for normal groups.

- [ ] **Step 4: Add a role column header and aligned role rows**

Render `.groups-role-columns` with seven columns matching `.groups-role-row`.
Add `data-role-label` to each mobile field and icons to headers and actions.

- [ ] **Step 5: Add scoped CSS**

Create stable grids for cards and roles, fixed action widths, selected tag
states, and a mobile role-card layout. Do not modify generic form selectors.

- [ ] **Step 6: Run the focused tests**

Run:

```bash
node --check public/console/app.js
node --test tests/console-group-management-boundary.test.js
```

Expected: PASS.

### Task 3: Repair group dialogs and verify regression safety

**Files:**
- Modify: `public/console/index.html`
- Modify: `public/console/styles.css`
- Test: `tests/console-group-management-boundary.test.js`

**Interfaces:**
- Consumes: existing create/modify form IDs and event handlers.
- Produces: full-width one-column group dialogs with scrollable bodies.

- [ ] **Step 1: Add semantic dialog structure and icons**

Wrap each dialog title in `.groups-dialog-header`, fields in
`.groups-dialog-body`, and actions in `.groups-dialog-actions`. Add icons for
users, edit, announcement, search, remark, chevron, plus, and save.

- [ ] **Step 2: Override the generic confirmation grid**

Use:

```css
.confirm-dialog.groups-dialog {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  width: min(720px, calc(100vw - 32px));
  max-height: min(820px, calc(100vh - 32px));
}
```

Make `.groups-dialog-body` scroll independently and force both copy and actions
to `grid-column: 1`.

- [ ] **Step 3: Run focused and full verification**

Run:

```bash
node --check public/console/app.js
node --test tests/console-group-management-boundary.test.js tests/console-auth-boundary.test.js
npm test
git diff --check
```

Expected: all commands succeed.

- [ ] **Step 4: Commit and push**

```bash
git add public/console/index.html public/console/app.js public/console/styles.css \
  tests/console-group-management-boundary.test.js \
  docs/superpowers/plans/2026-07-29-group-management-ui-polish.md
git commit -m "Polish group management UI"
git push origin release/group-management-v1
```
