# Agent Response Contract Candidate Repair Design

## Objective

Extend the existing Agent response gateway so it can deterministically recover a single complete business response from output that contains prose or incidental JSON fragments. The change must remain inside the gateway boundary and must not alter reply, flow, tag, asset, persistence, or send behavior after validation.

## Problem

The gateway currently repairs a response when it contains one complete JSON object, or several identical complete JSON objects. It rejects every response containing multiple different complete JSON objects before checking whether only one of them satisfies the full business contract.

An observed response contained:

- an incidental object such as `{"age":"20"}` in explanatory prose; and
- one complete response object containing `reply`, `flowDecision`, `tagEvaluation`, and `tagDecision`.

The complete response was usable, but both the first call and the retry were rejected as JSON syntax failures. The retry also reused the stateful DClaw conversation, causing the Agent to treat the repeated message as a duplicate and emit more conflicting output. A fallback reply was sent even though the first response contained one unambiguous contract-valid result.

## Scope

This design changes only local response normalization, candidate extraction, candidate validation, repair reporting, and their tests in the gateway.

It does not change:

- Agent prompts or Agent workspace code;
- DClaw session identities or retry transport behavior;
- the two-attempt retry limit;
- response contract definitions;
- flow, tag, asset, database, or WorkTool send semantics.

## Repair Pipeline

### 1. Lossless normalization

Continue applying safe, idempotent text normalization before parsing, including trimming and removing a JSON Markdown fence only when it encloses the entire response.

### 2. Direct parse

Attempt to parse the normalized response as one JSON document. A directly parsed response continues through the existing object repair and contract validation path unchanged.

### 3. Document candidate extraction

When direct parsing fails, extract complete top-level JSON object candidates from the same normalized source text. Extraction strategies produce candidates; they do not mutate one another's output.

The initial implementation uses the existing balanced-object extractor. Candidate strings are parsed independently and deduplicated by deep equality.

The presence of malformed or incomplete trailing JSON remains unsafe and must prevent local acceptance.

### 4. Contract-aware candidate evaluation

Evaluate every syntactically valid, distinct candidate using the same object repair and complete contract validation applied to a directly parsed response.

Candidate selection rules:

1. If exactly one distinct candidate passes the complete contract, accept it.
2. If multiple passing candidates are deeply equal, collapse and accept them.
3. If multiple different candidates pass, reject the response.
4. If no candidate passes, reject the response.
5. Never select a candidate using size, position, fence presence, or heuristic confidence alone.

Object repair must operate on an isolated clone of each candidate so evaluation of one candidate cannot affect another.

### 5. Retry

Only responses with no uniquely acceptable local candidate proceed to the existing Agent retry behavior. Retry isolation for stateful DClaw conversations is a separate concern and is not part of this change.

## Validation Safety

Local extraction never bypasses the existing response contract. An extracted candidate must still satisfy all options active for that invocation, including:

- required reply content;
- flow decision and configured transition constraints;
- complete tag evaluation and authorized tag evidence;
- tag decision rules;
- attachment and asset constraints;
- group-context disclosure restrictions.

When candidate selection is ambiguous, the gateway must fail closed.

## Observability

Accepted contract-aware extraction records a repair action:

```json
{
  "type": "single_contract_valid_json_extracted",
  "candidateCount": 2,
  "validCandidateCount": 1
}
```

Equivalent duplicate passing candidates may retain the existing `duplicate_json_objects_collapsed` action. Existing local-repair callbacks persist the original response, original parse error, and applied repair actions; no database schema change is required.

Rejected responses continue to be recorded in `agent_response_validation_failures` with the untouched raw response.

## Testing

Add focused gateway tests covering:

1. Incidental JSON plus one complete contract-valid response is accepted locally with one Agent call.
2. One valid response surrounded by prose remains accepted.
3. Two different contract-valid responses remain rejected.
4. Multiple identical valid responses remain collapsed.
5. One contract-valid response followed by incomplete JSON remains rejected.
6. Candidate-level object repairs are isolated and do not mutate sibling candidates.
7. The accepted candidate still fails when its flow, tag evidence, reply, or other active contract requirement is invalid.
8. Repair metadata reports candidate and valid-candidate counts.

Run the focused gateway tests and the full repository test suite before completion.

## Success Criteria

- The recorded `魔兮13` response shape is accepted from its first Agent response without a retry.
- The incidental age object is rejected as an incomplete business response.
- Ambiguous valid responses still fail closed.
- No downstream business behavior or API contract changes.
- Existing validation failure and local repair records remain queryable.
