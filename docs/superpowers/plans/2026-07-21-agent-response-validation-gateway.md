# Agent Response Validation Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal Agent response validation gateway with retry and queryable failure records.

**Architecture:** `src/agent-response-gateway.js` owns parsing, schema checks, sendability checks, and retry prompt construction. `src/db.js` owns the failure table and insert helper. `src/server.js` wires callbacks from `invokeStrictAgentReply` into the DB helper.

**Tech Stack:** Node.js ESM, `node:test`, SQLite `DatabaseSync`, existing DClaw and WorkTool modules.

---

### Task 1: Gateway Validation Module

**Files:**
- Create: `src/agent-response-gateway.js`
- Test: `tests/agent-response-gateway.test.js`

- [ ] Write failing tests for syntax error details, schema errors, code-fence normalization, and retry prompt content.
- [ ] Implement `validateAgentResponseText`, `buildAgentResponseValidationRetryRequest`, and `summarizeValidationErrors`.
- [ ] Run `node --test tests/agent-response-gateway.test.js`.

### Task 2: Failure Persistence

**Files:**
- Modify: `src/db.js`
- Test: `tests/db-agent-response-validation.test.js`

- [ ] Write failing tests for creating and querying `agent_response_validation_failures`.
- [ ] Add the table and `insertAgentResponseValidationFailure`.
- [ ] Run `node --test tests/db-agent-response-validation.test.js`.

### Task 3: Server Integration

**Files:**
- Modify: `src/server.js`
- Modify: `src/dclaw.js`
- Test: `tests/server-reply-contract.test.js`

- [ ] Make DClaw transport preserve raw malformed final text instead of wrapping it as `{ reply: text }`.
- [ ] Replace direct format retry logic with gateway validation callbacks.
- [ ] Record every gateway rejection before retry/final failure.
- [ ] Run focused DClaw/server tests, then full `npm test`.
