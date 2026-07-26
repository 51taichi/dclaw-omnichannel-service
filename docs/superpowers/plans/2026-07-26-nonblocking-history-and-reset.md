# Nonblocking History Intelligence And Conversation Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove DClaw latency from legacy first replies and console conversation deletion while preserving historical intelligence and reset correctness.

**Architecture:** The live message path sends a normal reply and schedules isolated background history analysis. Conversation deletion creates a durable reset task in the local transaction; a worker performs ordered DClaw cleanup while new activity cancels obsolete retries and carries a reset marker.

**Tech Stack:** Node.js ESM, Express, `node:sqlite`, Node test runner, vanilla browser JavaScript.

## Global Constraints

- Do not change Agent workspace files.
- Historical asset names come only from dynamic task-node configuration.
- Background historical analysis never sends a customer message or advances a task node.
- Local conversation deletion is the HTTP success boundary.
- Old reset work must never clear a newly-created customer conversation.

---

### Task 1: Split Live Reply From Historical Analysis

**Files:**
- Modify: `src/dclaw.js`
- Modify: `src/server.js`
- Test: `tests/dclaw-tags.test.js`
- Test: `tests/server-legacy-history-boundary.test.js`

**Interfaces:**
- Produces: `buildDclawLegacyHistoryAnalysisRequest(...)`
- Produces: `scheduleLegacyHistoryAnalysis(...)`

- [ ] Add failing request-builder tests proving the background request uses an isolated session, includes bounded history and dynamic fields, and requires an empty reply.
- [ ] Run the focused tests and confirm failure because the builder does not exist.
- [ ] Implement the dedicated DClaw request builder.
- [ ] Add failing server boundary tests proving the live request omits history and background scheduling occurs only after a successful send.
- [ ] Run the focused tests and confirm the old one-call path fails them.
- [ ] Implement a keyed single-flight background analysis path that records an invocation, validates JSON, applies tags and fill-only-missing assets, publishes alerts, marks completion, and never sends or advances a node.
- [ ] Run all history, DClaw, tag, flow-asset, and server boundary tests.

### Task 2: Persist Background Conversation Reset Work

**Files:**
- Modify: `src/db.js`
- Create: `src/conversation-reset-worker.js`
- Modify: `src/server.js`
- Test: `tests/db-reset.test.js`
- Create: `tests/conversation-reset-worker.test.js`
- Modify: `tests/server-conversation-reset-sync.test.js`

**Interfaces:**
- Produces: `scheduleConversationResetTask({ botId, agentId, conversationKey })`
- Produces: `claimConversationResetTask(...)`
- Produces: `completeConversationResetTask(...)`
- Produces: `failConversationResetTask(...)`
- Produces: `cancelConversationResetTasksForNewActivity(...)`
- Produces: `createConversationResetWorker(...)`

- [ ] Add failing database tests proving local reset atomically creates a pending cleanup task.
- [ ] Run the database test and confirm the task API is absent.
- [ ] Add the task table, row mapping, claim, success, retry, cancel, and stale-processing recovery functions.
- [ ] Add worker tests proving workspace cleanup precedes memory cleanup and failures retry without throwing into HTTP handlers.
- [ ] Run worker tests and confirm failure before implementation.
- [ ] Implement the worker around the existing reset request pair and timeout policy.
- [ ] Add server boundary tests proving the reset route does not await DClaw and starts the worker.
- [ ] Replace synchronous route cleanup with task scheduling and worker wake-up.
- [ ] Run reset, DB isolation, and server reset tests.

### Task 3: Protect New Activity From Obsolete Reset Retries

**Files:**
- Modify: `src/db.js`
- Modify: `src/server.js`
- Test: `tests/db-reset.test.js`
- Modify: `tests/server-conversation-reset-sync.test.js`

**Interfaces:**
- Consumes: reset task APIs from Task 2.
- Produces: new conversations with `reset_pending=1` when unfinished old cleanup exists.

- [ ] Add failing tests proving a first inbound conversation inherits reset pending and cancels retryable old cleanup.
- [ ] Run focused tests and confirm existing upsert behavior fails.
- [ ] Implement transactional new-activity cancellation and reset marker propagation.
- [ ] Ensure an in-flight attempt settles before the new Agent request is built, then prevent any later retry.
- [ ] Run reset and inbound-processing tests.

### Task 4: Isolate Delete Success From Refresh Failure

**Files:**
- Modify: `public/console/app.js`
- Test: `tests/console-handoff-boundary.test.js`

**Interfaces:**
- Consumes: immediate reset API response.

- [ ] Add a failing console boundary test proving delete success state is committed before list refresh and refresh errors are handled separately.
- [ ] Run the focused test and confirm the old combined `try` fails.
- [ ] Split the delete request from refresh handling while preserving the loading dialog and signed-out behavior.
- [ ] Run console tests.

### Task 5: Verification And Delivery

**Files:**
- Verify all modified files.

- [ ] Run focused tests for history, DClaw, tags, reset worker, DB reset, server boundaries, and console.
- [ ] Run `npm test`.
- [ ] Run `node --check` for every modified JavaScript source.
- [ ] Run `git diff --check`.
- [ ] Review the diff against every design requirement.
- [ ] Commit implementation and push `main` to `origin`.
