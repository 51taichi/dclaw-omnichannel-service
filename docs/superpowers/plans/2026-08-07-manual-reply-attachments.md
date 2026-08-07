# Manual Reply Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a human operator to upload and send up to five attachments from the active conversation composer, with optional text and delivery-status tracking.

**Architecture:** Reuse the existing `/api/uploads`, file-type detection, normalized proactive attachment shape, and Channel media sender. Extend the manual-reply endpoint to accept ordered attachments and persist one conversation message plus one outgoing delivery row per provider message ID. Keep composer attachment state isolated from proactive push state.

**Tech Stack:** Node.js 22, Express, SQLite, browser JavaScript, HTML/CSS, Node test runner.

## Global Constraints

- Do not use a git worktree; implement in the current repository as explicitly requested.
- Manual attachments are available only while the selected session is in human handoff.
- Text is optional when at least one attachment exists.
- Accept at most 5 attachments of type `image`, `video`, `audio`, or `file`.
- Send attachments in selection order and attach text only to the first one.
- Reuse the current Bot-scoped upload endpoint and Channel media delivery path.
- Preserve successful sends and their provider IDs if a later attachment fails.

---

### Task 1: Manual attachment normalization

**Files:**
- Create: `src/manual-reply.js`
- Test: `tests/manual-reply.test.js`

**Interfaces:**
- Produces: `normalizeManualReply({ content, attachments }) -> { content, attachments, conversationContent }`.
- Each normalized attachment is `{ fileUrl, objectName, fileType }`.

- [ ] **Step 1: Write failing normalization tests**

Test literal cases for text-only, attachment-only, text-plus-attachments, six attachments, missing URLs, and an unsupported type.

- [ ] **Step 2: Run test and verify RED**

Run: `node --test tests/manual-reply.test.js`

Expected: FAIL because `src/manual-reply.js` does not exist.

- [ ] **Step 3: Implement normalization**

Normalize strings, require text or one attachment, cap attachments at five, and allow only `image`, `video`, `audio`, and `file`. Build a readable attachment summary for pure-attachment conversation history.

- [ ] **Step 4: Run test and verify GREEN**

Run: `node --test tests/manual-reply.test.js`

Expected: PASS.

---

### Task 2: Server-side ordered media delivery and persistence

**Files:**
- Modify: `src/server.js`
- Modify: `tests/server-manual-message-delivery-status-boundary.test.js`

**Interfaces:**
- Consumes: `normalizeManualReply`, `sendTextMessage`, `sendMediaMessage`, `insertConversationMessage`, and `insertOutgoingMessage`.
- Produces: extended `POST /api/flow-sessions/:conversationKey/manual-reply` response with `rawPayload.attachments` and provider message IDs.

- [ ] **Step 1: Write failing endpoint tests**

Extend the real spawned-server test to submit two attachments with optional content. Assert ordered Channel calls, caption only on the first attachment, one outgoing row per provider ID, and persisted conversation attachment metadata. Add rejection coverage for AI handoff, more than five files, and unsupported types.

- [ ] **Step 2: Run test and verify RED**

Run: `node --test tests/server-manual-message-delivery-status-boundary.test.js`

Expected: FAIL because the endpoint still requires text and ignores attachments.

- [ ] **Step 3: Implement ordered delivery**

Normalize the request before sending. Use the current text path when no attachments exist. Otherwise call `sendMediaMessage` sequentially; pass `content` only for index zero. Persist each successful provider message ID immediately to `outgoing_messages`, then write the aggregate conversation row with attachment metadata.

- [ ] **Step 4: Implement partial-failure response**

On a later failure, keep earlier outgoing rows, write the successfully sent attachments into the conversation record, stop subsequent sends, and return an HTTP 422 payload that identifies the failed attachment index and successful provider IDs without exposing provider secrets.

- [ ] **Step 5: Run endpoint tests and verify GREEN**

Run: `node --test tests/server-manual-message-delivery-status-boundary.test.js tests/manual-reply.test.js`

Expected: PASS.

---

### Task 3: Composer attachment layout and state

**Files:**
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Modify: `tests/console-handoff-boundary.test.js`

**Interfaces:**
- Consumes: `uploadLocalFile`, `detectFileTypeFromName`, `PROACTIVE_MAX_ATTACHMENTS`, and the extended manual-reply endpoint.
- Produces: `state.manualReplyUploadFiles`, upload Icon button, hidden multi-file input, and Icon-only attachment preview list.

- [ ] **Step 1: Write failing UI boundary tests**

Assert the upload Icon is inside the textarea shell at top-right, the hidden input has `multiple`, and the attachment strip is between emoji controls and send. Assert type Icons, filename tooltip/title, single-item removal, five-file limit, and state clearing on Bot/session/handoff changes.

- [ ] **Step 2: Run test and verify RED**

Run: `node --test tests/console-handoff-boundary.test.js`

Expected: FAIL because the composer has no attachment controls or state.

- [ ] **Step 3: Implement HTML and CSS layout**

Add a positioned textarea shell, top-right upload Icon button, hidden multi-file input, and a flexible attachment strip between emoji and send. Render only type Icons by default; expose the full filename via `title`, accessible label, and focus/hover tooltip.

- [ ] **Step 4: Implement client state and upload flow**

Maintain a separate file array, enforce five files, allow removal, disable controls during upload/send, upload sequentially through `uploadLocalFile`, and submit `{ botId, content, attachments }`. Permit empty text when files exist.

- [ ] **Step 5: Implement lifecycle clearing and retry behavior**

Clear selected files when Bot/session changes, AI resumes, or the conversation is deleted. On upload or API failure, retain text and files. On success, clear both and refresh the conversation.

- [ ] **Step 6: Run UI tests and verify GREEN**

Run: `node --test tests/console-handoff-boundary.test.js`

Expected: PASS.

---

### Task 4: Full verification and delivery

**Files:**
- Modify only files already in scope if verification finds a regression.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: deployable main-branch commit.

- [ ] **Step 1: Run focused tests**

Run: `node --test tests/manual-reply.test.js tests/server-manual-message-delivery-status-boundary.test.js tests/console-handoff-boundary.test.js`

Expected: zero failures.

- [ ] **Step 2: Run complete tests**

Run: `npm test`

Expected: zero failures; existing documented skips are acceptable.

- [ ] **Step 3: Run static checks and review the diff**

Run: `git diff --check`

Verify no unrelated files, credentials, or worktree changes are included.

- [ ] **Step 4: Commit and push**

```bash
git add src/manual-reply.js src/server.js public/console/index.html public/console/app.js public/console/styles.css tests/manual-reply.test.js tests/server-manual-message-delivery-status-boundary.test.js tests/console-handoff-boundary.test.js docs/superpowers
git commit -m "feat: send attachments from manual conversations"
git push origin main
```
