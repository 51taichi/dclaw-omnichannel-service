# Agent Response Bounded Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow at most three Agent calls for invalid responses and require AI-controlled realtime private conversations to produce reply text or a sendable attachment.

**Architecture:** Keep validation and retry ownership in `agent-response-gateway.js`, replacing the hard-coded two-attempt loop with one named limit. Reuse the existing `requireReplyContent` validation contract by setting it only for realtime private conversation requests in `dclaw.js`; background analysis and unauthorized group requests retain existing silent-response behavior.

**Tech Stack:** Node.js ES modules, built-in `node:test`, existing DClaw request builder and Agent response Gateway.

## Global Constraints

- Maximum Agent calls per validation cycle: 3, including the initial call.
- Every response is locally repaired and validated before another Agent call.
- AI-controlled realtime private messages require non-empty reply text or a sendable attachment.
- Background analysis and unauthorized group messages may return an empty reply.
- No Agent project changes, new UI settings, dependency changes, or WorkTool callback changes.
- Do not modify unrelated dirty files in the working tree.

---

### Task 1: Increase the Gateway validation attempt limit

**Files:**
- Modify: `src/agent-response-gateway.js`
- Test: `tests/agent-response-gateway.test.js`

**Interfaces:**
- Consumes: `validateAndRetryAgentResponse({ request, invoke, validationOptions, ...callbacks })`.
- Produces: the same return object and callbacks, with attempts numbered 1 through 3 and final failure reported at attempt 3.

- [ ] **Step 1: Update the failure test to require exactly three attempts**

Rename the existing `gateway stops after two syntax failures and reports the final outcome` test and change its assertions to:

```js
assert.equal(result.valid, false);
assert.equal(requests.length, 3);
assert.deepEqual(requests, [originalRequest, originalRequest, originalRequest]);
assert.deepEqual(
  failures.map((failure) => failure.retryRequested),
  [false, true, true]
);
assert.deepEqual(outcomes, [{
  outcome: "failed",
  attemptNumber: 3,
  error: null
}]);
```

Add a test where attempts 1 and 2 return invalid JSON and attempt 3 returns a valid JSON object. Assert `result.valid === true`, `result.attempts.length === 3`, and all three requests equal the unchanged original request.

- [ ] **Step 2: Run the focused Gateway tests and verify failure**

Run:

```bash
node --test tests/agent-response-gateway.test.js
```

Expected: the new three-attempt assertions fail because the Gateway currently stops after attempt 2.

- [ ] **Step 3: Replace the hard-coded loop limit with a named constant**

In `src/agent-response-gateway.js`, define:

```js
const maxAgentResponseValidationAttempts = 3;
```

Change the loop condition to:

```js
for (
  let attemptNumber = 1;
  attemptNumber <= maxAgentResponseValidationAttempts;
  attemptNumber += 1
) {
```

Change the branches that currently treat `attemptNumber > 1` as the final call so that `onRetryOutcome({ outcome: "failed" })` is emitted only when `attemptNumber === maxAgentResponseValidationAttempts`. For any earlier invalid attempt, build the next request using the existing error-type policy: syntax failures reuse `originalRequest`; schema and semantic failures use `buildAgentResponseValidationRetryRequest(...)`.

- [ ] **Step 4: Run the focused Gateway tests and verify success**

Run:

```bash
node --test tests/agent-response-gateway.test.js
```

Expected: all Gateway tests pass, including the new three-attempt success and final-failure cases.

- [ ] **Step 5: Commit the Gateway limit change**

```bash
git add src/agent-response-gateway.js tests/agent-response-gateway.test.js
git commit -m "fix: bound agent response validation at three attempts"
```

### Task 2: Require content for realtime private replies

**Files:**
- Modify: `src/dclaw.js`
- Test: `tests/dclaw-request-sanitization.test.js`
- Test: `tests/agent-response-gateway.test.js`

**Interfaces:**
- Consumes: `buildDclawRequest({ message, groupContext, dclawPurpose })` and the existing `metadata.requireReplyContent` flag.
- Produces: `metadata.requireReplyContent === true` for private `roomType` 2 or 4 requests with `dclawPurpose === "conversation"`; existing authorized group behavior remains true and background analysis remains false.

- [ ] **Step 1: Add request-boundary tests for private and background calls**

In `tests/dclaw-request-sanitization.test.js`, add assertions equivalent to:

```js
const livePrivate = buildDclawRequest({
  binding,
  conversation: { conversationKey: "bot_1:private:L" },
  message: {
    messageId: "private-empty-guard",
    spoken: "[微笑]",
    rawSpoken: "[微笑]",
    roomType: 2,
    textType: 1,
    receivedName: "L"
  }
});
assert.equal(livePrivate.metadata.requireReplyContent, true);

const backgroundPrivate = buildDclawRequest({
  binding,
  conversation: { conversationKey: "bot_1:private:L" },
  message: {
    messageId: "private-history-analysis",
    spoken: "历史分析",
    rawSpoken: "历史分析",
    roomType: 2,
    textType: 1,
    receivedName: "L"
  },
  dclawPurpose: "legacy-history-analysis"
});
assert.equal(backgroundPrivate.metadata.requireReplyContent, false);
```

Retain the existing assertion that an authorized group request sets `requireReplyContent` to `true`.

- [ ] **Step 2: Run request tests and verify the live-private assertion fails**

Run:

```bash
node --test tests/dclaw-request-sanitization.test.js
```

Expected: the live private request currently has `requireReplyContent === false`.

- [ ] **Step 3: Set the existing validation flag at the request boundary**

In `buildDclawRequest`, compute one local value:

```js
const requireReplyContent = Boolean(
  agentGroupContext?.replyDecision?.authorized
  || (!isGroup && dclawPurpose === "conversation")
);
```

Use this value in both places that describe the response contract:

```js
requireReplyContent
  ? `JSON 格式：${responseSchema}。没有附件或来源时使用空数组；本请求必须回复，reply 和 attachments 不得同时为空。`
  : `JSON 格式：${responseSchema}。没有附件或来源时使用空数组；不需要回复时使用 {"reply":"","attachments":[],"sources":[]}。`
```

```js
requireReplyContent
```

The second expression replaces the current `metadata.requireReplyContent` assignment. Do not change background request builders or server fallback code.

- [ ] **Step 4: Verify the Gateway already rejects empty required replies**

Keep or extend the existing Gateway test using:

```js
validationOptions: { requireReplyContent: true }
```

Assert that empty `reply` plus empty `attachments` retries through attempt 3 and returns `valid === false`, while empty `reply` with one attachment returns `valid === true` on the first attempt.

Run:

```bash
node --test tests/agent-response-gateway.test.js tests/dclaw-request-sanitization.test.js
```

Expected: all focused tests pass.

- [ ] **Step 5: Run the full verification suite**

Run:

```bash
npm test
git diff --check
node --check src/agent-response-gateway.js
node --check src/dclaw.js
```

Expected: all tests pass, no whitespace errors, and both modified source files parse successfully.

- [ ] **Step 6: Commit the realtime private reply contract**

```bash
git add src/dclaw.js tests/dclaw-request-sanitization.test.js tests/agent-response-gateway.test.js
git commit -m "fix: require content for realtime private replies"
```
