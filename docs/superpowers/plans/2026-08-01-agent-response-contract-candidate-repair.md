# Agent Response Contract Candidate Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Agent response gateway accept the unique complete business response when one raw response contains incidental JSON plus exactly one full-contract-valid JSON object, without changing any downstream behavior.

**Architecture:** Keep direct JSON parsing on the existing path. When direct parsing fails, parse every complete balanced top-level object, evaluate an isolated clone of each candidate through the existing deterministic object repairs and the complete active response contract, then accept only one unambiguous valid result. Preserve fail-closed behavior for malformed, incomplete, or multiple different valid responses and preserve the existing Agent retry path when local selection cannot decide safely.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`

## Global Constraints

- Modify only `src/agent-response-gateway.js` and `tests/agent-response-gateway.test.js`.
- Do not change Agent prompts, Agent workspace code, DClaw session identity, transport behavior, or the two-attempt retry limit.
- Do not change flow, tag, asset, persistence, WorkTool send semantics, public response contracts, or database schema.
- A candidate is acceptable only after the same active reply, flow, tag audit, tag evidence, tag decision, attachment, asset, and disclosure checks used for a directly parsed response.
- Candidate object repair must run on an isolated clone; repairs from rejected candidates must not appear in the accepted result.
- Never select by size, position, Markdown fence, or heuristic confidence.
- Malformed or incomplete trailing JSON must continue to reject the whole response.
- Multiple different full-contract-valid responses must continue to fail closed.
- Record unique contract-aware extraction as `{ type: "single_contract_valid_json_extracted", candidateCount, validCandidateCount }`.
- Preserve the existing `single_embedded_json_extracted` and `duplicate_json_objects_collapsed` repair actions for their current unambiguous cases.

---

### Task 1: Specify Contract-Aware Candidate Selection

**Files:**
- Modify: `tests/agent-response-gateway.test.js:686-752`
- Test: `tests/agent-response-gateway.test.js`

**Interfaces:**
- Consumes: `validateAgentResponseText(rawText, validationOptions)` and `validateAndRetryAgentResponse({ request, invoke, validationOptions, onLocalRepair })`.
- Produces: executable acceptance and fail-closed requirements for the existing public Gateway functions; no new exported API.

- [ ] **Step 1: Add the recorded-shape failing test**

Add this test after `gateway extracts one complete JSON object from surrounding prose without another Agent call`:

```js
test("gateway selects the only full-contract-valid JSON candidate without another Agent call", async () => {
  const flow = {
    machine: {
      nodes: [
        { id: "node_1", collectFields: ["年龄"] },
        { id: "node_2", collectFields: [] }
      ]
    },
    session: { currentNodeId: "node_1", collectedData: {} }
  };
  const businessReply = {
    ...structuredClone(validAuditedReply),
    flowDecision: {
      currentNodeId: "node_1",
      nextNodeId: "node_2",
      nodeCompleted: true,
      confidence: 0.9,
      reason: "年龄已收集",
      collectedDataPatch: { "年龄": "20" }
    }
  };
  const rawReply = [
    "I will process the age first.",
    '{"年龄":"20"}',
    "```json",
    JSON.stringify(businessReply),
    "```",
    "Completed."
  ].join("\n");
  const localRepairs = [];
  let calls = 0;

  const result = await validateAndRetryAgentResponse({
    request: { message: "客户：20" },
    validationOptions: {
      requireFlowDecision: true,
      requireReplyContent: true,
      allowTagDecision: true,
      flow,
      tagContext: auditedTagContext,
      tagEvidenceCandidates: auditedTagEvidenceCandidates
    },
    invoke: async () => {
      calls += 1;
      return { reply: rawReply, response: { calls } };
    },
    onLocalRepair: (repair) => localRepairs.push(repair)
  });

  assert.equal(result.valid, true);
  assert.equal(calls, 1);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.agentReply.reply, businessReply.reply);
  assert.deepEqual(result.agentReply.flowDecision, businessReply.flowDecision);
  assert.deepEqual(result.validation.repairs[0], {
    type: "single_contract_valid_json_extracted",
    candidateCount: 2,
    validCandidateCount: 1
  });
  assert.equal(localRepairs.length, 1);
  assert.equal(localRepairs[0].errors[0].type, "json_syntax");
});
```

- [ ] **Step 2: Add candidate isolation and active-contract rejection tests**

Add these tests beside the recorded-shape test:

```js
test("gateway keeps rejected candidate repairs out of the accepted candidate", () => {
  const repairableButInvalid = {
    ...structuredClone(validAuditedReply),
    reply: 20,
    tagDecision: { add: [], remove: [] }
  };
  const result = validateAgentResponseText([
    JSON.stringify(repairableButInvalid),
    JSON.stringify(validAuditedReply)
  ].join("\n"), {
    allowTagDecision: true,
    tagContext: auditedTagContext,
    tagEvidenceCandidates: auditedTagEvidenceCandidates
  });

  assert.equal(result.valid, true);
  assert.equal(result.agentReply.reply, validAuditedReply.reply);
  assert.deepEqual(result.agentReply.raw, validAuditedReply);
  assert.deepEqual(result.repairs, [{
    type: "single_contract_valid_json_extracted",
    candidateCount: 2,
    validCandidateCount: 1
  }]);
});

