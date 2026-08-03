# Group Cumulative Aggregate Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make white-language cumulative summary variables reliably use bounded, message-backed facts from group creation through the current run without exposing all historical facts to the Agent.

**Architecture:** Persist one rebuildable aggregate per Bot/group/fact category beside the shared fact ledger. Rebuild affected categories transactionally after fact mutations, preserve representative fact/message evidence, and expose aggregates only to explicitly cumulative summary variables while keeping normal conditions and variables cycle-scoped.

**Tech Stack:** Node.js ESM, built-in `node:test`, SQLite through `node:sqlite`, existing group automation worker and DClaw JSON contracts.

## Global Constraints

- The shared fact ledger remains the source of truth; aggregates are bounded rebuildable projections.
- Only active facts backed by inbound group messages contribute.
- Ordinary daily, weekly, and monthly decisions never consume historical aggregates.
- Cumulative variables are explicit through `累计`, `至今`, `从建群`, or `自建群` in their name or rule.
- Non-fallback cumulative values must cite representative fact keys that resolve to real inbound message evidence.
- Group merge rebuilds target aggregates after semantic-key deduplication; Bot deletion removes aggregates.
- Agent requests remain bounded and never contain historical chat text.

---

### Task 1: Persist shared fact-category aggregates

**Files:**
- Modify: `src/db.js`
- Test: `tests/db-group-ledger.test.js`

**Interfaces:**
- Consumes: active `managed_group_facts` rows and `managed_group_fact_evidence`.
- Produces: `listGroupLedgerProjection({ botId, groupId }).aggregates` keyed by category.

- [ ] **Step 1: Write failing aggregate lifecycle tests**

Create two active `lesson_completed` facts with `{ count: 1, durationMinutes: 45 }`, assert the projection contains:

```js
assert.deepEqual(projection.aggregates.lesson_completed, {
  factCount: 2,
  numericSums: { count: 2, durationMinutes: 90 },
  firstHappenedAt: firstTime,
  lastHappenedAt: secondTime,
  evidenceFactKeys: [firstKey, secondKey],
  evidenceMessageIds: [firstMessage.id, secondMessage.id]
});
```

Retract the second fact and assert `factCount === 1`, numeric sums roll back, and the fact revision chain remains intact.

- [ ] **Step 2: Run the DB test and verify RED**

Run: `node --test tests/db-group-ledger.test.js`

Expected: FAIL because `projection.aggregates` is missing.

- [ ] **Step 3: Add aggregate schema and deterministic rebuild helpers**

Add `managed_group_fact_aggregates` with unique `(bot_id, group_id, category)`. Implement:

```js
function rebuildGroupFactAggregate({ botId, groupId, category, timestamp })
function rebuildAllGroupFactAggregates({ botId, groupId, timestamp })
function accumulateFiniteNumbers(target, value, prefix = "")
```

Only sum finite numeric leaf values using stable dotted paths, cap representative facts/messages at 20 newest entries, and delete the aggregate row when no active facts remain. In `applyGroupLedgerEvaluation`, capture old and new categories and rebuild them before committing.

- [ ] **Step 4: Return aggregate projections and handle lifecycle operations**

Map aggregate rows into:

```js
{
  [category]: {
    factCount,
    numericSums,
    firstHappenedAt,
    lastHappenedAt,
    evidenceFactKeys,
    evidenceMessageIds
  }
}
```

Rebuild all target aggregates after `mergeGroupAlias`, and include the aggregate table in `deleteBotData`.

- [ ] **Step 5: Run DB tests and commit**

Run: `node --test tests/db-group-ledger.test.js tests/db-group-automation.test.js`

Expected: PASS.

```bash
git add src/db.js tests/db-group-ledger.test.js tests/db-group-automation.test.js
git commit -m "feat: persist cumulative group fact aggregates"
```

---

### Task 2: Scope cumulative aggregates to explicit summary variables

**Files:**
- Modify: `src/group-summary-template.js`
- Modify: `src/group-automation-agent.js`
- Modify: `src/group-automation-worker.js`
- Test: `tests/group-summary-template.test.js`
- Test: `tests/group-automation-agent.test.js`
- Test: `tests/group-automation-worker.test.js`

**Interfaces:**
- Consumes: parsed variables and `projection.aggregates` from Task 1.
- Produces: `isCumulativeSummaryVariable(variable) -> boolean` and a bounded occurrence request.

- [ ] **Step 1: Write failing scope and worker tests**

Assert:

```js
assert.equal(isCumulativeSummaryVariable({ name: "累计上课次数", instruction: "从建群至今" }), true);
assert.equal(isCumulativeSummaryVariable({ name: "本周上课次数", instruction: "本周完成课程" }), false);
```

Build an occurrence with an old lesson fact plus a current-cycle fact. Assert ordinary templates receive only current facts and no aggregate; cumulative templates receive the bounded aggregate and can cite an aggregate `evidenceFactKey` even though the old fact is outside the current cycle.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/group-summary-template.test.js tests/group-automation-agent.test.js tests/group-automation-worker.test.js`

Expected: FAIL because cumulative-variable classification and aggregate scoping do not exist.

- [ ] **Step 3: Implement explicit cumulative classification and request contract**

Export:

```js
export function isCumulativeSummaryVariable(variable) {
  return /累计|至今|从建群|自建群/u.test(`${variable.name || ""} ${variable.instruction || ""}`);
}
```

In the worker, preserve all facts in a private map, filter `projection.facts` to the occurrence cycle, and retain `projection.aggregates` only when the parsed template contains at least one cumulative variable. Add each aggregate's representative keys to the allowed fact map. In the Agent request, annotate each variable with `scope: "cumulative" | "cycle"` and instruct the Agent that aggregates are legal only for cumulative variables.

- [ ] **Step 4: Validate evidence and boundedness**

Keep the existing `factKeys` requirement for every non-fallback variable. Reject unknown aggregate keys. Ensure `compactGroupLedgerProjection` bounds aggregate categories, field lengths, fact keys, and message IDs before composing the request.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test tests/group-summary-template.test.js tests/group-automation-agent.test.js tests/group-automation-worker.test.js`

Expected: PASS.

```bash
git add src/group-summary-template.js src/group-automation-agent.js src/group-automation-worker.js tests/group-summary-template.test.js tests/group-automation-agent.test.js tests/group-automation-worker.test.js
git commit -m "feat: support bounded cumulative summary variables"
```

---

### Task 3: Completion audit and regression proof

**Files:**
- Modify: `tests/group-automation-large-ledger.test.js`
- Modify: `docs/superpowers/specs/2026-08-04-group-scheduled-automation-design.md`

**Interfaces:**
- Consumes: completed aggregate and worker behavior.
- Produces: requirement-level regression evidence.

- [ ] **Step 1: Extend the 2,000-message integration test**

Seed facts across prior and current months, process all ledger batches, then assert the cumulative aggregate remains bounded, the live cursor reaches the final message, and the occurrence request does not contain all historical fact statements.

- [ ] **Step 2: Document the implemented aggregate invariant**

Update the main design's context-control section to name `managed_group_fact_aggregates`, explicit cumulative-variable detection, transactional correction handling, and representative message-backed evidence.

- [ ] **Step 3: Run all verification commands**

Run:

```bash
git diff --check
node --check src/db.js
node --check src/group-automation-worker.js
npm test
```

Expected: all tests pass, zero failures, and no diff errors.

- [ ] **Step 4: Commit final audit changes**

```bash
git add tests/group-automation-large-ledger.test.js docs/superpowers/specs/2026-08-04-group-scheduled-automation-design.md
git commit -m "test: verify cumulative group automation context"
```
