# Human Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-private-conversation human handoff so AI stops replying while messages continue to be stored and synchronized to DClaw history.

**Architecture:** Store handoff state on `flow_sessions`, expose a bot-scoped handoff API, branch `processIncomingMessage` before normal agent reply sending, and add a DClaw sync-only event for handoff transcript messages. Update console session cards and the active chat header with compact icon metadata and a handoff toggle.

**Tech Stack:** Node.js ESM, Express 5, `node:sqlite`, browser JavaScript, CSS, `node:test`.

## Global Constraints

- First version applies to private flow sessions only.
- Human handoff must not send WorkTool replies.
- Human handoff must still store incoming and conversation messages.
- Human handoff must still call DClaw as sync-only history with `eventType = "handoff_transcript_message"`.
- Restoring AI resumes normal agent reply logic for new messages.
- Do not change DClaw agent source in this implementation.

---

### Task 1: Persist Handoff State

**Files:**
- Modify: `src/db.js`
- Test: `tests/db-handoff.test.js`

**Interfaces:**
- Produces: `updateFlowSessionHandoff({ botId, conversationKey, handoffStatus, handoffBy, reason })`
- Produces: `getFlowSession(conversationKey)` returning handoff fields.

Steps:
- Write failing DB test for default `handoffStatus=ai` and update to `human`.
- Run `npm test -- tests/db-handoff.test.js` and observe failure.
- Add columns to `flow_sessions`, row mapping fields, getter, and update helper.
- Re-run test and confirm pass.

### Task 2: Sync-only DClaw Event and Server Branch

**Files:**
- Modify: `src/dclaw.js`
- Modify: `src/server.js`
- Test: `tests/dclaw-handoff.test.js`
- Test: `tests/server-handoff-boundary.test.js`

**Interfaces:**
- Produces: `buildDclawHandoffTranscriptRequest({ binding, conversation, message, flow, conversationReset })`.
- Produces: `PUT /api/flow-sessions/:conversationKey/handoff`.

Steps:
- Write failing tests for event type and server route/processing markers.
- Run targeted tests and observe failure.
- Implement sync-only request and server handoff branch.
- Re-run targeted tests and confirm pass.

### Task 3: Console Handoff UI

**Files:**
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Test: `tests/console-handoff-boundary.test.js`

**Interfaces:**
- Consumes: handoff fields from flow session API.
- Produces: session card handoff indicator, active chat handoff button, compact icon metadata.

Steps:
- Write failing console boundary tests for handoff controls and compact icon markers.
- Run targeted test and observe failure.
- Add button, state rendering, API call, and compact icon metadata.
- Re-run targeted tests and confirm pass.

### Task 4: Verify and Push

**Files:**
- Modify: `README.md`

Steps:
- Document human handoff behavior.
- Run `npm test && node --check src/server.js && node --check src/dclaw.js && node --check src/db.js && node --check public/console/app.js`.
- Commit only related files and push to `origin main`.
