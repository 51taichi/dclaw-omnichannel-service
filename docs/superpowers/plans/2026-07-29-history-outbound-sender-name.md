# Historical Outbound Sender Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the Bot name on imported historical outbound messages and correct already imported rows.

**Architecture:** Resolve the Bot display name at the legacy-history service boundary and apply it only
to outbound imported messages. Add an explicit, one-time database migration for existing external
history rows and call it during service startup.

**Tech Stack:** Node.js, `node:sqlite`, Node test runner.

## Global Constraints

- Do not modify message content, direction, timestamps, raw payloads, source keys, or local rows.
- Do not change Agent behavior, tag decisions, assets, or WorkTool callbacks.
- Follow test-driven development and push only after the complete suite passes.

---

### Task 1: Normalize New History Imports

**Files:**
- Modify: `src/legacy-customer-history.js`
- Modify: `src/server.js`
- Test: `tests/legacy-customer-history-service.test.js`

**Interfaces:**
- Consumes: `resolveBotSenderName(botId): string`
- Produces: imported outbound messages whose `senderName` is the resolved Bot display name

- [ ] **Step 1: Write failing service tests**

Add assertions showing inbound customer history keeps the customer title, outbound customer history
uses `张三老师`, and cached API history also uses `张三老师`.

- [ ] **Step 2: Verify the tests fail**

Run: `node --test tests/legacy-customer-history-service.test.js`

- [ ] **Step 3: Implement direction-aware sender normalization**

Inject `resolveBotSenderName`, resolve it once per operation, and use it for outbound imported rows.

- [ ] **Step 4: Verify the focused service tests pass**

Run: `node --test tests/legacy-customer-history-service.test.js`

### Task 2: Correct Existing Imported Rows

**Files:**
- Modify: `src/db.js`
- Modify: `src/server.js`
- Test: `tests/db-legacy-history.test.js`

**Interfaces:**
- Produces: `migrateLegacyHistoryOutboundSenderNames(): number`

- [ ] **Step 1: Write a failing database migration test**

Insert imported inbound, imported outbound, and local outbound rows; assert only imported outbound
rows change to the Bot name and a second migration call changes zero rows.

- [ ] **Step 2: Verify the database test fails**

Run: `node --test tests/db-legacy-history.test.js`

- [ ] **Step 3: Implement and start the migration**

Update only the two external history sources, persist a migration marker, export the migration
function, and invoke it once during server startup with a structured log.

- [ ] **Step 4: Run focused and complete verification**

Run:

```bash
node --test tests/legacy-customer-history-service.test.js tests/db-legacy-history.test.js
npm test
git diff --check
```

- [ ] **Step 5: Commit and push**

Commit only the specification, plan, implementation, and focused tests, then push to `origin/main`.
