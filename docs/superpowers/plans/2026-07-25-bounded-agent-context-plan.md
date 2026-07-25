# Bounded Agent Context and Local Date Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove AI tag decisions and unbounded history from DClaw requests, keep date tags local, and make oversized requests fail deterministically with the configured fallback.

**Architecture:** The inbound reply request will contain only the current WorkTool event and bounded active-flow data. Tag rules and history will not be sent to the Agent. Date tags will continue to be created by the service from the first persisted conversation timestamp. All DClaw request builders, including activation polish paths, will omit conversation-history arrays.

**Tech Stack:** Node.js ES modules, SQLite, `node:test`, existing DClaw and WorkTool adapters.

## Global Constraints

- The Agent must not receive `tagRules`, `tagDecision`, `legacyHistory`, `recentMessages`, or `history_context` in the normal reply request.
- The first persisted customer message receives its date tag locally and does not require an Agent response.
- Dynamic prompt fields must have explicit maximum lengths and the total request message must have a hard limit.
- A request-size failure records an error and uses the configured fallback without a format retry.
- Manual tag APIs and tag activation delivery remain available.
- Do not modify unrelated dirty files in the repository.

---

### Task 1: Define the bounded outbound request contract

**Files:**
- Modify: `src/dclaw.js`
- Test: `tests/dclaw-tags.test.js`
- Test: `tests/dclaw-activation.test.js`
- Test: `tests/dclaw-request-sanitization.test.js`

**Interfaces:**
- `buildDclawRequest(options)` continues accepting existing callers, but ignores tag and legacy-history inputs when constructing outbound content.
- `buildDclawActivationRequest(options)` and `buildDclawTagActivationRequest(options)` continue accepting existing callers, but omit history arrays from their serialized request and metadata.
- `compactFlowForAgent(flow)` returns only bounded current-flow data and never returns `recentMessages`.

- [ ] **Step 1: Add failing contract assertions**

  Update request-builder tests so a request created with `tagContext`, `legacyHistoryContext`, and a flow containing many `recentMessages` has none of these serialized fields, has no `tagDecision` response requirement, and remains below the configured request-size limit. Add equivalent assertions for flow and tag activation request builders.

- [ ] **Step 2: Run the focused tests and verify they fail**

  Run:

  ```bash
  node --test tests/dclaw-tags.test.js tests/dclaw-activation.test.js tests/dclaw-request-sanitization.test.js
  ```

  Expected: existing assertions still find `tagRules` or `recentMessages` in the outbound request.

- [ ] **Step 3: Implement bounded request construction**

  In `src/dclaw.js`:

  - Remove tag instructions and the `tagDecision` schema branch from `buildDclawRequest`.
  - Remove `legacyHistory` from the serialized `message` JSON and `metadata`.
  - Replace full flow serialization with a compact object containing only the active node, required session identifiers, and bounded general rule fields. Do not include all machine nodes or any recent messages.
  - Remove `recentMessages` from flow activation and tag activation payloads and metadata.
  - Add one shared request-size limit and bounded-string helper. Preserve the current customer or activation message up to the limit; truncate only nonessential dynamic fields first. If the fixed envelope plus the current message cannot fit, throw an error with a stable `errorType` and measured length.
  - Keep response parsing compatible with old Agent responses, but make the normal request schema no longer ask for `tagDecision`.

- [ ] **Step 4: Run the focused tests and verify they pass**

  Run the same `node --test` command and confirm all request contract tests pass.

- [ ] **Step 5: Commit the bounded request contract**

  ```bash
  git add src/dclaw.js tests/dclaw-tags.test.js tests/dclaw-activation.test.js tests/dclaw-request-sanitization.test.js
  git commit -m "Bound DClaw requests and remove history payloads"
  ```

### Task 2: Remove AI tag decisions from the normal reply path

**Files:**
- Modify: `src/server.js`
- Test: `tests/server-tags-boundary.test.js`
- Test: `tests/server-reply-contract.test.js`

