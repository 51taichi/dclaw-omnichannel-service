# Zero-Minute Activation Delay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow flow and tag activation intervals of `0` minutes and schedule those messages after a fixed five-second delay.

**Architecture:** Add one pure timing helper shared by database reconciliation and the runtime worker. Preserve zero through console drafts, backend normalization, persistence, and row mapping; positive intervals retain the current minute and retry-multiplier behavior.

**Tech Stack:** Node.js ESM, Node test runner, vanilla JavaScript console UI, SQLite.

## Global Constraints

- `intervalMinutes: 0` means a fixed `5,000` millisecond delay.
- Repeated attempts with a zero interval remain fixed at five seconds.
- Positive intervals keep their current exponential retry multiplier.
- No database migration or new API field is introduced.
- Both flow activation and tag activation use the same rule.

---

### Task 1: Shared Activation Timing

**Files:**
- Create: `src/activation-timing.js`
- Create: `tests/activation-timing.test.js`

**Interfaces:**
- Produces: `activationDelayMs(intervalMinutes, attemptNumber): number`
- Zero returns `5000`; positive values return `minutes * 60000 * 2 ** (attemptNumber - 1)`.

- [ ] **Step 1: Write failing timing tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { activationDelayMs } from "../src/activation-timing.js";

test("zero-minute activation waits five seconds for every attempt", () => {
  assert.equal(activationDelayMs(0, 1), 5_000);
  assert.equal(activationDelayMs(0, 3), 5_000);
});

test("positive activation minutes retain exponential retry timing", () => {
  assert.equal(activationDelayMs(2, 1), 120_000);
  assert.equal(activationDelayMs(2, 3), 480_000);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/activation-timing.test.js`

Expected: FAIL because `src/activation-timing.js` does not exist.

- [ ] **Step 3: Implement the timing helper**

```js
export const ZERO_MINUTE_ACTIVATION_DELAY_MS = 5_000;

export function activationDelayMs(intervalMinutes, attemptNumber = 1) {
  const interval = Math.max(0, Number(intervalMinutes) || 0);
  if (interval === 0) return ZERO_MINUTE_ACTIVATION_DELAY_MS;
  const multiplier = 2 ** Math.max(0, Number(attemptNumber || 1) - 1);
  return interval * 60_000 * multiplier;
}
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `node --test tests/activation-timing.test.js`

Expected: PASS.

### Task 2: Preserve Zero Through Backend Configuration

**Files:**
- Modify: `src/db.js`
- Modify: `src/tags.js`
- Modify: `tests/db-activation.test.js`
- Modify: `tests/tags.test.js`

**Interfaces:**
- Consumes: activation messages containing integer `intervalMinutes` values.
- Produces: normalized and persisted activation messages that retain `0`.

- [ ] **Step 1: Add failing normalization and persistence tests**

Add assertions proving:

```js
assert.equal(db.normalizeActivationConfig({
  messages: [{ content: "立即跟进", intervalMinutes: 0, maxTimes: 1 }]
}).messages[0].intervalMinutes, 0);

assert.equal(normalizeTagSchema({
  groups: [{ id: "g", name: "组", tags: [{
    id: "t", name: "标签", condition: "命中",
    activation: { enabled: true, messages: [{ content: "立即跟进", intervalMinutes: 0, maxTimes: 1 }] }
  }] }]
}).groups[0].tags[0].activation.messages[0].intervalMinutes, 0);
```

Extend the database activation test to schedule and read a zero-minute task and assert `task.intervalMinutes === 0`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/db-activation.test.js tests/tags.test.js`

Expected: FAIL because existing `Math.max(1, ...)` and `|| 30` expressions convert zero.

- [ ] **Step 3: Implement zero-safe normalization and persistence**

In `src/db.js` and `src/tags.js`, parse optional integers without using truthiness:

```js
function nonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}
```

Use it for activation intervals while retaining the existing minimum of one for `maxTimes`. Replace row and insert fallbacks such as `row.interval_minutes || 30` and `message?.intervalMinutes || 30` with nullish or explicit finite-number handling so database zero values survive.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/db-activation.test.js tests/tags.test.js`

Expected: PASS.

### Task 3: Apply Shared Timing to Every Scheduler

**Files:**
- Modify: `src/server.js`
- Modify: `src/db.js`
- Modify: `tests/server-activation-worker-boundary.test.js`
- Modify: `tests/db-activation.test.js`

**Interfaces:**
- Consumes: `activationDelayMs(intervalMinutes, attemptNumber)` from Task 1.
- Produces: ISO due timestamps using a five-second delay for zero and existing minute timing for positive values.

- [ ] **Step 1: Add failing scheduler boundary tests**

Assert `src/server.js` and `src/db.js` import and call `activationDelayMs`, and add a database reconciliation case where a zero-minute activation anchored at a fixed timestamp is due exactly five seconds later.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/activation-timing.test.js tests/server-activation-worker-boundary.test.js tests/db-activation.test.js`

Expected: FAIL because both schedulers still multiply zero minutes into zero milliseconds.

- [ ] **Step 3: Replace duplicate timing formulas**

In `src/server.js`:

```js
function activationDueAtForAttempt(anchorAt, intervalMinutes, attemptNumber) {
  return new Date(
    new Date(anchorAt).getTime() + activationDelayMs(intervalMinutes, attemptNumber)
  ).toISOString();
}
```

In `src/db.js`, keep the existing anchor/fallback selection and replace the delay expression with:

```js
return new Date(baseMs + activationDelayMs(intervalMinutes, attemptNumber)).toISOString();
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/activation-timing.test.js tests/server-activation-worker-boundary.test.js tests/db-activation.test.js`

Expected: PASS.

### Task 4: Allow Zero in Flow and Tag Console Controls

**Files:**
- Modify: `public/console/app.js`
- Modify: `tests/console-activation-boundary.test.js`

**Interfaces:**
- Consumes: numeric interval input values.
- Produces: activation drafts with `intervalMinutes: 0` preserved in exported and saved configuration.

- [ ] **Step 1: Add failing console boundary tests**

Assert both rendered interval inputs contain `min="0"`, both update handlers clamp intervals with `Math.max(0, ...)`, and draft normalization preserves zero.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/console-activation-boundary.test.js`

Expected: FAIL because the current controls and handlers enforce a minimum of one.

- [ ] **Step 3: Update console parsing and controls**

Change flow and tag interval inputs to `min="0"`. Introduce a zero-safe draft interval parser and use it from `normalizeActivationMessageDraft`, `normalizeActivationDraft`, `updateDraftNodeActivationMessage`, and `updateTagActivationMessageDraft`. Keep `maxTimes` at a minimum of one.

Update the help text to state that `0 分钟` sends after five seconds.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/console-activation-boundary.test.js`

Expected: PASS.

### Task 5: Full Regression Verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run activation-focused tests**

Run:

```bash
node --test \
  tests/activation-timing.test.js \
  tests/db-activation.test.js \
  tests/tags.test.js \
  tests/console-activation-boundary.test.js \
  tests/server-activation-worker-boundary.test.js \
  tests/server-friend-added-activation-boundary.test.js \
  tests/server-tag-activation-boundary.test.js
```

Expected: PASS.

- [ ] **Step 2: Run syntax and whitespace checks**

Run:

```bash
node --check src/activation-timing.js
node --check src/server.js
node --check src/db.js
node --check src/tags.js
node --check public/console/app.js
git diff --check
```

Expected: all commands exit zero.

- [ ] **Step 3: Run the complete test suite**

Run: `npm test`

Expected: all tests pass with zero failures.