test("gateway rejects extracted candidates when none satisfies the active contract", () => {
  const result = validateAgentResponseText([
    '{"年龄":"20"}',
    '{"reply":"缺少流程决策","attachments":[],"sources":[]}'
  ].join("\n"), {
    requireFlowDecision: true,
    requireReplyContent: true
  });

  assert.equal(result.valid, false);
  assert.equal(result.repairs.length, 0);
  assert.equal(result.errors[0].type, "json_syntax");
});
```

The first test intentionally gives the rejected candidate a repairable missing tag add plus an unrecoverable `reply` type error. The accepted candidate must not inherit the rejected candidate's `missing_tag_decision_add_derived` repair.

- [ ] **Step 3: Strengthen existing ambiguity and incomplete-document assertions**

Keep the existing tests for two different valid objects, duplicate valid objects, truncated JSON, and closed malformed JSON. Add these assertions:

```js
assert.equal(result.repairs.length, 0);
```

to `gateway does not choose between different complete JSON objects`, and retain exact `duplicate_json_objects_collapsed` metadata for identical objects.

- [ ] **Step 4: Run focused tests and verify the new behavior fails before implementation**

Run:

```bash
node --test tests/agent-response-gateway.test.js
```

Expected: the new unique-contract-candidate and candidate-isolation tests fail because the current `repairJsonDocument()` rejects all different complete objects. Existing tests remain green.

- [ ] **Step 5: Commit the failing contract tests**

```bash
git add tests/agent-response-gateway.test.js
git commit -m "test: specify contract-aware response candidate repair"
```

### Task 2: Implement Isolated Contract-Aware Candidate Evaluation

**Files:**
- Modify: `src/agent-response-gateway.js:17-90`
- Modify: `src/agent-response-gateway.js:265-295`
- Test: `tests/agent-response-gateway.test.js`

**Interfaces:**
- Consumes: existing private functions `validateResponseObject(parsed, validationOptions)`, `repairResponseObject(parsed, validationOptions)`, `extractCompleteJsonObjects(text)`, and `isDeepStrictEqual(left, right)`.
- Produces: private `evaluateResponseCandidate(parsed, validationOptions) -> { parsed, originalErrors, repairs, errors }` and an expanded private `repairJsonDocument(text, validationOptions) -> null | { text, evaluation, repair }`.

- [ ] **Step 1: Extract one isolated candidate evaluator**

Add this helper immediately before `repairJsonDocument`:

```js
function evaluateResponseCandidate(parsed, validationOptions) {
  const candidate = structuredClone(parsed);
  const originalErrors = validateResponseObject(candidate, validationOptions);
  const repairs = repairResponseObject(candidate, validationOptions);
  const errors = validateResponseObject(candidate, validationOptions);
  return {
    parsed: candidate,
    originalErrors,
    repairs,
    errors
  };
}
```

Use this helper for both direct JSON documents and extracted candidates so contract behavior cannot diverge.

- [ ] **Step 2: Make document repair contract-aware and fail closed**

Replace `repairJsonDocument(text)` with this implementation:

```js
function repairJsonDocument(text, validationOptions) {
  const extracted = extractCompleteJsonObjects(text);
  if (extracted.incomplete || !extracted.candidates.length) return null;

  const parsedCandidates = [];
  for (const candidateText of extracted.candidates) {
    try {
      parsedCandidates.push({
        text: candidateText,
        parsed: JSON.parse(candidateText)
      });
    } catch {
      return null;
    }
  }

  const distinctCandidates = [];
  for (const candidate of parsedCandidates) {
    if (!distinctCandidates.some((existing) =>
      isDeepStrictEqual(existing.parsed, candidate.parsed)
    )) {
      distinctCandidates.push(candidate);
    }
  }

  const evaluated = distinctCandidates.map((candidate) => ({
    ...candidate,
    evaluation: evaluateResponseCandidate(candidate.parsed, validationOptions)
  }));
  const passing = evaluated.filter((candidate) => !candidate.evaluation.errors.length);
  const distinctPassing = [];
  for (const candidate of passing) {
    if (!distinctPassing.some((existing) =>
      isDeepStrictEqual(existing.evaluation.parsed, candidate.evaluation.parsed)
    )) {
      distinctPassing.push(candidate);
    }
  }
  if (distinctPassing.length !== 1) return null;

  const selected = distinctPassing[0];
  if (parsedCandidates.length === 1) {
    return {
      text: selected.text,
      evaluation: selected.evaluation,
      repair: { type: "single_embedded_json_extracted" }
    };
  }
  if (distinctCandidates.length === 1 || passing.length > 1) {
    return {
      text: selected.text,
      evaluation: selected.evaluation,
      repair: {
        type: "duplicate_json_objects_collapsed",
        count: distinctCandidates.length === 1
          ? parsedCandidates.length
          : passing.length
      }
    };
  }
  return {
    text: selected.text,
    evaluation: selected.evaluation,
    repair: {
      type: "single_contract_valid_json_extracted",
      candidateCount: distinctCandidates.length,
      validCandidateCount: passing.length
    }
  };
}
```

This keeps malformed/incomplete output unsafe, deduplicates equivalent source candidates, validates every distinct candidate after isolated object repair, and rejects zero or multiple distinct passing results.

- [ ] **Step 3: Route direct parse and extracted parse through the same evaluator**

Construct `validationOptions` before direct parsing. Replace the current parse-then-shared-mutation section with this control flow:

```js
const validationOptions = {
  requireFlowDecision,
  requireReplyContent,
  forbidGroupContextDisclosure,
  allowTagDecision,
  flow,
  tagContext,
  tagEvidenceCandidates
};
let evaluation;
let normalizedText = text;
let originalErrors = [];

