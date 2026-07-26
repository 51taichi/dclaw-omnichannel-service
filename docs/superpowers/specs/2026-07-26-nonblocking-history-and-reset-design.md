# Nonblocking History Intelligence And Conversation Reset Design

## Goal

Keep customer-facing operations responsive when DClaw is slow:

1. A legacy customer's first live message receives a normal Agent reply without
   waiting for historical tag and asset analysis.
2. Deleting a conversation removes local state immediately without making the
   browser wait for DClaw cleanup.
3. Slow or failed background work remains observable and retryable without
   clearing a newly-created conversation.

## Confirmed Evidence

The reproduced legacy request spent 481 ms importing 226 history messages and
10 seconds in the configured reply quiet window. DClaw then spent 242.8 seconds:
one 120-second timeout, one 103-second response that violated the JSON contract,
and a 20-second format repair.

The reproduced conversation deletion removed local state first, then waited for
two sequential 20-second DClaw cleanup calls. Both timed out, so the browser
waited 40 seconds. A stale administrator session then caused the post-delete
refresh to return 401, making a successful local deletion look like a failed
delete.

## Legacy First-Message Flow

History import remains synchronous because it is bounded by the WorkTool
history client's eight-second total timeout and normally completes in under one
second. Import must finish before the live flow session is classified and the
legacy add-date tag is calculated.

The imported history is not included in the customer-facing Agent request. The
live request contains the current message, current flow node, tag rules, and
current-message evidence only. It follows the normal reply, validation, send,
flow, and activation path.

After a successful customer reply, the service schedules a background legacy
analysis for the same flow session. The background request:

- uses a dedicated DClaw session suffix so it cannot mutate or block the live
  conversation session;
- contains the bounded customer-authored history, current configured tag rules,
  current tags, and the dynamic union of all configured flow asset fields;
- requests an empty customer reply plus `tagDecision` and
  `flowDecision.collectedDataPatch`;
- never sends a WorkTool message and never advances the flow node;
- applies tags through existing exclusivity, one-way, idempotency, evidence,
  activation, and alert rules;
- fills only missing configured asset values;
- marks history analysis complete only after valid decisions are committed.

Only one background analysis may run per conversation in one process. Database
state remains the durable retry marker: if analysis does not complete, the next
valid private customer message schedules it again. Process restart therefore
does not lose the work permanently.

## Conversation Reset Flow

The local reset transaction remains authoritative for the console operation. It
deletes messages, tags, flow state, and the visible conversation, cancels
pending tasks, and records a durable DClaw cleanup task. The HTTP route returns
success immediately after this transaction.

A background worker claims cleanup tasks and performs the existing ordered
operations:

1. delete the Agent workspace conversation record;
2. clear DClaw conversation memory.

Each operation retains the current 20-second timeout. Failed tasks store the
error and retry with bounded backoff. Success and failure are logged with task
id, attempt, Bot, Agent, conversation key, and duration.

## Reset And New-Message Ordering

The cleanup task represents the old conversation generation. A new private
message checks for unfinished cleanup before invoking DClaw:

- if an attempt is currently running, the message waits only for that attempt
  to settle;
- once new customer activity exists, future cleanup retries for the old
  generation are canceled;
- the newly-created conversation is marked `reset_pending`, so its first live
  request instructs the Agent to ignore and rebuild stale short-term context;
- after the first valid Agent response, `reset_pending` is cleared.

This prevents a delayed retry from deleting a new conversation while avoiding a
permanent block when DClaw cleanup is unavailable.

## Console Behavior

The delete action treats the reset POST as the completion boundary. It clears
the selected conversation and reports success before refreshing lists.

The follow-up refresh runs separately. A 401 transitions the console to the
existing signed-out state and asks the operator to sign in again; it does not
rewrite the already-completed deletion as a deletion failure.

## Error Boundaries

- History import failure: reply normally; do not schedule historical analysis.
- Live Agent failure: use the existing fallback path; do not mark historical
  analysis complete.
- Background history failure: log and retry on the next private message.
- Background reset failure: persist retry state and error.
- New activity after reset failure: cancel future old-generation retries and
  use `reset_pending` on the new live request.
- Service restart: pending reset tasks are claimable again; history analysis is
  retried because its completion timestamp remains unset.

## Verification

Tests must prove:

1. A legacy live request does not contain imported history.
2. A successful live reply schedules background analysis after sending.
3. Background analysis uses an isolated DClaw session and sends no WorkTool
   reply.
4. Background results apply idempotent tags and fill-only-missing dynamic
   assets without advancing the flow node.
5. Failed analysis remains eligible on the next private message.
6. The reset route returns after local deletion and task creation without
   awaiting DClaw.
7. Reset tasks survive restart, retry failures, and complete in workspace-then-
   memory order.
8. New activity prevents later cleanup retries and receives
   `conversationReset=true`.
9. A post-delete refresh failure does not report the deletion itself as failed.
10. Existing new-friend, activation, tag alert, handoff, group, and proactive
    behavior remains unchanged.
