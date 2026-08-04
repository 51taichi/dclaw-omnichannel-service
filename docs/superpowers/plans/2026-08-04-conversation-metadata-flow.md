# Conversation Metadata Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make private and group conversation metadata fill each available row before wrapping, without reserving a separate card column for the current task.

**Architecture:** Add one `conversation-metadata-flow` wrapper around the existing date tag, business tag chips, and optional current-task badge. Both conversation types use that wrapper in list cards, while the selected-conversation header reuses the same flex-wrap behavior without moving its action buttons.

**Tech Stack:** Vanilla JavaScript, HTML, CSS, Node.js built-in test runner.

## Global Constraints

- Keep existing APIs, conversation state, tag ordering, task state, and handoff behavior unchanged.
- Preserve the existing current-task fixed width and ellipsis behavior.
- Keep manual tag, asset, group task, delete, and handoff controls in their current interaction regions.
- Complete chips wrap as units; their text is not truncated.

---

### Task 1: Unify Conversation Card Metadata Flow

**Files:**
- Modify: `tests/console-handoff-boundary.test.js`
- Modify: `tests/console-tags-boundary.test.js`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`

**Interfaces:**
- Consumes: `renderConversationTags(tags, options)`, `renderConversationDateTag(tags)`, and `compactFlowNodeName(value)`.
- Produces: `.conversation-metadata-flow`, a shared list-card container whose children appear in date, business-tag, current-task order.

- [ ] **Step 1: Write failing card metadata boundary tests**

Replace the assertions that require separate date, tag, and task grid columns with assertions for one wrapper:

```js
assert.match(
  app,
  /class="conversation-metadata-flow"[\s\S]*renderConversationDateTag\(session\.tags \|\| \[\]\)[\s\S]*renderConversationTags\(session\.tags \|\| \[\], \{ includeDate: false \}\)[\s\S]*privateSessionTools/
);
assert.match(css, /\.conversation-metadata-flow\s*\{[\s\S]*display:\s*flex[\s\S]*flex-flow:\s*row wrap[\s\S]*grid-column:\s*2 \/ -1/);
assert.doesNotMatch(css, /\.flow-session-tools\s*\{[^}]*grid-column:/);
assert.doesNotMatch(css, /\.flow-session-card\.is-group \.flow-session-tag-zone/);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test tests/console-handoff-boundary.test.js tests/console-tags-boundary.test.js
```

Expected: FAIL because `conversation-metadata-flow` does not exist and the task still owns grid column 4.

- [ ] **Step 3: Implement the shared card metadata wrapper**

In `renderFlowSessions()`, keep `privateSessionTools` optional and place all metadata inside one wrapper:

```js
<span class="conversation-metadata-flow">
  ${renderConversationDateTag(session.tags || [])}
  <span class="flow-session-tag-zone">
    ${renderConversationTags(session.tags || [], { includeDate: false })}
  </span>
  ${privateSessionTools}
</span>
```

Update the card CSS so the wrapper owns the second row and its children participate in one flow:

```css
.conversation-metadata-flow {
  grid-column: 2 / -1;
  grid-row: 2;
  display: flex;
  flex-flow: row wrap;
  align-items: center;
  align-content: flex-start;
  gap: 5px;
  min-width: 0;
}

.conversation-metadata-flow .flow-session-date-tag,
.conversation-metadata-flow .flow-session-tag-zone,
.conversation-metadata-flow .flow-session-tools {
  display: contents;
}
```

Remove the obsolete private/group grid-column overrides from `.flow-session-date-tag`, `.flow-session-tag-zone`, and `.flow-session-tools`. Keep `.flow-session-current-task` dimensions and ellipsis unchanged.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
node --test tests/console-handoff-boundary.test.js tests/console-tags-boundary.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit the card metadata change**

```bash
git add public/console/app.js public/console/styles.css tests/console-handoff-boundary.test.js tests/console-tags-boundary.test.js
git commit -m "fix: unify conversation card metadata flow"
```

---

### Task 2: Align Selected-Conversation Header Wrapping

**Files:**
- Modify: `tests/console-handoff-boundary.test.js`
- Modify: `public/console/index.html`
- Modify: `public/console/styles.css`

**Interfaces:**
- Consumes: `#chatTagList`, `.chat-title-wrap`, `.chat-head-actions`, and the existing `renderConversationTags(tags)` output.
- Produces: `.chat-tag-list.conversation-metadata-flow`, using the shared horizontal wrapping behavior while header actions remain separate.

- [ ] **Step 1: Write the failing header boundary test**

Add assertions that the selected-conversation tag slot opts into the shared metadata flow and does not restrict chip width:

```js
assert.match(html, /id="chatTagList" class="chat-tag-list conversation-metadata-flow"/);
assert.match(css, /\.chat-tag-list\.conversation-metadata-flow\s*\{[\s\S]*display:\s*flex[\s\S]*flex-flow:\s*row wrap[\s\S]*width:\s*100%/);
assert.match(css, /\.chat-tag-list\.conversation-metadata-flow \.tag-chip\s*\{[\s\S]*flex:\s*0 0 auto/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/console-handoff-boundary.test.js
```

Expected: FAIL because `#chatTagList` does not yet carry the shared metadata-flow class.

- [ ] **Step 3: Apply the shared header metadata class and styles**

Change the slot to:

```html
<span id="chatTagList" class="chat-tag-list conversation-metadata-flow"></span>
```

Scope the existing header flex rules to the shared class, keeping `.chat-head-actions` as a separate grid column:

```css
.chat-tag-list.conversation-metadata-flow {
  display: flex;
  flex-flow: row wrap;
  align-items: center;
  align-content: flex-start;
  gap: 5px;
  width: 100%;
  min-width: 0;
}

.chat-tag-list.conversation-metadata-flow .conversation-tags {
  display: contents;
}

.chat-tag-list.conversation-metadata-flow .tag-chip {
  flex: 0 0 auto;
  max-width: none;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node --test tests/console-handoff-boundary.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit the header metadata change**

```bash
git add public/console/index.html public/console/styles.css tests/console-handoff-boundary.test.js
git commit -m "fix: align conversation header tag wrapping"
```

---

### Task 3: Regression and Browser Verification

**Files:**
- Verify: `public/console/app.js`
- Verify: `public/console/index.html`
- Verify: `public/console/styles.css`
- Verify: `tests/console-handoff-boundary.test.js`
- Verify: `tests/console-tags-boundary.test.js`

**Interfaces:**
- Consumes: the unified card and header metadata flow from Tasks 1 and 2.
- Produces: verified private/group behavior with no backend changes.

- [ ] **Step 1: Run the complete test suite**

Run:

```bash
npm test
```

Expected: all tests PASS with exit code 0.

- [ ] **Step 2: Start the local service**

Run:

```bash
npm start
```

Expected: service reports its local listening URL without startup errors.

- [ ] **Step 3: Verify private and group layouts in the browser**

Open the local console and verify:

- A private conversation with date, two business tags, and a current task uses one row when space permits.
- A group conversation with the same number of tags follows the same spacing and wrapping rule.
- Adding group task information does not alter tag chip styling or create one-tag-per-line layout.
- Narrowing the viewport moves complete chips to the next line without clipping labels.
- Manual tagging, handoff switching, assets, group task details, and delete actions remain clickable.

- [ ] **Step 4: Check the final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only intended frontend/test changes remain.

- [ ] **Step 5: Push the verified commits**

```bash
git push origin main
```
