# Single-Call Agent Tag Audit Design

## Goal

Make Agent-driven customer tagging reliable, auditable, and compatible with the
existing reply, flow, asset, alert, and DClaw conversation-isolation behavior.
Each inbound customer batch must still use one normal Agent call. A second call
is allowed only through the existing response-repair path when the Agent violates
the response contract.

## Problem

The current request includes `tagRules`, but tagging is expressed as a weak
secondary instruction after reply, flow, knowledge, and resource instructions.
The response gateway accepts `{"add":[],"remove":[]}` without proving that the
Agent evaluated each enabled tag.

This caused two confirmed false negatives:

- “我咨询一个问题，你们可以保证我的小孩提升多少分吗”
- “不好意思我问题多，我再咨询下，如果请假会扣钱吗”

Both requests contained the B-class rule, both received successful customer
replies, and both returned an empty `tagDecision`. No tag event or voice alert
could be created.

The voice-alert stream also reconnects forever after a stale Bot session receives
HTTP 401, leaving the page looking unlocked while live alerts are unavailable.

## Constraints

- Do not add a permanent second Agent call.
- Do not change the conversation identity, lifecycle, cleanup, or queue behavior
  introduced by commit `9d24511`.
- Do not require Agent workspace changes.
- Keep legacy-history input bounded by the existing configurable limit.
- Preserve server ownership of exclusivity, one-way changes, and manual overrides.
- Preserve the existing response-repair and validation-failure recording behavior.

## Request Contract

When `tagRules` are present, the request message starts with a high-priority tag
audit block before reply, flow, knowledge, and resource instructions.

The audit block states:

1. Administrator tag conditions are binding business rules.
2. The Agent must evaluate every enabled tag exactly once.
3. The Agent must not raise the threshold or substitute its own lead-scoring
   definition.
4. The Agent must complete tag evaluation before composing the customer reply.
5. An empty decision is valid only after every tag has a recorded negative
   evaluation.

Normal inbound requests include only the current coalesced customer-message
evidence. Legacy analysis continues to use customer-only history and the
configured character limit. Historical evidence is rendered as bounded plain
text lines containing a stable message ID and customer text, rather than a full
conversation JSON payload:

```text
[58574] 我想问下，我缴费了，希望可以换老师
[58575] 如果请假会扣钱吗
```

The formatted evidence text, including IDs and separators, counts against the
same configured history limit. Bot replies are not included.

## Response Contract

Requests with tags require both `tagEvaluation` and `tagDecision`.

```json
{
  "reply": "发给客户的文本",
  "attachments": [],
  "sources": [],
  "flowDecision": {},
  "tagEvaluation": [
    {
      "groupId": "group_1",
      "tagId": "tag_2",
      "matched": true,
      "reason": "客户提出了请假扣费问题",
      "evidenceMessageId": "1013",
      "evidenceText": "如果请假会扣钱吗"
    }
  ],
  "tagDecision": {
    "add": [
      {
        "groupId": "group_1",
        "tagId": "tag_2",
        "reason": "客户咨询过一个问题",
        "evidenceMessageId": "1013",
        "evidenceText": "如果请假会扣钱吗"
      }
    ],
    "remove": []
  }
}
```

`tagEvaluation` is a flat list. Every enabled normal tag appears exactly once.
Matched evaluations require evidence from the supplied evidence set. Negative
evaluations keep `evidenceMessageId` and `evidenceText` empty.

For an exclusive group, multiple conditions may match. The configured tag order
represents increasing progression, so the highest matching tag is the proposed
target. For a non-exclusive group, every newly matched tag is proposed.
Already-active tags do not need another `add` entry.

## Gateway Validation

When `tagRules` are enabled, the response gateway validates:

- `tagEvaluation` and `tagDecision` are both present.
- Every enabled tag is evaluated exactly once.
- Group and tag IDs exist in the current schema.
- `matched` is Boolean.
- Positive evaluations contain an allowed evidence ID and the exact associated
  customer text.
