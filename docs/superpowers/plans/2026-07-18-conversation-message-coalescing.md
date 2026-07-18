# Continuous Inbound Message Coalescing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Buffer short bursts of inbound messages per Bot conversation and invoke DClaw once with the combined customer intent while preserving every original message record.

**Architecture:** Add a focused in-memory coalescer with sliding quiet and hard maximum windows, then split the current callback path into immediate acceptance and deferred Agent-batch processing. The coalescer owns timing and per-conversation execution order; `server.js` continues to own WorkTool validation, persistence, DClaw invocation, state-machine/tag decisions, and sending.

**Tech Stack:** Node.js 22 ESM, native timers, `node:test`, Express 5, SQLite through `node:sqlite`.

## Global Constraints

- Coalescing key is `botId + conversationKey`.
- Quiet window defaults to exactly `10000` ms and maximum window defaults to exactly `15000` ms.
- Every original callback remains a separate incoming and conversation message record.
- One flushed batch produces at most one normal Agent invocation and one business-decision cycle.
- Friend-added, non-text, debug ping, and human-handoff processing remain outside AI coalescing.
- Existing WorkTool deduplication runs before coalescing.
- Same-conversation batches execute in arrival order; different conversations remain independent before entering the existing global Agent queue.
- First release remains single-process and in-memory; no Redis or new dependency is introduced.

---

## File Structure

- Create `src/inbound-coalescer.js`: timer state, batch identity, sliding/max window logic, per-key serial flush, and cancellation APIs.
- Create `tests/inbound-coalescer.test.js`: deterministic fake-clock coverage for timing, isolation, ordering, and cancellation.
- Modify `src/server.js`: environment configuration, callback acceptance/buffering, batch message construction, cancellation hooks, and structured logging.
- Create `tests/server-inbound-coalescing-boundary.test.js`: server integration-boundary assertions for persistence order, exclusions, business-cycle placement, and cancellation hooks.
- Modify `.env.example`: document the two timing settings.

### Task 1: Build the deterministic conversation coalescer

**Files:**
- Create: `src/inbound-coalescer.js`
- Create: `tests/inbound-coalescer.test.js`

**Interfaces:**
- Produces: `createInboundMessageCoalescer(options)`.
- `options`: `{ quietMs, maxMs, now, setTimer, clearTimer, onFlush, onEvent }`.
- Returned API: `{ push(key, item), has(key), cancel(key, reason), cancelByBot(botId, reason), pendingCount() }`.
- `onFlush(batch)`: receives `{ id, key, botId, conversationKey, items, startedAt, flushedAt, reason }` where reason is `quiet_window` or `max_window`.
- `onEvent(name, details)`: receives `started`, `appended`, `flushed`, or `canceled` lifecycle events.

- [ ] **Step 1: Write failing timing and isolation tests**

Create a fake clock in `tests/inbound-coalescer.test.js` and assert:

```js
test("coalescer resets the quiet window but respects the hard maximum", async () => {
  const clock = createFakeClock();
  const flushed = [];
  const coalescer = createInboundMessageCoalescer({
    quietMs: 10_000,
    maxMs: 15_000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onFlush: async (batch) => flushed.push(batch)
  });

  coalescer.push("bot-a:private:张三", { text: "去哪里听？" });
  await clock.advance(9_000);
  coalescer.push("bot-a:private:张三", { text: "收钱的不？" });
  await clock.advance(5_999);
  assert.equal(flushed.length, 0);
  await clock.advance(1);
  assert.deepEqual(flushed[0].items.map((item) => item.text), ["去哪里听？", "收钱的不？"]);
  assert.equal(flushed[0].reason, "max_window");
});
```

Also cover one-message quiet flush, different-key isolation, `cancel`, `cancelByBot`, `has`, and `pendingCount`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/inbound-coalescer.test.js`

Expected: FAIL because `src/inbound-coalescer.js` does not exist.

- [ ] **Step 3: Implement the minimal timer and batch state machine**

Implement `createInboundMessageCoalescer` with:

```js
const pending = new Map();
const executionTails = new Map();

