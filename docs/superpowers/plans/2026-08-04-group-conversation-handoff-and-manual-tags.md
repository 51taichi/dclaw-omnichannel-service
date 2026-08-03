# Group Conversation Handoff And Manual Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give group conversations the same human-handoff, manual-reply, and manual-tag controls and behavior as private conversations.

**Architecture:** Reuse the existing conversation-level UI and server routes. Remove channel-only guards, resolve manual reply targets by conversation type, and let human-handoff group messages enter the existing silent DClaw transcript path before group auto-reply policy can discard them.

**Tech Stack:** Node.js 22, Express, SQLite, browser JavaScript, CSS, Node test runner.

## Global Constraints

- Do not change existing private conversation behavior.
- Do not add customer flow-activation tasks, task-node controls, or asset controls to groups.
- Keep group tag-activation scheduling and cancellation aligned with private conversations.
- Do not implement per-group scheduled pushes.
- Send group manual replies only to the managed group's current name.
- Every behavior change follows RED-GREEN-REFACTOR and the full test suite must pass.

---

## File Structure

- `public/console/app.js`: render and operate shared handoff/tag/manual-reply controls for both conversation types.
- `src/server.js`: accept group manual tags/replies, resolve the group target, and route human-handoff group messages through silent DClaw synchronization.
- `tests/console-handoff-boundary.test.js`: protect shared handoff controls, ordering, and composer behavior.
- `tests/console-tags-boundary.test.js`: protect group manual-tag entry points.
- `tests/server-handoff-boundary.test.js`: protect group handoff ordering and group manual-reply target resolution.
- `tests/server-tags-boundary.test.js`: protect group manual-tag acceptance and existing activation behavior.

### Task 1: Shared Group Conversation Controls

**Files:**
- Modify: `tests/console-handoff-boundary.test.js`
- Modify: `tests/console-tags-boundary.test.js`
- Modify: `public/console/app.js`

**Interfaces:**
- Consumes: `flowSessionType(session)`, `toggleSelectedConversationHandoff(conversationKey)`, `renderFlowSessionManualTagMenu({ session, x, y })`, and `renderManualReplyComposer(session)`.
- Produces: the existing controls for both `private` and `group` session objects without changing request payloads.

- [ ] **Step 1: Write failing console boundary tests**

Add this source-body helper to `tests/console-handoff-boundary.test.js`:

