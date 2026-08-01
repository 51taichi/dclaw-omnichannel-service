# Tag Alert Unloaded Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure clicking a tag alert visibly selects and locates its conversation even when that conversation was not present in the currently loaded paginated session list.

**Architecture:** Add a small browser utility that immutably upserts one detailed session into the current list. After the existing detail request succeeds, `openFlowSession` constructs the authoritative merged session and uses the utility before rendering, so the selected card is always present without changing filters or pagination APIs.

**Tech Stack:** Browser JavaScript, Node.js built-in test runner, static console assets.

## Global Constraints

- Work only on `main`.
- Do not change tag alert persistence, read state, filters, pagination APIs, or evidence-message anchoring.
- Do not insert a synthetic list item when the detail API returns no session entity.
- Preserve existing list order when updating an item; prepend only when the item is absent.

---

### Task 1: Add a tested session-list upsert utility

**Files:**
- Create: `public/console/flow-session-list.js`
- Create: `tests/flow-session-list.test.js`
- Modify: `public/console/index.html`

**Interfaces:**
- Produces: `window.upsertFlowSession(sessions, incomingSession) -> Array<Session>`.
- Behavior: returns a new array; replaces and merges an existing matching `conversationKey` in place; prepends a missing session; returns a shallow copy unchanged when input is invalid or `incomingSession.conversationKey` is empty.

- [ ] **Step 1: Write the failing behavior tests**

```js
test("prepends a detailed session that is absent from the loaded page", () => {
  const loaded = [{ conversationKey: "bot:private:old", receivedName: "旧客户" }];
  const incoming = { conversationKey: "bot:private:new", receivedName: "新客户", tags: [] };
  assert.deepEqual(window.upsertFlowSession(loaded, incoming), [incoming, ...loaded]);
});

test("merges an existing session in place without duplication", () => {
  const loaded = [
    { conversationKey: "bot:private:first", receivedName: "旧名称", marker: 1 },
    { conversationKey: "bot:private:second", marker: 2 }
  ];
  assert.deepEqual(window.upsertFlowSession(loaded, {
    conversationKey: "bot:private:first",
    receivedName: "新名称",
    tags: [{ tagId: "urgent" }]
  }), [
    {
      conversationKey: "bot:private:first",
      receivedName: "新名称",
      marker: 1,
      tags: [{ tagId: "urgent" }]
    },
    loaded[1]
  ]);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/flow-session-list.test.js`

Expected: FAIL because `window.upsertFlowSession` is not defined.

- [ ] **Step 3: Implement the minimal browser utility**

```js
(function attachFlowSessionList(global) {
  function upsertFlowSession(sessions, incomingSession) {
    const current = Array.isArray(sessions) ? sessions : [];
    const conversationKey = String(incomingSession?.conversationKey || "").trim();
    if (!conversationKey) return [...current];
    const index = current.findIndex((session) => session?.conversationKey === conversationKey);
    if (index < 0) return [{ ...incomingSession }, ...current];
    return current.map((session, position) =>
      position === index ? { ...session, ...incomingSession } : session
    );
  }

  global.upsertFlowSession = upsertFlowSession;
})(window);
```

- [ ] **Step 4: Load the utility before `app.js`**

Add `<script src="./flow-session-list.js"></script>` after `tag-alert-client.js` and before `app.js` in `public/console/index.html`.

- [ ] **Step 5: Run the utility test and verify GREEN**

Run: `node --test tests/flow-session-list.test.js`

Expected: both tests PASS.

### Task 2: Upsert detailed alert targets before rendering

**Files:**
- Modify: `public/console/app.js:4632-4665`
- Modify: `tests/console-tag-alerts-boundary.test.js`

**Interfaces:**
- Consumes: `window.upsertFlowSession(sessions, incomingSession)` from Task 1.
- Produces: `openFlowSession` renders a selected list card for detailed sessions absent from the current page.

- [ ] **Step 1: Write the failing integration-boundary test**

Add assertions proving the helper script loads before `app.js`, and proving `openFlowSession` builds `detailedSession`, assigns it to `currentFlowSession`, then calls `window.upsertFlowSession(currentFlowSessions, detailedSession)`.

- [ ] **Step 2: Run the alert test and verify RED**

Run: `node --test tests/console-tag-alerts-boundary.test.js`

Expected: FAIL because `openFlowSession` does not call `window.upsertFlowSession`.

- [ ] **Step 3: Implement the minimal integration**

Replace the existing map-only update with:

```js
const detailedSession = data.session
  ? {
      ...(session || {}),
      ...data.session,
      tags: currentTags
    }
  : null;
currentFlowSession = detailedSession || {
  ...(session || {}),
  tags: currentTags
};
if (detailedSession) {
  currentFlowSessions = window.upsertFlowSession(currentFlowSessions, detailedSession);
}
```

Keep rendering, evidence anchoring, read marking, and Bot-context checks unchanged.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/flow-session-list.test.js tests/console-tag-alerts-boundary.test.js`

Expected: all focused tests PASS.

- [ ] **Step 5: Run the complete test suite**

Run: `npm test`

Expected: all tests PASS with no new warnings or failures.

- [ ] **Step 6: Commit the implementation**

```bash
git add public/console/flow-session-list.js public/console/index.html public/console/app.js tests/flow-session-list.test.js tests/console-tag-alerts-boundary.test.js docs/superpowers/plans/2026-08-01-tag-alert-unloaded-conversation.md
git commit -m "Fix tag alert navigation for unloaded conversations"
```