function push(key, item) {
  const existing = pending.get(key);
  if (existing) {
    existing.items.push(item);
    rescheduleQuiet(existing);
    emit("appended", existing);
    return existing.id;
  }
  const batch = createBatch(key, item);
  pending.set(key, batch);
  scheduleQuiet(batch);
  scheduleMaximum(batch);
  emit("started", batch);
  return batch.id;
}
```

When a timer flushes, atomically remove the pending batch, clear both timers, and append `onFlush(batch)` to `executionTails.get(key)` so a second batch for the same key cannot overtake it. Delete the execution tail after its final promise settles.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/inbound-coalescer.test.js`

Expected: all coalescer tests PASS with no unhandled rejection.

- [ ] **Step 5: Commit the isolated coalescer**

```bash
git add src/inbound-coalescer.js tests/inbound-coalescer.test.js
git commit -m "Add per-conversation inbound coalescer"
```

### Task 2: Add batch message construction without losing WorkTool metadata

**Files:**
- Modify: `src/server.js` near `messageLogFields` and `processIncomingMessage`
- Create: `tests/server-inbound-coalescing-boundary.test.js`

**Interfaces:**
- Produces: `buildCoalescedAgentMessage(messages)` inside `src/server.js`.
- Input: ordered WorkTool message objects from one `botId + conversationKey` batch.
- Output: one WorkTool-compatible message based on the last message, with combined `spoken`, combined `rawSpoken`, and `metadata.coalescedMessages` containing the original message IDs, text, sender, room type, group, and receive order.

- [ ] **Step 1: Write failing construction boundary tests**

Assert the server contains one builder and uses it before `normalizeMessageForAgent`:

```js
test("multiple inbound texts are presented to the Agent as one ordered customer turn", () => {
  assert.match(source, /function buildCoalescedAgentMessage\(messages\)/);
  assert.match(source, /客户连续发送了以下消息，请结合上下文统一回答/);
  assert.match(source, /const agentMessage = normalizeMessageForAgent\(coalescedMessage, binding\)/);
  assert.match(source, /metadata:[\s\S]*coalescedMessages/);
});
```

Add an assertion that a one-item batch preserves the original `spoken` value instead of adding a list prefix.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/server-inbound-coalescing-boundary.test.js`

Expected: FAIL because the builder and integration do not exist.

- [ ] **Step 3: Implement ordered batch construction**

Implement this behavior:

```js
function buildCoalescedAgentMessage(messages) {
  const ordered = messages.filter(Boolean);
  const last = ordered.at(-1) || {};
  if (ordered.length <= 1) return last;
  const lines = ordered.map((message, index) => `${index + 1}. ${String(message.spoken || message.rawSpoken || "").trim()}`);
  const spoken = `客户连续发送了以下消息，请结合上下文统一回答：\n${lines.join("\n")}`;
  return {
    ...last,
    spoken,
    rawSpoken: spoken,
    metadata: {
      ...(last.metadata || {}),
      coalescedMessages: ordered.map((message, index) => ({
        index,
        messageId: message.messageId || "",
        spoken: message.spoken || message.rawSpoken || "",
        receivedName: message.receivedName || "",
        roomType: message.roomType ?? null,
        groupName: message.groupName || ""
      }))
    }
  };
}
```

- [ ] **Step 4: Run focused tests and syntax validation**

Run:

```bash
node --test tests/server-inbound-coalescing-boundary.test.js
node --check src/server.js
```

Expected: PASS and no syntax errors.

- [ ] **Step 5: Commit batch message construction**

```bash
git add src/server.js tests/server-inbound-coalescing-boundary.test.js
git commit -m "Build combined Agent turns from inbound bursts"
```

### Task 3: Integrate deferred Agent processing into the callback path

**Files:**
- Modify: `src/server.js:2502` around `processIncomingMessage`
- Modify: `tests/server-inbound-coalescing-boundary.test.js`

**Interfaces:**
- Consumes: `createInboundMessageCoalescer` and `buildCoalescedAgentMessage`.
- Produces: `processCoalescedIncomingBatch(batch)` for one deferred business cycle.
- The immediate callback path owns dedupe, incoming persistence, per-message conversation history, activation invalidation, and eligibility checks.
- The deferred path recomputes current binding, conversation, flow, handoff, reset, and tag context before invoking Agent.

- [ ] **Step 1: Add failing callback-order and exclusion tests**

Assert these exact ordering boundaries:

```js
test("callbacks persist each message before buffering and business logic runs after flush", () => {
  const handler = sliceFunction(source, "async function processIncomingMessage", "async function processCoalescedIncomingBatch");
  assert.ok(handler.indexOf("beginMessageProcessing") < handler.indexOf("insertIncomingMessage"));
  assert.ok(handler.indexOf("insertConversationMessage") < handler.indexOf("inboundCoalescer.push"));
  assert.ok(handler.indexOf("invalidateFlowActivation") < handler.indexOf("inboundCoalescer.push"));
});

