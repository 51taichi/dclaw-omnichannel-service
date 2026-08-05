# Inbound Agent Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let WorkTool inbound image/file callbacks reach the DClaw Agent as structured readable attachment references without changing existing business flow semantics.

**Architecture:** Add a focused inbound attachment normalizer, use it from message eligibility, conversation-history display content, and DClaw request metadata. Keep all original raw payload persistence and outbound Agent attachment behavior unchanged.

**Tech Stack:** Node.js ES modules, Express, SQLite via existing `src/db.js`, Node test runner.

## Global Constraints

- Preserve `incoming_messages.payload_json` and `conversation_messages.raw_payload_json` as the raw WorkTool callback audit source.
- Do not hard-code resume parsing, Excel generation, or template filling in the middle platform.
- Do not alter WorkTool outbound media sending, Agent response validation, group reply policy, flow state machine, tag handling, handoff, or activation scheduling.
- Treat HTTP/HTTPS `fileUrl` or `filePath` as available; keep non-public paths as unavailable metadata.
- Use test-first changes and keep edits narrow because another session may be modifying the same source tree.

---

### Task 1: Normalize Inbound Attachments

**Files:**
- Create: `src/inbound-attachments.js`
- Test: `tests/inbound-attachments.test.js`

**Interfaces:**
- Produces: `extractInboundAttachments(message): Array<{ type: string, url: string, name: string, textType: number|null, source: string, available: boolean }>`
- Produces: `hasAvailableInboundAttachment(message): boolean`
- Produces: `inboundAttachmentPlaceholder(message): string`

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  extractInboundAttachments,
  hasAvailableInboundAttachment,
  inboundAttachmentPlaceholder
} from "../src/inbound-attachments.js";

test("normalizes public WorkTool file callbacks", () => {
  const message = {
    textType: 6,
    fileUrl: "https://cdn.example.test/resume.pdf",
    fileName: "张三简历.pdf"
  };

  assert.deepEqual(extractInboundAttachments(message), [
    {
      type: "file",
      url: "https://cdn.example.test/resume.pdf",
      name: "张三简历.pdf",
      textType: 6,
      source: "worktool_callback",
      available: true
    }
  ]);
  assert.equal(hasAvailableInboundAttachment(message), true);
  assert.equal(inboundAttachmentPlaceholder(message), "[文件] 张三简历.pdf");
});