**Interfaces:**
- `processCoalescedIncomingBatch` invokes the Agent for the customer reply without building or passing tag context.
- `applyAgentTagDecision` remains available only for explicitly supported legacy/manual boundaries if required by existing code, but is not called after a normal Agent reply.
- `agentResponseValidationOptions(request)` validates only the reply and active flow decision for normal requests.

- [ ] **Step 1: Add failing server-boundary assertions**

  Assert that the normal coalesced inbound path does not call `buildTagContext`, does not pass `tagContext` to `buildDclawRequest`, does not apply `agentReply.tagDecision`, and does not persist a normal Agent tag decision. Keep assertions that manual tag endpoints still call `applyManualConversationTagChange`.

- [ ] **Step 2: Run the focused server tests and verify they fail**

  ```bash
  node --test tests/server-tags-boundary.test.js tests/server-reply-contract.test.js
  ```

- [ ] **Step 3: Remove normal-path AI tag coupling**

  In `src/server.js`:

  - Delete the normal inbound `tagContext` construction and the `tagContext` argument to `buildDclawRequest`.
  - Remove `tagUpdate` creation and `tag.decision.applied` logging from the normal reply path.
  - Keep local tag listing in stored conversation payloads so the UI still sees existing/manual/date tags.
  - Ensure normal response validation does not allow or require `tagDecision`.
  - Leave manual tag changes and tag-triggered activation scheduling intact.

- [ ] **Step 4: Run the focused server tests and verify they pass**

  Run the focused command again and confirm the manual tag boundary remains covered.

- [ ] **Step 5: Commit the normal-path decoupling**

  ```bash
  git add src/server.js tests/server-tags-boundary.test.js tests/server-reply-contract.test.js
  git commit -m "Remove AI tag decisions from reply processing"
  ```

### Task 3: Verify local date-tag behavior and failure fallback

**Files:**
- Modify: `src/server.js` only if the existing first-seen path does not cover the requirement
- Test: `tests/db-tags.test.js`
- Test: `tests/db-friend-added-reentry.test.js`
- Test: `tests/server-boundary.test.js`

**Interfaces:**
- `ensureConversationDateTag` remains the local date-tag authority.
- `persistInboundConversation` and `handleFriendAddedEvent` continue using server timestamps, never Agent output, for first-seen date tags.

- [ ] **Step 1: Add or strengthen date-tag tests**

  Verify that the first private customer message creates the configured date tag, a later message does not replace it, and no Agent response or `tagDecision` is needed for the tag to exist.

- [ ] **Step 2: Run the date-tag tests and verify the existing behavior or expose the gap**

  ```bash
  node --test tests/db-tags.test.js tests/db-friend-added-reentry.test.js tests/server-boundary.test.js
  ```

- [ ] **Step 3: Make only the minimum local date-tag adjustment if needed**

  Preserve existing effective-date and cutoff-time rules. Do not route date-tag creation through DClaw.

- [ ] **Step 4: Run the date-tag tests again**

  Confirm the first-seen date tag tests pass.

### Task 4: Verify the complete contract and repository safety

**Files:**
- Test: existing full test suite

- [ ] **Step 1: Search outbound request builders for forbidden history and tag fields**

  ```bash
  rg -n "tagRules|tagDecision|legacyHistory|recentMessages|history_context" src/dclaw.js src/server.js
  ```

  Any remaining matches must be limited to parser compatibility, manual-tag logic, database flow-session bookkeeping, or tests that explicitly prove omission; none may serialize forbidden fields into normal Agent request bodies.

- [ ] **Step 2: Run syntax and the complete test suite**

  ```bash
  node --check src/dclaw.js
  node --check src/server.js
  npm test
  git diff --check
  ```

- [ ] **Step 3: Review the diff and preserve unrelated changes**

  ```bash
  git status --short
  git diff --stat HEAD~3..HEAD
  ```

  Confirm only the intended source/tests/docs commits were added and the pre-existing unrelated dirty files remain untouched.

- [ ] **Step 4: Commit any final test-only adjustments**

  ```bash
  git add src tests
  git commit -m "Verify bounded Agent context and local date tags"
  ```