test("special and human-handoff paths do not enter AI coalescing", () => {
  assert.ok(source.indexOf("handleFriendAddedEvent") < source.indexOf("inboundCoalescer.push"));
  assert.ok(source.indexOf("handleDebugPing") < source.indexOf("inboundCoalescer.push"));
  assert.match(source, /handoffStatus === "human"[\s\S]*return;[\s\S]*inboundCoalescer\.push/);
});
```

Also assert that `applyFlowDecision`, `applyAgentTagDecision`, `scheduleActivationAfterFlowReply`, and WorkTool sending exist only in the flushed processing path, not once per accepted callback.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/server-inbound-coalescing-boundary.test.js`

Expected: FAIL on missing `inboundCoalescer.push` and deferred processor.

- [ ] **Step 3: Configure and instantiate the coalescer**

In `src/server.js`, parse finite non-negative values:

```js
const inboundCoalesceQuietMs = Math.max(0, Number(process.env.INBOUND_COALESCE_QUIET_MS || 10_000));
const inboundCoalesceMaxMs = Math.max(inboundCoalesceQuietMs, Number(process.env.INBOUND_COALESCE_MAX_MS || 15_000));
```

Instantiate it with an `onFlush` that calls `processCoalescedIncomingBatch` and maps lifecycle events to `incoming.coalesce.started`, `incoming.coalesce.appended`, `incoming.coalesce.flushed`, and `incoming.coalesce.canceled`.

- [ ] **Step 4: Split immediate acceptance from deferred processing**

Refactor `processIncomingMessage` so every accepted message item contains:

```js
{
  botId,
  conversationKey,
  message,
  messageKey,
  acceptedAt: new Date().toISOString()
}
```

Then call:

```js
inboundCoalescer.push(`${botId}:${conversationKey}`, item);
```

`processCoalescedIncomingBatch` must use all batch messages for Agent text but use the final message for WorkTool reply target and message log context. On success or terminal skip, call `finishMessageProcessing` for every `messageKey` in the batch with a batch-aware status such as `coalesced_processed`, `empty_reply`, or `suppressed`. On exception, mark every item failed and emit `message_callback.process_failed` with `batchId`.

- [ ] **Step 5: Preserve group mention continuation semantics**

Before rejecting an unmentioned group message, allow it only when a pending batch already exists for the same conversation:

```js
const coalesceKey = `${botId}:${conversationKey}`;
const joinsMentionedGroupBatch = isGroupMessage(message) && inboundCoalescer.has(coalesceKey);
if (!shouldInvokeAgent(message, binding) && !joinsMentionedGroupBatch) {
  // existing group_message_without_mention skip
}
```

This allows “`@客服 去哪里听？`” followed by “收费吗？” to become one batch, while unrelated group chatter never opens a batch.

- [ ] **Step 6: Run focused integration-boundary tests**

Run:

```bash
node --test tests/inbound-coalescer.test.js tests/server-inbound-coalescing-boundary.test.js
node --test tests/server-group-mention-boundary.test.js tests/server-activation-boundary.test.js tests/server-tags-boundary.test.js tests/server-handoff-boundary.test.js
node --check src/server.js
```

Expected: all tests PASS.

- [ ] **Step 7: Commit callback integration**

```bash
git add src/server.js tests/server-inbound-coalescing-boundary.test.js
git commit -m "Coalesce inbound bursts before Agent invocation"
```

### Task 4: Cancel stale batches at lifecycle boundaries

**Files:**
- Modify: `src/server.js` at Bot rebind, Bot delete, handoff, and conversation reset routes
- Modify: `tests/server-inbound-coalescing-boundary.test.js`

