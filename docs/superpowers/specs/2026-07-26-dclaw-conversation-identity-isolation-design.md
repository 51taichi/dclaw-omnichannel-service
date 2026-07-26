# DClaw Conversation Identity Isolation Design

## Problem

WorkTool currently sends Chinese customer names and raw conversation keys as
`external_user_id` and `external_session_id`.

DClaw normalizes those fields to `[A-Za-z0-9_.:-]`. A Chinese private customer
such as `魔兮` becomes `anonymous`, while
`<bot-id>:private:魔兮` becomes `<bot-id>:private`. As a result, Chinese
customers under the same Bot can share one DClaw runtime session.

This causes cross-customer runtime context growth, slow resets, 120-second
timeouts, malformed runtime output, and failed tag or asset analysis.

## Goals

- Give every WorkTool conversation an ASCII-only, non-colliding DClaw identity.
- Keep one DClaw context throughout one local conversation epoch.
- Rotate the DClaw context immediately when the local conversation is reset.
- Isolate background history analysis and maintenance work from live replies.
- Preserve raw Bot, customer, and conversation values in server state and
  request metadata.
- Require no Agent or DClaw changes.

## Identity Model

A single helper derives three identifiers:

- `externalUserId`: stable hash of the Bot-scoped local conversation key.
- `runtimeConversationId`: stable hash of the local conversation key and
  `conversation_epoch`.
- `externalSessionId`: stable hash of the local conversation key,
  `conversation_epoch`, and invocation purpose.

All generated identifiers use short ASCII prefixes and lowercase hexadecimal
digests. They contain no customer PII and remain below DClaw's 128-character
limit.

The invocation purpose is:

- `conversation` for live replies, handoff transcript sync, proactive events,
  flow activation, and tag activation.
- `legacy-history-analysis` for background historical tag and asset analysis.
- `conversation-reset` for maintenance cleanup.

The Agent-facing `worktoolMessage.conversationId` uses
`runtimeConversationId`. The raw local conversation key remains available as
`metadata.localConversationId`.

## Reset Ordering

`conversation_reset_tasks` stores the epoch that existed when deletion began.
The reset worker uses that old epoch for workspace cleanup and memory clearing.

New inbound activity never waits for an old reset attempt. It creates or loads
the current local conversation epoch and therefore receives a different
runtime conversation ID. An old reset can only operate on the old runtime
conversation and cannot delete or block the new one.

Reset completion may clear `reset_pending` only when the stored task epoch still
matches the current conversation epoch.

## Integration Coverage

The shared identity helper is used by:

- normal private and group Agent requests;
- background legacy history analysis;
- human handoff transcript sync;
- proactive outbound transcript sync;
- flow activation polishing;
- tag activation polishing;
- workspace reset and memory clear requests.

Format and attachment retries preserve the original generated identifiers.

## Timeout Configuration

The test environment currently overrides the repository default with
`DCLAW_AGENT_TIMEOUT_MS=120000`. After deployment it must be restored to
`25000`, while keeping `DCLAW_AGENT_MAX_ATTEMPTS=2` and
`DCLAW_AGENT_FORMAT_RETRY_TIMEOUT_MS=30000`.

The identity fix addresses the root cause. The timeout change provides a
bounded fallback if DClaw is independently unhealthy.

## Compatibility

Existing local conversations, messages, tags, assets, and flow state are not
deleted or migrated. The first Agent call after deployment starts one new,
correctly isolated DClaw runtime context for the existing local epoch.

Old incorrectly shared DClaw runtime sessions become unreachable and may be
left for DClaw retention cleanup. This avoids any risk of sending a cleanup
operation to a session shared by multiple historical customers.

## Tests

Tests must prove:

- Chinese customer names never produce `anonymous` or truncated session IDs.
- different Chinese customers produce different identities;
- the same conversation and epoch produce stable identities;
- a changed epoch produces a new runtime and external session ID;
- live, handoff, proactive, flow activation, and tag activation calls share the
  conversation-purpose identity;
- history analysis and reset calls use isolated purpose sessions;
- a reset task retains its original epoch;
- new customer activity does not wait for an old reset worker attempt;
- all existing server and DClaw request tests continue to pass.
