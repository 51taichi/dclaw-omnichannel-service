# Private Conversation Without Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make private conversations visible in the console even when the bound Agent has no enabled task state machine, without changing Bot reply behavior.

**Architecture:** Keep `flow_sessions` as the console conversation index. Use a generic `__conversation__` session when no enabled task state machine exists, while preserving the current flow-session creation path when one does.

**Tech Stack:** Node.js, Express, SQLite, Node test runner

## Global Constraints

- Do not modify Agent invocation, DClaw, Gateway, coalescing, reply sending, tags, assets, or task progression.
- Work in the shared tree and stage only files owned by this fix.
- Re-read current diffs before applying and before committing to preserve concurrent changes.

---

### Task 1: Create generic private sessions without a task state machine

**Files:**
- Modify: `src/server.js:1009-1020`
- Create: `tests/server-private-conversation-session-boundary.test.js`

**Interfaces:**
- Consumes: `getOrCreateConversationSession({ botId, conversationKey, currentNodeId? })`
- Preserves: `getOrCreateFlowSession({ botId, conversationKey, machine })`
- Produces: a `flow_sessions` row for every inbound private conversation handled by an enabled Bot

- [ ] **Step 1: Write the failing regression test**

Assert that `persistInboundConversation` routes a private message to `getOrCreateConversationSession` when `flowMachine?.enabled` is false, while retaining `getOrCreateFlowSession` for enabled task machines.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/server-private-conversation-session-boundary.test.js`

Expected: FAIL because the existing private branch has no generic-session fallback.

- [ ] **Step 3: Implement the minimal branch change**

Use the existing generic session function in the `binding?.enabled` block for groups or when `flowMachine?.enabled` is false. Leave the enabled private flow branch and all downstream reply logic unchanged.

- [ ] **Step 4: Run focused and related tests**

Run:

```bash
node --test tests/server-private-conversation-session-boundary.test.js tests/server-group-conversation-boundary.test.js tests/db-group-session.test.js tests/db-pagination.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Run full verification**

Run:

```bash
node --check src/server.js
npm test
git diff --check
```

Expected: all commands exit successfully with no test failures.

- [ ] **Step 6: Reconcile and commit safely**

Re-read `git status`, `git diff -- src/server.js`, and recent commits. Stage only this test, the precise `src/server.js` hunk, and these two documentation files. Do not stage unrelated concurrent changes.
