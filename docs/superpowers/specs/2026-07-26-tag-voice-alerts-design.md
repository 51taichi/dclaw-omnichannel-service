# Agent Tag Decisions and Voice Alerts Design

## Goal

Restore continuous Agent-driven customer tagging for every eligible private
customer message and add a persistent, real-time voice-alert workflow for
selected tags.

When the Agent proposes a valid tag change, the service remains the final
authority for tag existence, exclusivity, one-way progression, idempotency, and
task scheduling. A newly added or replaced tag with voice alerts enabled also
creates a durable alert linked to the customer message that caused the
decision.

## Confirmed Requirements

1. Agent-driven tagging is a core system capability and must work for new
   customers, legacy customers, later messages, and private conversations
   without an active flow machine.
2. Normal AI replies continue to use one DClaw call. Tag evaluation must not add
   a second model call.
3. Private messages received during human handoff still receive Agent tag
   evaluation, but the Bot must not reply automatically.
4. Group messages do not participate in customer tagging.
5. Legacy customer history remains bounded and is sent only for the first
   eligible historical analysis. Later messages continue sending compact tag
   rules without resending history.
6. Only an Agent-proposed, service-accepted `add` or `replace` that changes the
   current tag state can create a voice alert.
7. Manual tags, date tags, rejected decisions, removals, and duplicate tags do
   not create voice alerts.
8. Voice alert state is scoped to a Bot and shared by every console connected
   to that Bot.
9. Alerts survive refreshes, reconnects, service restarts, and periods when no
   console is open.
10. Real-time delivery uses SSE plus persisted unread snapshots. Continuous
    polling is not used.
11. Clicking an alert opens the correct conversation, locates the evidence
    message, and briefly highlights why the tag was reached.
12. Multiple alert-enabled tags added by one Agent response create separate
    unread items but play the MP3 only once for that response.

## Relationship To Existing Designs

This design builds on
`2026-07-25-bounded-legacy-history-intelligence-design.md` and reuses its
implemented request budgeting, bounded historical text, tag-response schema,
response validation, tag adjudication, tag persistence, and collected-data
handling.

It supersedes the remaining conflicting parts of
`2026-07-25-bounded-agent-context-design.md`:

- compact tag rules are required for every eligible private customer message,
  not only the first bounded legacy-history analysis;
- valid Agent tag decisions are applied continuously;
- historical text remains one-time and bounded.

The implementation must extend the current code instead of recreating the
legacy-history selector, DClaw tag schema, tag adjudicator, or tag activation
worker.

## End-To-End Architecture

```text
WorkTool private customer callback
  -> persist every inbound message
  -> coalesce eligible customer text
  -> build one bounded DClaw request
       -> current customer message batch
       -> compact enabled tag rules and current tags
       -> compact active flow state, when present
       -> one-time bounded legacy history, when eligible
  -> validate Agent reply
  -> verify conversation epoch is still current
  -> adjudicate tagDecision
  -> atomically persist changed tags, tag events, tasks, and alert events
  -> apply flow decision, when present
  -> AI mode: send customer reply
  -> human handoff: do not send an automatic reply
  -> publish committed alert events to the Bot SSE channel
```

Tag persistence is not conditional on an active flow machine and is not
conditional on WorkTool successfully sending the Agent's customer reply.

## Tag Configuration

Each normal tag gains one field:

```json
{
  "voiceAlertEnabled": false
}
```

Rules:

- The default is `false`.
- The field is normalized by the server and preserved by console import and
  export.
- The special add-date tag does not expose or accept this field.
- The Tag tab renders a `语音提示` switch immediately after the tag's
  `达标条件` field.
- Existing tag configurations remain valid and behave as if the switch is off.

## DClaw Tag Contract

Every eligible private Agent request includes compact enabled tag groups,
enabled tags, conditions, and current non-date tags. The existing total request
limit remains authoritative. Tag rules must not be silently removed to make an
oversized request fit.

The one-time legacy-history request additionally includes its existing bounded
plain-text historical block. Later requests omit only that block, not the tag
rules.

`tagDecision.add` supports evidence:

