# Dynamic Legacy Asset Backfill Design

## Goal

Let the first bounded legacy-history analysis collect customer assets from all
fields currently configured across an Agent's task nodes, while preserving
normal current-node state-machine behavior.

## Confirmed Requirements

1. Asset names are never hardcoded.
2. The authoritative field set is the deduplicated union of
   `machine.config.nodes[].collectFields` for the selected Agent.
3. Legacy-history analysis receives that complete dynamic field set even when a
   field does not belong to the current node.
4. Node completion and transition decisions still use only the current node.
5. The server accepts only asset keys present in the current task
   configuration.
6. Legacy backfill fills empty values only and never overwrites a non-empty
   collected value.
7. Sessions analyzed by the old request shape become eligible for one safe
   reanalysis on their next valid private message.
8. Normal tags retain the existing idempotency, exclusivity, and one-way-change
   rules.
9. No Agent workspace or Agent skill changes are required.

## Root Cause

The asset panel builds its field list from every task node, but
`compactFlowForAgent` currently sends only `flow.currentNode.collectFields`.
For a legacy session initialized at a later node, historical facts such as a
phone number can therefore be visible in the history block while the Agent is
not told that `手机` is a writable asset key.

## Design

Create a small shared flow-assets module that derives the dynamic field union
and filters an Agent patch against it. Both DClaw request construction and
server-side persistence use this module.

During bounded legacy analysis, the compact flow payload adds:

```json
{
  "collectibleFields": ["姓名", "地区", "手机"],
  "session": {
    "collectedData": {
      "姓名": "已有值"
    }
  }
}
```

The prompt tells the Agent to extract explicit historical facts into
`flowDecision.collectedDataPatch`, using only `collectibleFields`. The current
node remains the sole authority for `nodeCompleted` and `nextNodeId`.

Before persistence, the server filters the patch to the latest configured field
union. When legacy history is being analyzed, it also removes keys whose
session value is already non-empty.

## One-Time Reanalysis

The service stores one rollout timestamp in `app_settings`. A legacy session is
eligible for historical analysis when:

- it has never completed historical analysis; or
- its `history_context_sent_at` predates the rollout timestamp.

After successful decision processing, the existing
`markLegacyHistoryContextSent` timestamp moves past the rollout timestamp, so
the session is not reanalyzed on later messages. A future request-shape upgrade
uses a new versioned setting key.

## Error And Size Boundaries

- Empty or invalid Agent asset values are ignored.
- Unknown fields are rejected before database merge.
- Existing non-empty values are preserved during legacy backfill.
- All configured field names are included; the existing hard request-size
  guard fails deterministically if a pathological task configuration cannot
  fit, rather than silently dropping fields.

## Verification

Tests must prove:

1. Fields distributed across multiple nodes are deduplicated and all appear in
   a legacy request.
2. Normal requests do not gain the legacy all-node field payload.
3. Unknown patch keys are rejected.
4. Legacy backfill fills empty fields and preserves non-empty fields.
5. A pre-rollout legacy session is analyzed once after upgrade.
6. Current-node transition behavior remains unchanged.
7. Existing tag, history, flow, and request-size tests continue to pass.
