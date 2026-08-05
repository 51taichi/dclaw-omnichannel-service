# Private Conversation Without Flow Design

## Problem

Private customer messages are persisted and can be answered by the Agent even when the bound Agent has no enabled task state machine. However, the console conversation tab reads from `flow_sessions`, and the inbound persistence path currently creates a private flow session only when a task state machine is enabled. This makes successfully handled private conversations invisible in the console.

## Behavior

- Every inbound private conversation for an enabled Bot must have a `flow_sessions` row.
- When the bound Agent has an enabled task state machine, keep creating the normal task flow session at its entry node.
- When no enabled task state machine exists, create a generic conversation session whose node is `__conversation__`.
- Existing generic sessions continue to upgrade through the existing `getOrCreateFlowSession` behavior when a task state machine is later enabled.
- Group conversation behavior remains unchanged.

## Reply Safety Boundary

The change must not modify Agent invocation eligibility, inbound coalescing, DClaw invocation, response validation, outbound sending, tags, assets, or flow progression. Conversation indexing remains part of the existing inbound persistence step, before the unchanged Agent reply path.

## Implementation

In `persistInboundConversation`, preserve the current normal flow branch for private messages with an enabled state machine. Route groups and private messages without an enabled state machine through `getOrCreateConversationSession`.

## Verification

- Add a source-boundary regression test proving that private messages without an enabled state machine use the generic conversation-session path.
- Prove the test fails against the old condition.
- Run the focused test, relevant conversation tests, syntax checks, and the complete test suite.
- Before committing, inspect the latest shared-worktree diff and stage only files belonging to this fix.