```json
{
  "groupId": "intent_level",
  "tagId": "level_b",
  "reason": "客户主动询问老师水平",
  "evidenceMessageId": "WorkTool message id when available",
  "evidenceText": "你们老师的水平怎么样"
}
```

`evidenceMessageId` and `evidenceText` are optional protocol fields. The service
validates that an evidence ID belongs to the current conversation and that an
evidence text matches a persisted inbound customer message. Current coalesced
messages provide bounded evidence candidates. Legacy analysis may locate an
imported message by normalized evidence text.

If neither field resolves safely, the alert anchors to the last inbound
customer message in the current coalesced batch. Invalid evidence does not
invalidate an otherwise valid tag decision.

## Tag Decision Processing

The existing service adjudicator remains authoritative:

1. Reject missing, disabled, or unknown groups and tags.
2. Prevent Agent changes to date tags.
3. Enforce exclusive-group replacement.
4. Enforce one-way progression.
5. Preserve non-exclusive tags independently.
6. Apply only actual state changes.
7. Cancel inactive-tag tasks and schedule newly active-tag tasks.

This processing runs after the Agent response is structurally valid and after
the conversation epoch check, but before any customer reply send result can
affect tag persistence.

AI mode and human-handoff mode share the same tag-decision processor. Human
handoff requests may return tag decisions but never generate a Bot reply.

If the JSON reply is invalid as a whole, the existing repair mechanism applies.
If the customer reply is valid but an individual tag suggestion violates
business rules, the service rejects and records only that suggestion. A tag
business-rule rejection must not block the valid customer reply.

## Durable Alert Data

Add a Bot-scoped alert table with these logical fields:

- alert ID;
- source conversation-tag-event ID;
- Bot ID and Agent ID;
- conversation key and customer display name;
- tag-group ID and name snapshot;
- tag ID and name snapshot;
- decision reason;
- evidence conversation-message ID;
- evidence text snapshot;
- creation time;
- read time.

The source tag-event reference is unique. It prevents duplicate alert creation
if an Agent response or persistence step is retried.

The detailed automatic-tag persistence operation writes current tags,
conversation tag events, tag activation tasks, and eligible alert records in
one database transaction. Duplicate alert insertion uses idempotent conflict
handling. Manual and date-tag paths continue using their existing behavior and
never create alerts.

Alert insertion errors that can be safely classified as duplicate do not fail
tagging. A general database transaction failure is recorded and follows the
existing tag-persistence failure path.

## Alert APIs And SSE

Add authenticated Bot-scoped APIs for:

- opening the alert SSE stream;
- listing or receiving the current unread snapshot;
- marking one alert read.

The stream uses the console's existing `x-api-key` or
`x-bot-session-token`. The browser uses a streaming `fetch` request so secrets
are sent in headers and never in the URL.

On connection:

1. authorize access to the selected Bot;
2. register the connection in an in-process Bot subscriber registry;
3. send the complete persisted unread snapshot;
4. send a heartbeat approximately every 20 seconds;
5. publish subsequent `alert.created` and `alert.read` events.

Responses set no-cache and no-buffering headers suitable for Nginx SSE proxying.
Switching Bots, locking the Bot, aborting the request, or closing the page
releases the old subscription.

An SSE disconnect uses bounded exponential-backoff reconnection. Every
successful reconnection receives a fresh unread snapshot, which repairs any
missed live events. No interval-based polling is added.

Marking an alert read commits `read_at` and then broadcasts `alert.read` to all
connections for the same Bot. Read state is intentionally shared rather than
per-console-user.

The current deployment uses one service instance, so committed alerts are
broadcast through an in-memory subscriber registry. SQLite remains the source
of truth across restarts and disconnected clients.

## Console Interaction

The console adds a fixed bottom-right red alert button:

- hidden when no Bot is selected or accessible;
- displays the unread count;
- flashes while unread items exist;
- pauses flashing while hovered, keyboard-focused, or expanded;
- resumes flashing after pointer exit when unread items remain.

Hover, focus, or click opens an adjacent scrollable list. Each item displays:

```text
客户名称
达成「标签名称」标签
```

Opening the list does not mark alerts read. Clicking a specific item:

1. switches to the Conversation tab;
2. clears filters that would hide the target;
3. loads the conversation directly instead of depending on the current list
   page;
