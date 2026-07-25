# Bounded Agent Context and Local Date Tags Design

## Goal

Prevent oversized DClaw Agent requests from blocking customer replies and AI tag persistence by removing AI tag decisions and unbounded historical context from the Agent request.

## Confirmed Requirements

1. The service must not ask the Agent to make tag decisions during the normal customer reply flow.
2. The first persisted customer message must receive its date tag locally from the server timestamp, without an Agent call.
3. Historical conversation content must not be sent to DClaw. This includes legacy history, recent messages, and any `history_context` structure.
4. Agent request content must be bounded. Dynamic fields such as the current message, flow node fields, and configured rules must have explicit limits.
5. A DClaw `message is too long` error must be recorded and immediately use the configured fallback reply. The service must not append a retry prompt and make the oversized request larger.
6. Manual tag operations from the console remain available.

## Architecture

The normal inbound path will have two independent responsibilities:

```text
WorkTool inbound callback
  -> persist inbound message
  -> apply local first-seen date tag
  -> build bounded Agent request with current message and compact current flow state
  -> invoke Agent for customer reply only
  -> send reply or configured fallback
```

Tag schema and `tagDecision` will be removed from the normal Agent request and response contract. The service will continue to use its local tag schema for manual operations and date-tag creation.

The request payload will not contain `legacyHistory`, `recentMessages`, or `history_context`. The Agent will receive only the current WorkTool event and bounded fields needed for the active flow node. The service will preserve the database conversation history for the UI and diagnostics, but it will not forward that history to DClaw.

## Error Handling

- DClaw request-size failures remain visible in `agent_response_validation_failures` and `agent_invocations`.
- The normal fallback path sends the configured fallback reply and records the failure.
- No format-retry request is made for a request-size failure.
- No tag failure is reported because AI tag evaluation is no longer part of this Agent call.

## Compatibility

- Existing manual tag APIs and UI behavior remain unchanged.
- Existing date tags remain stored as conversation tags.
- Existing flow decisions continue to be returned only when a flow is active, but the flow payload is compacted to bounded current-state data.
- Existing conversation and incoming-message database records remain available for UI display and diagnostics.

## Verification

Tests must verify that:

- The outbound Agent request omits tag rules, tag decision instructions, legacy history, recent messages, and `history_context`.
- The request remains bounded when the stored conversation contains a large number of messages.
- The first inbound persisted message creates a local date tag without invoking Agent tag logic.
- An oversized DClaw request records the error and sends the configured fallback.
- Manual tag operations continue to work.
