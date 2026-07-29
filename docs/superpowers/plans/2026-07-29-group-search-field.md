# Group Search Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the group sidebar's icon-only search input with the standard split-label search field.

**Architecture:** Keep the existing `groupSearchInput` and data-loading behavior. Change only its HTML structure and the narrowly scoped `.groups-search-field` CSS so the component reuses the shared `field-label` styling.

**Tech Stack:** Static HTML, CSS, Node.js test runner.

## Global Constraints

- The visible label is exactly **搜索群**.
- The input placeholder is exactly **搜索群名**.
- Existing group-search input behavior and list layout remain unchanged.
- The old absolute icon overlay is removed.

---

### Task 1: Replace the group search component

**Files:**
- Modify: `tests/console-group-management-boundary.test.js`
- Modify: `public/console/index.html`
- Modify: `public/console/styles.css`

**Interfaces:**
- Consumes: the shared `.field-label` component and existing `#groupSearchInput` listener.
- Produces: a two-column `.groups-search-field` with unchanged input identity.

- [ ] **Step 1: Write the failing boundary test**

Add a test that extracts the `groups-sidebar` markup and asserts:

```js
assert.match(sidebar, /class="groups-search-field"[\s\S]*class="field-label"[\s\S]*搜索群/);
assert.match(sidebar, /id="groupSearchInput"[^>]*placeholder="搜索群名"/);
assert.match(css, /\.groups-search-field\s*\{[^}]*grid-template-columns:\s*max-content minmax\(0,\s*1fr\)/s);
assert.doesNotMatch(css, /\.groups-search-field > \.icon/);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
node --test tests/console-group-management-boundary.test.js
```

Expected: the new group search component test fails because the current input has no `field-label`, uses the old placeholder, and retains the absolute icon overlay.

- [ ] **Step 3: Implement the minimal markup and CSS**

Replace the group search field with:

```html
<label class="groups-search-field">
  <span class="field-label"><svg class="icon" aria-hidden="true"><use href="#icon-search"></use></svg>搜索群</span>
  <input id="groupSearchInput" type="search" placeholder="搜索群名" />
</label>
```

Set `.groups-search-field` to:

```css
.groups-search-field {
  grid-template-columns: max-content minmax(0, 1fr);
}
```

Delete the old `.groups-search-field > .icon` and input-left-padding rules.

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
node --test tests/console-group-management-boundary.test.js
npm test
git diff --check
```

Expected: all commands pass.

- [ ] **Step 5: Commit and push**

```bash
git add docs/superpowers/plans/2026-07-29-group-search-field.md \
  tests/console-group-management-boundary.test.js \
  public/console/index.html \
  public/console/styles.css
git commit -m "Align group search field"
git push origin release/group-management-v1
```
