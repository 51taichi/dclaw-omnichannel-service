# Group Conversation UI Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate private and group conversation controls while preserving shared automatic tags and displaying a managed group's creation-date tag.

**Architecture:** Keep the existing shared conversation workspace and derive a single active channel type from the two-tab selector. Browser rendering conditionally emits private-only controls, while the server and database enforce the group manual-tag boundary and persist the group creation-date tag on the canonical conversation.

**Tech Stack:** Node.js ES modules, Express, `node:sqlite`, browser-native JavaScript, HTML/CSS, Node test runner.

## Global Constraints

- Private task, asset, manual-tag, and handoff behavior must remain unchanged.
- Group conversations must not expose private task state, assets, or manual tagging.
- Group automatic tags, date tags, alerts, activation delivery, filtering, and evidence navigation remain enabled.
- The conversation type selector contains only **私聊** and **群聊**, defaulting to **私聊**.
- Group creation-date tags use the managed group creation timestamp.

---

### Task 1: Lock the channel-specific console contract

**Files:**
- Modify: `tests/console-handoff-boundary.test.js`
- Modify: `tests/console-tags-boundary.test.js`
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`

**Interfaces:**
- Produces: `setFlowSessionTypeSelection(type)`, `syncFlowSessionTypeUi()`, and channel-aware session card/detail rendering.
- Consumes: existing `flowSessionType(session)`, `renderConversationDateTag(tags)`, and `renderConversationTags(tags)`.

- [ ] **Step 1: Write failing console boundary tests**

Assert two tabs with private active, a group-hidden task filter, private-only
manual/task/asset card controls, automatic group tag rendering, group-hidden
detail assets, and alert type selection.

- [ ] **Step 2: Run the focused tests and verify the expected failures**

Run:

```bash
node --test tests/console-handoff-boundary.test.js tests/console-tags-boundary.test.js
```

- [ ] **Step 3: Implement the minimal channel-aware console behavior**

Change the selector markup and grid to two columns. Add one synchronization
function that hides the task filter for groups, clears stale selections when
the type changes, omits private-only group card controls, and suppresses group
detail assets.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run the command from Step 2 and expect zero failures.

### Task 2: Persist the managed group creation-date tag

**Files:**
- Modify: `tests/db-groups.test.js`
- Modify: `tests/server-group-conversation-boundary.test.js`
- Modify: `src/db.js`
- Modify: `src/server.js`

**Interfaces:**
- Produces: `ensureManagedGroupConversationDateTag({ botId, agentId, conversationKey, groupCreatedAt })`.
- Consumes: managed group identity, the shared date-tag schema, `dateTagIdFor`, and `upsertSystemDateTag`.

- [ ] **Step 1: Write failing database and server boundary tests**

Create a managed group with a known creation timestamp, persist its canonical
group conversation, and assert the resulting date tag is the expected Beijing
date. Assert inbound persistence passes the managed group timestamp.

- [ ] **Step 2: Run the focused tests and verify the expected failures**

Run:

```bash
node --test tests/db-groups.test.js tests/server-group-conversation-boundary.test.js
```

- [ ] **Step 3: Implement group date-tag persistence**

Add the database helper and call it after the group conversation has been
upserted. Backfill existing managed group conversations once during service
startup. Keep the existing private first-seen helper unchanged.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run the command from Step 2 and expect zero failures.

### Task 3: Enforce no manual group tags and verify the release

**Files:**
- Modify: `tests/server-tags-boundary.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `getConversation(conversationKey)` and the existing manual-tag route.
- Produces: HTTP 400 rejection for group conversation keys on the manual-tag route.

- [ ] **Step 1: Write the failing route boundary test**

Assert the manual-tag route rejects group conversations before applying a tag
change.

- [ ] **Step 2: Implement the route guard**

Read the Bot-scoped conversation and reject room types `1` and `3`.

- [ ] **Step 3: Run focused and complete verification**

Run:

```bash
node --test tests/console-handoff-boundary.test.js tests/console-tags-boundary.test.js tests/db-groups.test.js tests/server-group-conversation-boundary.test.js tests/server-tags-boundary.test.js
npm test
node --check public/console/app.js
node --check src/server.js
git diff --check
```

- [ ] **Step 4: Commit and push**

Commit the implementation and push `release/group-management-v1`.