- Negative evaluations do not claim evidence.
- Every `tagDecision.add` item has a positive evaluation.
- The expected exclusive-group winner or newly matched non-exclusive tag appears
  in `tagDecision.add`, unless it is already active or blocked by a current
  equal-or-higher one-way tag.
- Duplicate, unknown, incomplete, or inconsistent evaluations fail validation.

Contract failures use the existing format-repair call and include precise paths
and messages. This does not double normal traffic. If the repair response still
fails, the existing fallback reply and validation-failure recording remain in
effect.

The gateway validates completeness and consistency, not whether the Agent's
semantic opinion is objectively correct. Requiring explicit evaluation makes
false negatives observable and materially reduces silent omissions.

## Server Adjudication

The existing server adjudicator remains authoritative:

- Exclusive groups keep one active tag.
- One-way groups allow forward progress and reject rollback.
- Manual changes retain their existing override behavior.
- Only accepted `add` or `replace` outcomes create tag activation tasks or voice
  alerts.

The server does not trust `tagEvaluation` as a direct database mutation. It uses
the validated `tagDecision` and existing adjudication path.

## Evaluation Records

Add `agent_tag_evaluations` as an append-only audit table:

- `id`
- `invocation_id`
- `bot_id`
- `agent_id`
- `conversation_key`
- `incoming_message_id`
- `group_id`
- `tag_id`
- `matched`
- `reason`
- `evidence_message_id`
- `evidence_text`
- `decision_action`
- `created_at`

The unique key is `(invocation_id, group_id, tag_id)`. Only the final valid
response is recorded. Invalid raw responses remain in
`agent_response_validation_failures`.

Expose this table through the existing read-only logs API so an operator can
distinguish:

- not evaluated,
- evaluated and not matched,
- matched and proposed,
- proposed but rejected by server rules,
- accepted and applied.

No new console panel is required in this change.

## Voice Alert Authentication

The tag-alert client must treat HTTP 401 as an authentication-expiry event rather
than a transient stream failure:

1. Stop the reconnect loop for the stale token.
2. Remove the expired local Bot session.
3. If an administrator API key is still available, reconnect with that key.
4. Otherwise lock the Bot workspace and show the existing re-unlock requirement.
5. Reconnect the stream after a successful unlock.

Other network failures retain the bounded reconnect backoff. Audio behavior and
alert creation rules remain unchanged.

## Logging

Add structured logs for:

- successful tag-audit validation,
- tag-audit repair requested,
- tag-audit repair failed,
- persisted evaluation count and matched count,
- alert-stream authentication expiry and recovery.

Logs include Bot, Agent, conversation, and invocation IDs without duplicating the
full prompt or customer history.

## Testing

Unit and integration coverage must include:

- Prompt ordering and the mandatory audit instructions.
- Complete positive and negative `tagEvaluation` parsing.
- Missing, duplicate, unknown, and inconsistent evaluations.
- Exact evidence validation.
- C-to-B and B-to-A forward progression.
- A-to-B rollback rejection without a false alert.
- Overlapping B/A conditions choosing the highest exclusive match.
- Non-exclusive tag combinations.
- Evaluation audit-table persistence and logs API mapping.
- Normal requests completing in one Agent call.
- Contract violations using only the existing repair call.
- Legacy history using bounded customer-only evidence lines.
- HTTP 401 stopping stale alert reconnects and expiring the local session.
- Successful alert reconnection after valid authentication.
- Existing DClaw conversation identity and nonblocking reset tests remaining green.

## Rollout

Deploy the server and console together. No Agent deployment is required.

For the test environment, set:

```dotenv
DCLAW_AGENT_TIMEOUT_MS=25000
```

Then rebuild the container so the new timeout and code are both active. Validate
with one generic question that should produce B class, one fee question that
should produce A class, and one non-matching statement. Confirm the Agent
invocation, evaluation audit rows, tag events, alert rows, and live console sound
for each case before production deployment.