test("keeps non-public WorkTool paths unavailable", () => {
  const message = {
    textType: 2,
    filePath: "/tmp/worktool/image.png",
    fileName: "截图.png"
  };

  assert.deepEqual(extractInboundAttachments(message), [
    {
      type: "image",
      url: "",
      name: "截图.png",
      textType: 2,
      source: "worktool_callback",
      available: false
    }
  ]);
  assert.equal(hasAvailableInboundAttachment(message), false);
  assert.equal(inboundAttachmentPlaceholder(message), "[图片] 截图.png");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/inbound-attachments.test.js`

Expected: FAIL because `src/inbound-attachments.js` does not exist.

- [ ] **Step 3: Implement the normalizer**

Create `src/inbound-attachments.js` with URL detection, type mapping, and placeholder formatting.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/inbound-attachments.test.js`

Expected: PASS.

### Task 2: Allow Attachment-Only Messages Into Agent Eligibility

**Files:**
- Modify: `src/message-rules.js`
- Modify: `tests/message-rules.test.js`

**Interfaces:**
- Consumes: `hasAvailableInboundAttachment(message)` from `src/inbound-attachments.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/message-rules.test.js`:

```js
test("allows non-text callbacks with readable inbound attachments", () => {
  assert.equal(
    shouldProcessInboundForAgent({
      textType: 6,
      spoken: "",
      rawSpoken: "",
      fileUrl: "https://cdn.example.test/resume.pdf",
      fileName: "张三简历.pdf"
    }),
    true
  );
});

test("skips non-text callbacks with only unavailable local attachment paths", () => {
  assert.equal(
    shouldProcessInboundForAgent({
      textType: 2,
      spoken: "",
      rawSpoken: "",
      filePath: "/tmp/worktool/image.png",
      fileName: "截图.png"
    }),
    false
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/message-rules.test.js`

Expected: FAIL because attachment-only public callbacks are still skipped.

- [ ] **Step 3: Update eligibility**

Import `hasAvailableInboundAttachment` and return true when no text exists but a readable inbound attachment exists. Keep friend-added callbacks skipped.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/message-rules.test.js tests/inbound-attachments.test.js`

Expected: PASS.

### Task 3: Add Attachment Placeholders To Conversation History

**Files:**
- Modify: `src/server.js`
- Test: `tests/server-inbound-attachments-boundary.test.js`

**Interfaces:**
- Consumes: `inboundAttachmentPlaceholder(message)` from `src/inbound-attachments.js`

- [ ] **Step 1: Write the failing boundary test**

Create `tests/server-inbound-attachments-boundary.test.js` that reads `src/server.js` and asserts `persistInboundConversation` uses `inboundAttachmentPlaceholder(message)` when `message.spoken || message.rawSpoken` is empty.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/server-inbound-attachments-boundary.test.js`

Expected: FAIL because the placeholder helper is not referenced.

- [ ] **Step 3: Update persistence content**

In `persistInboundConversation`, compute inbound content as `message.spoken || message.rawSpoken || inboundAttachmentPlaceholder(message) || ""`. Do not alter `rawPayload: message`.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/server-inbound-attachments-boundary.test.js tests/message-rules.test.js`

Expected: PASS.

### Task 4: Include Inbound Attachments In DClaw Requests

**Files:**
- Modify: `src/dclaw.js`
- Modify: `tests/dclaw-request-sanitization.test.js`

**Interfaces:**
- Consumes: `extractInboundAttachments(message)` from `src/inbound-attachments.js`

- [ ] **Step 1: Write the failing test**

Add a test that calls `buildDclawRequest()` with a private or group callback containing `fileUrl` and asserts:

```js
assert.deepEqual(request.metadata.worktool.metadata.inboundAttachments, [
  {
    type: "file",
    url: "https://cdn.example.test/resume.pdf",
    name: "张三简历.pdf",
    textType: 6,
    source: "worktool_callback",
    available: true
  }
]);
assert.deepEqual(request.metadata.worktool.metadata.payload.inboundAttachments, request.metadata.worktool.metadata.inboundAttachments);
assert.match(request.message, /inboundAttachments/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dclaw-request-sanitization.test.js`

Expected: FAIL because request metadata does not include `inboundAttachments`.

- [ ] **Step 3: Add metadata**

Import `extractInboundAttachments`, add `inboundAttachments` to `compactInboundPayload(message)` and to `worktoolMessage.metadata`.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/dclaw-request-sanitization.test.js tests/dclaw-attachments.test.js`

Expected: PASS.

### Task 5: Final Verification

**Files:**
- Check: `src/inbound-attachments.js`
- Check: `src/message-rules.js`
- Check: `src/server.js`
- Check: `src/dclaw.js`

- [ ] **Step 1: Syntax check**

Run:

```bash
node --check src/inbound-attachments.js
node --check src/message-rules.js
node --check src/server.js
node --check src/dclaw.js
```

Expected: all commands pass.

- [ ] **Step 2: Focused regression tests**

Run:

```bash
node --test \
  tests/inbound-attachments.test.js \
  tests/message-rules.test.js \
  tests/server-inbound-attachments-boundary.test.js \
  tests/dclaw-request-sanitization.test.js \
  tests/dclaw-attachments.test.js \
  tests/server-agent-attachments-boundary.test.js
```

Expected: all tests pass.

- [ ] **Step 3: Review concurrent changes**

Run: `git status --short`

Expected: only the inbound attachment files and pre-existing unrelated dirty files are present. Do not revert unrelated changes from the other session.
