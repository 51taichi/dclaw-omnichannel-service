# Gateway Flow Asset Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject invalid Agent asset field names and prevent flow-node completion until configured fields are present.

**Architecture:** Extend the existing flow-decision validation inside `agent-response-gateway.js`. The Gateway derives allowed asset names and required current-node fields from the existing `flow` validation option, so the current retry, failure persistence, and business-layer ordering remain unchanged.

**Tech Stack:** Node.js ESM and Node test runner.

## Global Constraints

- Modify Gateway validation and its tests only.
- Asset keys must exactly match administrator-configured `collectFields` values.
- Do not hardcode aliases or silently rename fields.
- Keep the existing maximum of two Agent attempts.
- Invalid responses must not reach tags, asset persistence, node transition, or customer sending.

---

### Task 1: Asset-Key Contract Tests

**Files:**
- Modify: `tests/agent-response-gateway.test.js`

**Interfaces:**
- Consumes: `validateAgentResponseText(rawText, { flow })`.
- Produces: semantic errors for unknown `collectedDataPatch` keys.

- [ ] **Step 1: Add a failing unknown-key test**

```js
const result = validateAgentResponseText(JSON.stringify({
  reply: "17岁可以",
  attachments: [],
  sources: [],
  flowDecision: {
    currentNodeId: "node_1",
    nextNodeId: "node_2",
    nodeCompleted: false,
    collectedDataPatch: { age: 17 }
  }
}), {
  requireFlowDecision: true,
  flow: {
    machine: { nodes: [{ id: "node_1", collectFields: [] }, { id: "node_2", collectFields: ["年龄"] }] },
    session: { currentNodeId: "node_1", collectedData: {} }
  }
});

assert.equal(result.valid, false);
assert.ok(result.errors.some((error) =>
  error.path === "flowDecision.collectedDataPatch.age"
  && error.message.includes("年龄")
));
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/agent-response-gateway.test.js`

Expected: FAIL because `age` currently passes Gateway validation.

### Task 2: Required Current-Node Field Tests

**Files:**
- Modify: `tests/agent-response-gateway.test.js`

**Interfaces:**
- Consumes: current node and collected session data from `flow`.
- Produces: semantic errors when `nodeCompleted` is true with missing required fields.

- [ ] **Step 1: Add failing missing-field and existing-field tests**

Add one response with `nodeCompleted: true`, current node `node_2`, `collectFields: ["年龄"]`, empty patch, and empty session data; assert an error at `flowDecision.collectedDataPatch.年龄`.

Add the same response with `session.collectedData.年龄 = 17`; assert validation succeeds so already collected assets do not block progression.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/agent-response-gateway.test.js`

Expected: the missing-field assertion fails while the existing-field case remains valid.

### Task 3: Gateway Semantic Validation

**Files:**
- Modify: `src/agent-response-gateway.js`

**Interfaces:**
- Consumes: `flow.machine.nodes`, `flow.session.currentNodeId`, `flow.session.collectedData`, and the Agent patch.
- Produces: semantic validation errors containing exact field paths and configured names.

- [ ] **Step 1: Implement flow asset helpers**

```js
function flowNodes(flow) {
  if (Array.isArray(flow?.machine?.nodes)) return flow.machine.nodes;
  if (Array.isArray(flow?.machine?.config?.nodes)) return flow.machine.config.nodes;
  return Array.isArray(flow?.nodes) ? flow.nodes : [];
}

function hasCollectedAssetValue(value) {
  if (typeof value === "string") return Boolean(value.trim());
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "boolean";
}
```

- [ ] **Step 2: Reject unknown patch keys**

Within `validateFlowDecision`, collect the exact configured field names across all flow nodes. For every patch key outside that set, add:

```js
{
  type: "semantic",
  path: `flowDecision.collectedDataPatch.${field}`,
  message: `collectedDataPatch field '${field}' is not configured; allowed fields: 年龄`
}
```

- [ ] **Step 3: Reject completion with missing current-node fields**

When `nodeCompleted === true`, resolve the server current node from `flow.session.currentNodeId`. For each configured field on that node, accept a value from either `flow.session.collectedData` or the current patch; otherwise add a semantic error naming the missing field.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/agent-response-gateway.test.js`

Expected: PASS.

### Task 4: Targeted Retry Contract

**Files:**
- Modify: `tests/agent-response-gateway.test.js`

**Interfaces:**
- Consumes: `validateAndRetryAgentResponse` with the existing validation callbacks.
- Produces: one targeted retry that corrects `age` to `年龄`.

- [ ] **Step 1: Add the retry test**

First invocation returns `{ collectedDataPatch: { age: 17 } }`; second returns `{ collectedDataPatch: { 年龄: 17 } }`. Assert:

- exactly two calls occur;
- the second request contains `validationRetry: true`;
- the retry message contains both `age` and `年龄`;
- `onValidationFailure` receives the semantic field error;
- the final result is valid with `collectedDataPatch.年龄 === 17`.

- [ ] **Step 2: Run focused tests and verify GREEN**

Run: `node --test tests/agent-response-gateway.test.js`

Expected: PASS using the existing targeted semantic retry path.

### Task 5: Regression Verification

**Files:**
- Verify: `src/agent-response-gateway.js`
- Verify: `tests/agent-response-gateway.test.js`

- [ ] **Step 1: Run Gateway and server contract tests**

Run:

```bash
node --test \
  tests/agent-response-gateway.test.js \
  tests/agent-response-validation-options.test.js \
  tests/server-reply-contract.test.js
```

Expected: PASS.

- [ ] **Step 2: Run syntax and diff checks**

Run:

```bash
node --check src/agent-response-gateway.js
git diff --check
```

Expected: both commands exit zero.

- [ ] **Step 3: Run the full suite**

Run: `npm test`

Expected: all tests pass with zero failures.
