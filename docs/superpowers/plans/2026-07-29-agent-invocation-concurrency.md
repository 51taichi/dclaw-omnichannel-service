# Agent Invocation Concurrency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow unrelated customer conversations to invoke DClaw concurrently without changing ordering inside one conversation.

**Architecture:** Extend the existing priority queue into a bounded keyed scheduler. The scheduler owns concurrency, priority, and per-conversation exclusion; `src/server.js` supplies the conversation key and keeps all existing invocation and retry behavior.

**Tech Stack:** Node.js ESM, built-in promises, `node:test`, `node:assert/strict`

## Global Constraints

- Default maximum concurrency is three.
- `DCLAW_AGENT_CONCURRENCY` may override the default with a positive integer.
- The same conversation key must never overlap.
- Different conversation keys may run concurrently.
- Realtime tasks take priority over queued background tasks.
- Existing DClaw payloads, retries, validation, tags, assets, flow transitions, sending, and fallback behavior must remain unchanged.

---

### Task 1: Bounded Keyed Priority Queue

**Files:**
- Modify: `src/agent-invocation-queue.js`
- Modify: `tests/agent-invocation-queue.test.js`

**Interfaces:**
- Consumes: `createAgentInvocationQueue({ concurrency })`
- Produces: `queue.enqueue(task, { priority, key })`

- [ ] **Step 1: Add failing scheduler tests**

Add tests proving that three unique keys start concurrently, a fourth waits, identical keys remain serial and ordered, realtime work wins the next free slot, and rejected tasks release both capacity and their key.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/agent-invocation-queue.test.js`

Expected: FAIL because the current queue only starts one task and ignores `key` and `concurrency`.

- [ ] **Step 3: Implement the minimal scheduler**

Track `runningCount`, a `runningKeys` set, and realtime/background pending arrays. Repeatedly select the first eligible realtime item, then the first eligible background item, until capacity is full. Release the slot and key in `finally`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/agent-invocation-queue.test.js`

Expected: all queue tests pass.

### Task 2: Server Conversation-Key Integration

**Files:**
- Modify: `src/server.js`
- Modify: `tests/server-conversation-reset-sync.test.js`
- Modify: `tests/server-legacy-history-boundary.test.js`
- Modify: `tests/server-proactive-scheduling-boundary.test.js`
- Create: `tests/server-agent-invocation-concurrency-boundary.test.js`

**Interfaces:**
- Consumes: `createAgentInvocationQueue({ concurrency })` and `enqueue(task, { priority, key })`
- Produces: keyed realtime and background Agent scheduling at every server call site

- [ ] **Step 1: Add failing server boundary tests**

Assert that the queue is created from `DCLAW_AGENT_CONCURRENCY`, defaults to three, and every realtime/background Agent call passes its `conversationKey`.

- [ ] **Step 2: Run the boundary tests and verify RED**

Run:

```bash
node --test \
  tests/server-agent-invocation-concurrency-boundary.test.js \
  tests/server-conversation-reset-sync.test.js \
  tests/server-legacy-history-boundary.test.js \
  tests/server-proactive-scheduling-boundary.test.js
```

Expected: FAIL because the existing call sites provide priority but no key or concurrency setting.

- [ ] **Step 3: Connect configuration and conversation keys**

Normalize `DCLAW_AGENT_CONCURRENCY` to a positive integer with default three. Construct the queue with that limit. Pass the relevant `conversationKey` through realtime replies, validation retries, attachment retries, legacy history analysis, conversation reset synchronization, and proactive synchronization.

- [ ] **Step 4: Run boundary tests and the complete suite**

Run the boundary command above, then `npm test`.

Expected: all tests pass with no regressions.

- [ ] **Step 5: Verify and commit**

Run `git diff --check`, review only relevant changes, commit the queue implementation and tests, then push `main`.