```js
function functionBody(name) {
  const start = app.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} is defined`);
  const signatureEnd = app.indexOf(") {", start);
  const open = signatureEnd + 2;
  let depth = 0;
  for (let index = open; index < app.length; index += 1) {
    if (app[index] === "{") depth += 1;
    if (app[index] === "}") depth -= 1;
    if (depth === 0) return app.slice(open + 1, index);
  }
  assert.fail(`${name} body is closed`);
}
```

Replace private-only expectations with these assertions:

```js
test("private and group cards expose the same handoff and manual-tag controls", () => {
  const renderBody = functionBody("renderFlowSessions");
  assert.doesNotMatch(renderBody, /const manualTagTrigger = sessionType === "private"/);
  assert.doesNotMatch(renderBody, /const handoffSwitch = sessionType === "private"/);
  assert.match(renderBody, /class="flow-session-manual-tag-trigger"/);
  assert.match(renderBody, /class="flow-session-switch handoff-switch/);
  assert.doesNotMatch(renderBody, /if \(flowSessionType\(session\) !== "private"\) return/);
});

test("manual reply composer supports the selected private or group session", () => {
  const body = functionBody("renderManualReplyComposer");
  assert.doesNotMatch(body, /flowSessionType\(session\) === "private"/);
  assert.match(body, /session && state\.selectedFlowConversationKey/);
});
```

Also change handoff ordering assertions so `sortFlowSessions` checks
`session.handoffStatus === "human"` without requiring a private session.

- [ ] **Step 2: Run focused console tests and verify RED**

Run:

```bash
node --test tests/console-handoff-boundary.test.js tests/console-tags-boundary.test.js
```

Expected: FAIL because group controls and the group composer are currently suppressed.

- [ ] **Step 3: Implement shared rendering**

In `public/console/app.js`:

```js
const isHandoff = session.handoffStatus === "human";
const manualTagTrigger = `<span
  class="flow-session-manual-tag-trigger"
  data-flow-manual-tag-trigger="${escapeHtml(session.conversationKey)}"
  role="button"
  tabindex="0"
  title="手工打标签"
  aria-label="给${escapeHtml(name)}手工打标签"
>${icon("tag")}</span>`;
const handoffSwitch = `<span class="flow-session-switch handoff-switch ${isHandoff ? "is-human" : ""}" data-flow-handoff-switch="${escapeHtml(session.conversationKey)}" role="switch" tabindex="0" aria-checked="${isHandoff ? "true" : "false"}" title="${isHandoff ? "恢复 AI 接手" : "切换为人工接手"}" aria-label="${isHandoff ? "恢复 AI 接手" : "切换为人工接手"}">
  <span class="handoff-switch-option is-ai" aria-hidden="true">${icon("robot")}</span>
  <span class="handoff-switch-option is-human" aria-hidden="true">${icon("user")}</span>
  <span class="handoff-switch-thumb" aria-hidden="true"></span>
</span>`;
```

Keep `privateSessionTools` private-only so group cards still do not show task nodes. Remove the private-only return from the card context-menu handler and from `renderFlowSessionManualTagMenu`. Define composer availability as:

```js
const hasSession = Boolean(session && state.selectedFlowConversationKey);
```

Update `sortFlowSessions` to pin any human-handoff session within the active channel list.

- [ ] **Step 4: Run focused console tests and verify GREEN**

Run:

```bash
node --test tests/console-handoff-boundary.test.js tests/console-tags-boundary.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit the console behavior**

```bash
git add public/console/app.js tests/console-handoff-boundary.test.js tests/console-tags-boundary.test.js
git commit -m "feat: expose group conversation handoff controls"
```

### Task 2: Group Manual Tags And Manual Replies

**Files:**
- Modify: `tests/server-tags-boundary.test.js`
- Modify: `tests/server-handoff-boundary.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `getGroupByConversationKey({ botId, conversationKey })`, `privateTargetNameFromConversationKey(conversationKey)`, `applyManualConversationTagChange({ botId, binding, conversationKey, groupId, tagId, action })`, and `sendTextMessage({ robotId, targets, content })`.
- Produces: `manualReplyTargetForConversation({ botId, conversationKey }): string`, used only by the manual-reply route.

- [ ] **Step 1: Write failing server boundary tests**

Change the group tag rejection test to:

```js
test("manual tag route accepts existing private and group conversations", () => {
  const start = source.indexOf('"/api/flow-sessions/:conversationKey/tags/manual"');
  const end = source.indexOf('"/api/flow-sessions/:conversationKey/handoff"', start);
  const route = source.slice(start, end);
  assert.doesNotMatch(route, /group conversations do not support manual tags/);
  assert.match(route, /applyManualConversationTagChange\(\{/);
});
```

Add this source-body helper to `tests/server-handoff-boundary.test.js`:

```js
function functionBody(name) {
  const start = serverSource.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} is defined`);
  const signatureEnd = serverSource.indexOf(") {", start);
  const open = signatureEnd + 2;
  let depth = 0;
  for (let index = open; index < serverSource.length; index += 1) {
    if (serverSource[index] === "{") depth += 1;
    if (serverSource[index] === "}") depth -= 1;
    if (depth === 0) return serverSource.slice(open + 1, index);
  }
  assert.fail(`${name} body is closed`);
}
```

Add these manual-reply assertions:

```js
test("manual replies resolve private customers or managed group current names", () => {
  assert.match(serverSource, /function manualReplyTargetForConversation\(\{ botId, conversationKey \}\)/);
  const body = functionBody("manualReplyTargetForConversation");
  assert.match(body, /getGroupByConversationKey\(\{ botId, conversationKey \}\)/);
  assert.match(body, /managedGroup\?\.currentName/);
  assert.match(body, /privateTargetNameFromConversationKey\(conversationKey\)/);
  assert.doesNotMatch(serverSource, /manual reply only supports private conversations/);
});
```

- [ ] **Step 2: Run focused server tests and verify RED**

Run:

```bash
node --test tests/server-handoff-boundary.test.js tests/server-tags-boundary.test.js
```

Expected: FAIL on the current group rejection and private-only manual reply guard.

- [ ] **Step 3: Implement group-aware server routes**

Remove the group rejection block from the manual-tag route. Add the target resolver near the existing manual tag helper:

```js
function manualReplyTargetForConversation({ botId, conversationKey }) {
  const managedGroup = getGroupByConversationKey({ botId, conversationKey });
  return String(
    managedGroup?.currentName
    || privateTargetNameFromConversationKey(conversationKey)
    || ""
  ).trim();
}
```

In the manual-reply route, remove `isPrivateConversationKey` rejection and use:

```js
const target = manualReplyTargetForConversation({ botId, conversationKey });
```

Retain Bot ownership, enabled binding, human-handoff, non-empty content, successful-send persistence, and missing-target validation exactly as they are.

- [ ] **Step 4: Run focused server tests and verify GREEN**

Run:

```bash
node --test tests/server-handoff-boundary.test.js tests/server-tags-boundary.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit group server actions**

```bash
git add src/server.js tests/server-handoff-boundary.test.js tests/server-tags-boundary.test.js
git commit -m "feat: support group manual tags and replies"
```

### Task 3: Silent Group Handoff Synchronization

**Files:**
- Modify: `tests/server-handoff-boundary.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: persisted group sessions, `buildDclawHandoffTranscriptRequest({ binding, conversation, message, flow, tagContext, tagEvidenceCandidates, conversationReset, generalRule })`, `buildTagContext({ binding, conversationKey, group })`, and existing group reply-policy decisions.
- Produces: one shared human-handoff branch that handles private and group text messages before visible reply policy can return.

- [ ] **Step 1: Write failing inbound ordering tests**

Add these assertions:

```js
test("group human handoff bypasses visible group reply policy and uses group tag scope", () => {
  const body = processIncomingBody();
  const humanState = body.indexOf('const isHumanHandoff =');
  const policySkip = body.indexOf('if (!isHumanHandoff && !groupPolicy.invokeAgent');
  const handoffBranch = body.indexOf('if (flow?.session?.handoffStatus === "human")');
  assert.ok(humanState >= 0 && humanState < policySkip);
  assert.ok(policySkip >= 0 && policySkip < handoffBranch);
  assert.doesNotMatch(body, /if \(isPrivateMessage\(message\) && flow\?\.session\?\.handoffStatus === "human"\)/);
  assert.match(body.slice(handoffBranch), /buildTagContext\(\{ binding, conversationKey, group \}\)/);
});

test("coalesced group work stops when handoff changes to human", () => {
  const body = functionBody("processCoalescedIncomingBatch");
  assert.match(body, /if \(flow\?\.session\?\.handoffStatus === "human"\)/);
  assert.doesNotMatch(body, /isPrivateMessage\(message\) && flow\?\.session\?\.handoffStatus/);
});
```

- [ ] **Step 2: Run the handoff tests and verify RED**

Run:

```bash
node --test tests/server-handoff-boundary.test.js
```

Expected: FAIL because group policy currently returns before the private-only handoff branch.

- [ ] **Step 3: Implement shared inbound handoff behavior**

After conversation persistence and before the group-policy early return, read the current session:

```js
const isHumanHandoff = getFlowSession(conversationKey)?.handoffStatus === "human";
```

Guard the group policy return:

```js
if (!isHumanHandoff && !groupPolicy.invokeAgent && !joinsMentionedGroupBatch) {
  const status = groupPolicy.reason === "policy_never"
    ? "group_policy_never"
    : "group_mention_required";
  logInfo("incoming.skipped", {
    ...logContext,
    reason: status
  });
  finishMessageProcessing({ messageKey, status });
  return;
}
```

Change both handoff checks from private-only to the shared session condition. In the immediate handoff branch, preserve group-bound tag configuration:

```js
const tagContext = buildTagContext({ binding, conversationKey, group });
```

Do not call `sendTextReplyParts`, do not advance flow nodes, and retain the existing `human_handoff` processing status and retry/error logging.

- [ ] **Step 4: Run focused handoff and group policy tests and verify GREEN**

Run:

```bash
node --test tests/server-handoff-boundary.test.js tests/server-group-management-boundary.test.js tests/groups.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit silent group handoff processing**

```bash
git add src/server.js tests/server-handoff-boundary.test.js
git commit -m "feat: sync group messages during human handoff"
```

### Task 4: Regression Verification And Delivery

**Files:**
- Verify: all files changed in Tasks 1-3

**Interfaces:**
- Consumes: all behavior delivered above.
- Produces: a clean, tested `main` branch pushed to `origin/main`.

- [ ] **Step 1: Run all focused tests together**

```bash
node --test tests/console-handoff-boundary.test.js tests/console-tags-boundary.test.js tests/server-handoff-boundary.test.js tests/server-tags-boundary.test.js tests/db-handoff.test.js tests/db-group-session.test.js tests/dclaw-handoff.test.js
```

Expected: PASS.

- [ ] **Step 2: Run the full suite**

```bash
npm test
```

Expected: all tests pass with zero failures.

- [ ] **Step 3: Check formatting and scope**

```bash
git diff --check
git status --short --branch
```

Expected: no whitespace errors and only intentional commits ahead of `origin/main`.

- [ ] **Step 4: Push the completed feature**

```bash
git push origin main
```

- [ ] **Step 5: Confirm delivery state**

```bash
git status --short --branch
git log --oneline -5
```

Expected: `main...origin/main` with no uncommitted files and the feature commits visible.
