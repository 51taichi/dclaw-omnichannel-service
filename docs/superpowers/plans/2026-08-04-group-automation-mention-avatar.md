# Group Automation Mention Avatar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the linear people icons from the group automation mention section and render the conversation mascot avatar for every selectable group role.

**Architecture:** Keep the existing role checkbox, role ID, selected state, and task payload unchanged. Replace only the rendered icon markup with the existing `./assets/ddeer.png` image and add a scoped avatar class so the role copy remains aligned and truncates safely.

**Tech Stack:** Static HTML, JavaScript template rendering, CSS, Node.js built-in test runner.

## Global Constraints

- The “推送时 @ 群角色（可多选）” legend displays text only.
- Every mention role card uses `./assets/ddeer.png` and no linear person SVG.
- Checkbox, role name, identity text, selected state, role IDs, saved task data, and server behavior remain unchanged.
- Changes remain scoped to the group automation mention section.

---

### Task 1: Replace Mention Icons with Mascot Avatars

**Files:**
- Modify: `public/console/index.html:1080`
- Modify: `public/console/app.js:6100-6106`
- Modify: `public/console/styles.css:6816-6855`
- Modify: `tests/console-group-automation-boundary.test.js`

**Interfaces:**
- Consumes: `state.selectedGroupDetail.roles`, existing `mentionRoleId` checkbox values, and `./assets/ddeer.png`.
- Produces: role card markup containing `<img class="group-automation-mention-avatar" src="./assets/ddeer.png">` with the existing role name and identity text.

- [ ] **Step 1: Write the failing rendering boundary test**

Add a focused test to `tests/console-group-automation-boundary.test.js`:

```js
test("group automation mention roles use conversation mascot avatars without people icons", () => {
  const dialog = html.slice(
    html.indexOf('id="groupAutomationDialog"'),
    html.indexOf('id="groupAutomationHistoryDialog"')
  );
  const mentionFieldset = dialog.slice(
    dialog.indexOf('class="group-automation-mentions"'),
    dialog.indexOf('class="toggle switch-toggle group-automation-enabled"')
  );

  assert.match(mentionFieldset, /<legend>推送时 @ 群角色（可多选）<\/legend>/);
  assert.doesNotMatch(mentionFieldset, /icon-users/);
  assert.match(app, /class="group-automation-mention-avatar" src="\.\/assets\/ddeer\.png"/);
  assert.doesNotMatch(app, /group-automation-mention-card[^\n]*\$\{icon\("user"\)\}/);
  assert.match(
    css,
    /\.group-automation-mention-avatar\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;[^}]*object-fit:\s*cover;/s
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/console-group-automation-boundary.test.js
```

Expected: FAIL because the legend and role cards still contain SVG people icons and the mascot avatar class does not exist.

- [ ] **Step 3: Implement the minimal markup and CSS change**

Change the mention fieldset legend in `public/console/index.html` to:

```html
<legend>推送时 @ 群角色（可多选）</legend>
```

Change the role-card content in `renderGroupAutomationMentionRoles` to:

```js
<span><img class="group-automation-mention-avatar" src="./assets/ddeer.png" alt="" aria-hidden="true" /><strong>${escapeHtml(role.currentName)}</strong><small>${escapeHtml(role.identityType || "未设置身份")}</small></span>
```

Update `public/console/styles.css`:

```css
.group-automation-mention-card > span {
  align-items: center;
  display: grid;
  column-gap: 8px;
  grid-template-columns: 32px minmax(0, 1fr);
  min-width: 0;
}

.group-automation-mention-avatar {
  border-radius: 8px;
  grid-row: 1 / 3;
  width: 32px;
  height: 32px;
  object-fit: cover;
}
```

Keep the existing `small { grid-column: 2; }` rule so the identity remains under the role name.

- [ ] **Step 4: Verify focused tests and browser layout**

Run:

```bash
node --test tests/console-group-automation-boundary.test.js tests/group-automation-schedule-picker.test.js tests/group-automation-schedule.test.js
```

Then render the mention-role cards in a local browser and verify:

- the legend contains no icon;
- every role card shows the same 32 × 32 mascot avatar;
- checkboxes remain visible and clickable;
- long role names and identities still truncate without changing avatar size;
- the three-column and narrow responsive layouts do not overflow.

- [ ] **Step 5: Run full verification and commit**

Run:

```bash
npm test
git diff --check
```

Expected: the complete suite passes and `git diff --check` reports no whitespace errors.

Commit:

```bash
git add public/console/index.html public/console/app.js public/console/styles.css tests/console-group-automation-boundary.test.js
git commit -m "fix: use mascot avatars for mention roles"
```
