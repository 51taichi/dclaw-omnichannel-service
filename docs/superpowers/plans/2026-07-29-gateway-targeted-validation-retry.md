# Gateway Targeted Validation Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely recover a single complete Agent JSON response and make validation retries correct the previous response with a complete tag checklist.

**Architecture:** Keep response normalization and retry construction inside `src/agent-response-gateway.js`. Reuse the existing strict validators after deterministic JSON extraction; enrich only the retry prompt, without changing tag adjudication or server behavior.

**Tech Stack:** Node.js ESM, `node:test`, existing Agent response gateway and tag-audit modules.

## Global Constraints

- Do not modify Agent files, task nodes, tag configuration, or tag state transitions.
- Do not infer a missing tag evaluation as `false`.
- Reject ambiguous, truncated, or malformed JSON candidates.
- Bound prior-response text added to a retry request.

---

### Task 1: Safe Single-JSON Recovery

**Files:**
- Modify: `tests/agent-response-gateway.test.js`
- Modify: `src/agent-response-gateway.js`

**Interfaces:**
- Consumes: `validateAgentResponseText(rawText, options)`
- Produces: deterministic `single_embedded_json_extracted` repair for one complete valid object

- [ ] **Step 1: Write the failing production-shape test**

Add a test whose input is a valid audited JSON object followed by `已处理客户消息...`, and assert that validation succeeds with `single_embedded_json_extracted`.

- [ ] **Step 2: Verify the test fails**

Run: `node --test tests/agent-response-gateway.test.js`

Expected: the new test fails because `origin/main` rejects prose around JSON.

- [ ] **Step 3: Implement the minimal extraction**

Add balanced-object scanning and accept only one valid candidate or repeated deeply equal candidates. Return no repair when any candidate is incomplete, malformed, or ambiguous.

- [ ] **Step 4: Verify focused tests pass**

Run: `node --test tests/agent-response-gateway.test.js`

Expected: all gateway tests pass, including existing rejection boundaries.

### Task 2: Targeted Validation Retry Context

**Files:**
- Modify: `tests/agent-response-gateway.test.js`
- Modify: `src/agent-response-gateway.js`

**Interfaces:**
- Consumes: `buildAgentResponseValidationRetryRequest(request, errors, context)`
- Produces: one bounded correction prompt containing prior response and required tag checklist

- [ ] **Step 1: Write the failing retry-context tests**

Assert that a retry request includes the prior response, `groupId:tagId`, tag condition, and a requirement to evaluate every configured tag exactly once.

- [ ] **Step 2: Verify the tests fail**

Run: `node --test tests/agent-response-gateway.test.js`

Expected: the retry prompt lacks prior response and tag checklist.

- [ ] **Step 3: Implement bounded targeted retry context**

Pass the failed attempt's raw response and validation tag context into the retry builder. Truncate only the prompt copy of the prior response; do not modify the audited response or validators.

- [ ] **Step 4: Verify focused and full tests**

Run:

```bash
node --test tests/agent-response-gateway.test.js
npm test
```

Expected: all tests pass with zero failures.

### Task 3: Integrate Both Long-Lived Branches

**Files:**
- Commit the specification, plan, tests, and Gateway implementation.

**Interfaces:**
- Produces: the same Gateway behavior in `main` and `release/group-management-v1`

- [ ] **Step 1: Verify the final diff**

Run:

```bash
git diff --check
git status --short
```

- [ ] **Step 2: Commit and push `main`**

Commit the focused change and push it to `origin/main`.

- [ ] **Step 3: Merge updated `main` into the group release**

Merge `origin/main` into `release/group-management-v1`, rerun the focused test, and push the release branch.