**Interfaces:**
- Consumes: `inboundCoalescer.cancel(key, reason)` and `inboundCoalescer.cancelByBot(botId, reason)`.
- Cancellation reasons: `conversation_reset`, `human_handoff`, `agent_rebound`, and `bot_deleted`.

- [ ] **Step 1: Add failing lifecycle cancellation tests**

Assert each route calls the correct cancellation API before destructive state mutation or response:

```js
assert.match(resetRoute, /inboundCoalescer\.cancel\([^,]+, "conversation_reset"\)/);
assert.match(handoffRoute, /handoffStatus === "human"[\s\S]*inboundCoalescer\.cancel\([^,]+, "human_handoff"\)/);
assert.match(rebindRoute, /inboundCoalescer\.cancelByBot\([^,]+, "agent_rebound"\)/);
assert.match(deleteRoute, /inboundCoalescer\.cancelByBot\([^,]+, "bot_deleted"\)/);
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/server-inbound-coalescing-boundary.test.js`

Expected: FAIL because lifecycle hooks are absent.

- [ ] **Step 3: Add cancellation hooks and finish pending message states**

Make cancellation return the canceled batch items. For each canceled item, call:

```js
finishMessageProcessing({
  messageKey: item.messageKey,
  status: "coalesced_canceled",
  error: reason
});
```

Ensure a late timer callback cannot flush a canceled batch by checking batch identity against the current pending entry.

- [ ] **Step 4: Run lifecycle and regression tests**

Run:

```bash
node --test tests/inbound-coalescer.test.js tests/server-inbound-coalescing-boundary.test.js
node --test tests/server-handoff-boundary.test.js tests/server-conversation-reset-sync.test.js tests/server-auth-boundary.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit lifecycle safety**

```bash
git add src/inbound-coalescer.js src/server.js tests/inbound-coalescer.test.js tests/server-inbound-coalescing-boundary.test.js
git commit -m "Cancel stale inbound batches on lifecycle changes"
```

### Task 5: Document configuration and verify the complete service

**Files:**
- Modify: `.env.example`
- Modify: `tests/server-inbound-coalescing-boundary.test.js`

**Interfaces:**
- Documents: `INBOUND_COALESCE_QUIET_MS=10000` and `INBOUND_COALESCE_MAX_MS=15000`.

- [ ] **Step 1: Add failing environment-boundary assertions**

```js
test("coalescing timing is configurable with approved defaults", () => {
  assert.match(envExample, /^INBOUND_COALESCE_QUIET_MS=10000$/m);
  assert.match(envExample, /^INBOUND_COALESCE_MAX_MS=15000$/m);
  assert.match(serverSource, /INBOUND_COALESCE_QUIET_MS \|\| 10_000/);
  assert.match(serverSource, /INBOUND_COALESCE_MAX_MS \|\| 15_000/);
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/server-inbound-coalescing-boundary.test.js`

Expected: FAIL until `.env.example` contains both settings.

- [ ] **Step 3: Add the environment examples**

Append:

```env
# Merge consecutive inbound text messages from the same conversation.
INBOUND_COALESCE_QUIET_MS=10000
INBOUND_COALESCE_MAX_MS=15000
```

- [ ] **Step 4: Run complete verification**

Run:

```bash
npm test
node --check src/server.js
node --check src/inbound-coalescer.js
git diff --check
```

Expected: the complete test suite passes, both syntax checks exit `0`, and `git diff --check` prints nothing.

- [ ] **Step 5: Review runtime evidence locally**

Start the service with short test-only windows:

```bash
INBOUND_COALESCE_QUIET_MS=100 INBOUND_COALESCE_MAX_MS=200 npm start
```

Post two unique private callback payloads for the same conversation within 100 ms and verify logs show one `incoming.coalesce.started`, one `incoming.coalesce.appended`, one `incoming.coalesce.flushed`, and one `agent.invoke.start`. Do not use an existing production Bot ID for this local check.

- [ ] **Step 6: Commit configuration and verification coverage**

```bash
git add .env.example tests/server-inbound-coalescing-boundary.test.js
git commit -m "Document inbound coalescing configuration"
```

- [ ] **Step 7: Request code review before deployment**

Use `superpowers:requesting-code-review` against the full change range. Resolve any correctness finding, rerun `npm test`, then push `main`. This feature changes only the control-service backend; no DClaw Agent package update is required.