try {
  evaluation = evaluateResponseCandidate(JSON.parse(text), validationOptions);
} catch (error) {
  originalErrors = [jsonSyntaxError(text, error)];
  const repairedDocument = repairJsonDocument(text, validationOptions);
  if (!repairedDocument) {
    return invalidResult(raw, text, normalizations, repairs, originalErrors);
  }
  evaluation = repairedDocument.evaluation;
  normalizedText = repairedDocument.text;
  repairs.push(repairedDocument.repair);
}

originalErrors = [...originalErrors, ...evaluation.originalErrors];
repairs.push(...evaluation.repairs);
if (evaluation.errors.length) {
  return invalidResult(
    raw,
    normalizedText,
    normalizations,
    repairs,
    evaluation.errors,
    originalErrors
  );
}
const parsed = evaluation.parsed;
```

Leave reply normalization and `agentReply` construction unchanged below this block.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test tests/agent-response-gateway.test.js
```

Expected: all Gateway tests pass. The recorded-shape test reports one Agent call and `single_contract_valid_json_extracted`; ambiguity, malformed trailing JSON, and incomplete trailing JSON remain invalid.

- [ ] **Step 5: Run syntax and diff checks**

```bash
node --check src/agent-response-gateway.js
git diff --check
```

Expected: both commands exit with status `0` and no output.

- [ ] **Step 6: Commit the implementation**

```bash
git add src/agent-response-gateway.js
git commit -m "Fix contract-aware Agent response extraction"
```

### Task 3: Verify Gateway and Repository Regressions

**Files:**
- Verify: `src/agent-response-gateway.js`
- Verify: `tests/agent-response-gateway.test.js`

**Interfaces:**
- Consumes: the completed private candidate evaluator and contract-aware document repair from Task 2.
- Produces: verification evidence that the Gateway-only change preserves repository behavior.

- [ ] **Step 1: Re-run the focused Gateway suite from a clean process**

```bash
node --test tests/agent-response-gateway.test.js
```

Expected: all tests pass with zero failures, including the original extraction, duplicate-collapse, ambiguity, malformed, and truncated-document cases.

- [ ] **Step 2: Run the full repository test suite**

```bash
npm test
```

Expected: all repository tests pass with zero failures.

- [ ] **Step 3: Confirm scope and inspect the final patch**

```bash
git status --short
git diff HEAD~2 -- src/agent-response-gateway.js tests/agent-response-gateway.test.js
git diff --check HEAD~2..HEAD
```

Expected: the feature commits contain only `src/agent-response-gateway.js` and `tests/agent-response-gateway.test.js`; the final diff has no whitespace errors and no changes to Agent, DClaw, database, flow, tag, asset, or send modules.

If unrelated user changes appear in `git status --short`, leave them untouched and exclude them from all feature commits.
