# Gateway Flow Asset Contract Design

## Goal

Prevent Agent flow decisions from silently losing configured customer assets or advancing a node before its configured fields have been collected.

## Validation Rules

The Agent response Gateway validates `flowDecision.collectedDataPatch` against the flow context already supplied in validation options.

1. Every patch key must exactly match a configured `collectFields` entry from the current flow. For example, `age` is invalid when the configured field is `年龄`.
2. When `nodeCompleted` is `true`, every collection field configured on the server's current node must have a usable value either in the existing session data or in the current patch.
3. Unknown keys and missing required values are semantic validation errors. They are not silently removed or renamed locally.
4. A valid response continues through the existing tag, asset, node-transition, and send pipeline unchanged.

## Retry And Failure Behavior

- A semantic asset-contract failure uses the existing targeted validation retry.
- The retry prompt includes the exact invalid path, allowed configured field names, and any missing current-node field names.
- The Agent gets one opportunity to regenerate a valid response using the existing two-attempt Gateway limit.
- Validation failures and retry outcomes continue to use the existing `agent_response_validation_failures` persistence and structured logs.
- If the second response still fails, no tags, assets, node transition, or customer-facing Agent reply from that invalid response enters the business layer; the existing fallback behavior applies.

## Scope

- Modify Gateway validation only.
- Reuse the existing `flow` validation option; add no request payload, database column, or Agent-side code.
- Do not hardcode English-to-Chinese aliases such as `age -> 年龄`, because configured asset names are administrator-defined.

## Verification

- Reject an unknown asset key and report the exact allowed field.
- Retry `age: 17` and accept a corrected `年龄: 17` response.
- Reject node completion when its configured field is absent from both existing session data and the patch.
- Accept node completion when the field already exists in session data.
- Confirm the complete test suite remains green.