4. requests a bounded message window containing the evidence message;
5. renders and smoothly scrolls the evidence bubble into view;
6. displays `此消息触发「标签名」标签`;
7. applies an approximately three-second red-to-normal highlight animation;
8. marks the alert read and removes it from every connected console.

If the evidence message was deleted, the console opens the conversation at its
latest available record, explains that the original trigger message no longer
exists, and still allows the alert to be marked read.

## Audio

Ship one console asset:

```text
public/console/assets/tag-voice-alert.mp3
```

The spoken template is `您有新的客户标签提醒`.

The browser preloads the asset. The first authenticated pointer or keyboard
interaction attempts to unlock playback under browser autoplay rules. A live
SSE alert batch plays the MP3 once when it contains one or more new
alert-enabled tag events.

Unread snapshots never replay historical sounds. Playback failure leaves the
visual alert unread and records only a client-side diagnostic; it does not
change server state.

## Message Location

Alert evidence references `conversation_messages`, not transient DOM indexes.
The service adds a Bot-authorized message-context query that returns a bounded
window around an anchor message. This allows an alert to locate evidence even
when the message is older than the existing recent-message limit.

Evidence IDs and conversation keys are validated together. An alert can never
open or expose a message from another Bot or conversation.

## Error Handling

- No enabled tag groups: omit tag rules and continue normal reply processing.
- Missing `tagDecision`: send or record the normal reply without tag changes.
- Unknown or disallowed tag: reject that suggestion and record the reason.
- Duplicate tag: do not create a tag event, activation task, alert, or sound.
- Invalid evidence: use the current batch's last inbound customer message.
- Stale conversation epoch: apply neither tags nor replies.
- WorkTool send failure: preserve already validated tag changes and alerts.
- SSE broadcast failure: retain the persisted alert for reconnect snapshot.
- SSE disconnect: reconnect with backoff and replace client state from the
  unread snapshot.
- Audio blocked: preserve visual and unread behavior.
- Deleted conversation: reject cross-resource navigation without exposing data.
- Deleted evidence message: open the conversation at the latest message and
  show a nonfatal explanation.
- Oversized DClaw request: record the deterministic size error and use the
  existing fallback behavior; never silently remove tag rules.

## Verification

Automated tests must prove:

1. Normal new-customer and later private messages include compact tag rules.
2. The first legacy analysis includes bounded history plus tag rules, while
   later legacy messages include tag rules without history.
3. Private conversations without a flow machine apply valid tag decisions.
4. Human-handoff private messages apply valid tag decisions without sending a
   Bot reply.
5. Group messages do not receive customer tag rules.
6. Existing exclusivity, one-way progression, non-exclusive behavior, and tag
   activation cancellation remain intact.
7. Repeated decisions for an already-active tag create no new task or alert.
8. Tag schema normalization and import/export preserve
   `voiceAlertEnabled`.
9. Alert creation occurs only for accepted `add` and `replace` changes with the
   switch enabled.
10. Alert creation is idempotent for one source tag event.
11. Evidence IDs, evidence text, fallback anchors, deleted evidence, and
    evidence older than the recent-message window behave correctly.
12. SSE requires Bot authorization and isolates Bot data.
13. SSE sends an unread snapshot, live creation, shared read events,
    heartbeats, and cleans up closed connections.
14. Reconnection restores the database snapshot without polling.
15. The console pauses and resumes flashing according to hover/focus state.
16. Clicking an item opens the correct conversation, loads the anchor window,
    scrolls, highlights, annotates, and marks the alert read.
17. One Agent response containing multiple alert events plays the MP3 once.
18. Historical snapshots do not play audio.
19. Tag failures do not discard a valid customer reply when the reply protocol
    itself is valid.
20. The full regression suite continues covering normal replies, flow
    transitions, tag activations, friend-added behavior, proactive tasks,
    history analysis, and conversation persistence.

## Non-Goals

- Per-tag audio uploads or different sounds.
- Per-console-user read state.
- Customer tags for group conversations.
- A WebSocket transport.
- Continuous polling.
- Analytics or reports for alert history.
- Multiple service-instance event fan-out.
