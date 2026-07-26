# DClaw Conversation Identity Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Chinese WorkTool customers from collapsing into shared DClaw sessions and rotate remote context immediately after local conversation reset.

**Architecture:** A focused identity module derives ASCII-only DClaw user, runtime-conversation, and purpose-session identifiers from the Bot-scoped local conversation key and conversation epoch. Every DClaw request builder consumes that identity, while reset tasks retain the old epoch so maintenance cannot touch a newly created conversation.

**Tech Stack:** Node.js ESM, `node:crypto`, Express, SQLite `DatabaseSync`, Node test runner.

## Global Constraints

- Do not modify Agent repositories or DClaw.
- Preserve raw customer names and local conversation keys in server data and request metadata.
- Keep generated external IDs ASCII-only and below 128 characters.
- Use one `conversation` purpose session for live, handoff, proactive, flow activation, and tag activation calls.
- Use isolated `legacy-history-analysis` and `conversation-reset` purpose sessions.
- Run all existing tests before completion and push to `origin/main`.

---

### Task 1: Deterministic DClaw Identity

**Files:**
- Create: `src/dclaw-conversation-identity.js`
- Create: `tests/dclaw-conversation-identity.test.js`

**Interfaces:**
- Produces: `buildDclawConversationIdentity({ botId, conversationKey, conversationEpoch, purpose })`
- Returns: `{ externalUserId, externalSessionId, runtimeConversationId }`

- [ ] **Step 1: Write failing identity tests**

Cover stable output, ASCII-only output, different Chinese customers, changed
epochs, and changed purposes.

- [ ] **Step 2: Verify the tests fail**

Run: `node --test tests/dclaw-conversation-identity.test.js`

Expected: FAIL because `src/dclaw-conversation-identity.js` does not exist.

- [ ] **Step 3: Implement the minimal identity helper**

Use SHA-256 with domain-separated inputs:

```js
buildDclawConversationIdentity({
  botId,
  conversationKey,
  conversationEpoch,
  purpose: "conversation"
});
```

The external user is stable per Bot-scoped conversation, the runtime
conversation changes by epoch, and the external session changes by epoch and
purpose.

- [ ] **Step 4: Verify the identity tests pass**

Run: `node --test tests/dclaw-conversation-identity.test.js`

Expected: PASS.

### Task 2: Normal and Background Request Identity

**Files:**
- Modify: `src/dclaw.js`
- Modify: `tests/dclaw-request-sanitization.test.js`
- Modify: `tests/dclaw-tags.test.js`
- Modify: `tests/dclaw-handoff.test.js`

**Interfaces:**
- Consumes: `buildDclawConversationIdentity(...)`
- Produces: request metadata containing `localConversationId`

- [ ] **Step 1: Add failing request-builder tests**

Assert that:

- Chinese customer requests use hashed external IDs.
- the Agent-facing conversation ID is the epoch-specific runtime ID;
- raw conversation keys remain in `metadata.localConversationId`;
- background history uses a different external session but the same local key;
- handoff uses the same conversation-purpose identity as normal replies.

- [ ] **Step 2: Verify focused tests fail**

Run:

```bash
node --test \
  tests/dclaw-request-sanitization.test.js \
  tests/dclaw-tags.test.js \
  tests/dclaw-handoff.test.js
```

Expected: FAIL on raw Chinese identifiers and missing local metadata.

- [ ] **Step 3: Integrate the helper**

Use one internal function in `src/dclaw.js` to apply:

```js
const identity = buildDclawConversationIdentity({
  botId: binding.botId,
  conversationKey: conversation.conversationKey,
  conversationEpoch: conversation.conversationEpoch,
  purpose
});
```

Set `worktoolMessage.conversationId` and `sessionId` to
`runtimeConversationId`; retain the local key under `metadata.localConversationId`.

- [ ] **Step 4: Verify focused tests pass**

Run the Task 2 test command and expect PASS.

### Task 3: Reset Epoch Persistence and Nonblocking Re-entry

**Files:**
- Modify: `src/db.js`
- Modify: `src/conversation-reset-worker.js`
- Modify: `src/server.js`
- Modify: `tests/db-reset.test.js`
- Modify: `tests/conversation-reset-worker.test.js`
- Modify: `tests/server-conversation-reset-sync.test.js`

**Interfaces:**
- Reset task adds: `conversationEpoch`
- `syncConversationResetToAgent` accepts: `conversationEpoch`

- [ ] **Step 1: Add failing reset tests**

Assert that:

- `clearConversationForReset` stores the deleted conversation's epoch;
- a new inbound message does not await an old reset attempt;
- reset completion only clears `reset_pending` for the same epoch;
- reset workspace and memory requests use the old epoch identity.

- [ ] **Step 2: Verify focused reset tests fail**

Run:

```bash
node --test \
  tests/db-reset.test.js \
  tests/conversation-reset-worker.test.js \
  tests/server-conversation-reset-sync.test.js
```

Expected: FAIL on missing epoch and the existing wait boundary.

- [ ] **Step 3: Implement reset isolation**

Add `conversation_epoch` to `conversation_reset_tasks`, capture it in the reset
transaction, pass it through the worker, and remove the inbound wait. Use an
epoch-guarded database update when marking reset handled.

- [ ] **Step 4: Verify focused reset tests pass**

Run the Task 3 test command and expect PASS.

### Task 4: Remaining DClaw Call Sites

**Files:**
- Modify: `src/dclaw.js`
- Modify: `src/server.js`
- Modify: `tests/dclaw-activation.test.js`
- Modify: relevant proactive and server boundary tests

**Interfaces:**
- Activation, tag activation, and proactive builders accept a conversation
  object containing `conversationKey` and `conversationEpoch`.

- [ ] **Step 1: Add failing cross-call identity tests**

Assert that proactive, flow activation, and tag activation requests for one
epoch use the same conversation-purpose external identity as a normal request.

- [ ] **Step 2: Verify focused tests fail**

Run the affected DClaw and server boundary tests and expect identity mismatches.

- [ ] **Step 3: Pass current conversation objects to every builder**

Load or retain the current conversation after proactive upsert and before
activation polishing. Preserve all existing customer-visible request content.

- [ ] **Step 4: Verify focused tests pass**

Run the affected focused tests and expect PASS.

### Task 5: Full Verification and Delivery

**Files:**
- Modify only if a verification failure identifies a regression.

- [ ] **Step 1: Run syntax and whitespace checks**

```bash
node --check src/dclaw-conversation-identity.js
node --check src/dclaw.js
node --check src/db.js
node --check src/server.js
git diff --check
```

- [ ] **Step 2: Run the complete suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 3: Commit implementation**

```bash
git add src tests docs
git commit -m "Isolate DClaw conversation identities"
```

- [ ] **Step 4: Push**

Run: `git push origin main`

- [ ] **Step 5: Apply test environment timeout**

After server deployment, set:

```dotenv
DCLAW_AGENT_TIMEOUT_MS=25000
DCLAW_AGENT_MAX_ATTEMPTS=2
DCLAW_AGENT_FORMAT_RETRY_TIMEOUT_MS=30000
```

Rebuild only the test container, then verify one Chinese customer reply and one
background history tag/asset analysis.
