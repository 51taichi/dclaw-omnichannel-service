# Bounded Legacy History Intelligence Design

## Goal

Restore AI tag decisions and flow asset collection for legacy customers without
reintroducing unbounded Agent prompts.

When a legacy customer's history is first imported, the service will send one
bounded, plain-text view of the customer's own messages to the Agent. The same
Agent response may contain the customer reply, `tagDecision`, and
`flowDecision.collectedDataPatch`.

## Confirmed Requirements

1. Historical analysis uses only customer-authored messages.
2. Employee, Bot, and WorkTool API outbound messages are not included.
3. History is plain text, not JSON, and does not use a `history_context`
   structure.
4. The service selects complete messages from newest to oldest until adding the
   next message would exceed the configured history budget.
5. Selected messages are reordered oldest to newest before being sent so the
   Agent reads them chronologically.
6. The default history budget is 4000 characters.
7. The budget is configurable per Bot in the console Config tab.
8. The allowed range is 1000 through 6000 characters, in steps of 100.
9. The server enforces the range independently of browser validation.
10. The current live customer message is always included in full and does not
    consume the historical budget.
11. One Agent call handles the live reply, historical tag analysis, and flow
    asset collection. History is not split into multiple Agent calls.
12. If older history does not fit, it is omitted. Reduced accuracy is an
    accepted trade-off.
13. The earliest imported customer message timestamp is used locally for the
    add-date tag; the Agent does not infer this date.
14. The service must persist valid `tagDecision` and
    `flowDecision.collectedDataPatch` results through existing business rules.

## Scope And Compatibility

This design supersedes the conflicting parts of:

- `2026-07-25-bounded-agent-context-design.md`, which removed historical Agent
  context and AI tag decisions.
- `2026-07-25-legacy-customer-history-loading-design.md`, which described a
  mixed inbound/outbound history context and omitted a legacy add-date tag.

The supersession is narrow:

- It applies to the first successful legacy-history Agent analysis.
- Normal later messages do not resend the imported historical block.
- Manual tags, tag triggers, flow transitions, response validation, fallback
  replies, conversation display, and WorkTool history import remain otherwise
  unchanged.

## Per-Bot Configuration

Add a Bot-scoped setting:

```json
{
  "historyCustomerTextMaxChars": 4000
}
```

The setting uses the existing `app_settings` storage pattern with a Bot-scoped
key. Missing and invalid values normalize to 4000. Values below 1000 normalize
to 1000; values above 6000 normalize to 6000.

The Config tab gains a collapsible `历史智能分析` panel containing a numeric
input:

- Label: `历史客户发言上限（字符）`
- Default: `4000`
- Minimum: `1000`
- Maximum: `6000`
- Step: `100`

Saving requires the same Bot administrator authorization used by other
Bot-scoped settings. The saved value survives service restarts and deployments.

## Historical Text Selection

The selector receives imported customer messages and a character budget.

1. Keep only inbound messages sourced from customer history.
2. Normalize surrounding whitespace and discard empty messages.
3. Sort newest to oldest.
4. Add each complete message while its text plus required line separator fits
   the budget.
5. Stop at the first message that would exceed the budget.
6. Do not truncate an individual historical message.
7. Reverse the selected set to chronological order.
8. Render one message per line as plain text. Do not serialize an array or
   object.

Character counting uses Unicode code points so valid emoji are not counted as
two broken UTF-16 halves. Media placeholders such as `[图片消息]` and `[语音消息]`
are retained as ordinary message text.

The selector returns the selected messages, rendered text, selected character
count, omitted message count, and configured limit for structured diagnostics.

## Agent Request

The first legacy-customer request contains:

- the complete current coalesced customer message;
- the bounded historical customer text;
- enabled tag groups and tag definitions needed to produce valid tag IDs;
- the compact current flow node and collectible field definitions;
- the existing reply and JSON-only requirements.

The response schema allows:

```json
{
  "reply": "发给客户的文本",
  "attachments": [],
  "sources": [],
  "flowDecision": {
    "currentNodeId": "当前节点",
    "nextNodeId": "下一节点",
    "nodeCompleted": false,
    "confidence": 0,
    "reason": "判断原因",
    "collectedDataPatch": {}
  },
  "tagDecision": {
    "add": [],
    "remove": []
  }
}
```

The historical budget applies only to customer history. The current message,
instructions, bounded tag definitions, and bounded flow definitions are outside
that budget.

The overall DClaw request remains protected by a separate hard request limit.
The request builder must reserve sufficient capacity for a 6000-character
history block plus the already bounded live-message and schema sections. It
must never silently remove the historical block after the selector reports it
as included. If a request still cannot fit because configuration outside this
feature is invalidly large, the service records a deterministic size error and
uses the configured fallback path.

## Applying Agent Decisions

After the response passes the existing Agent response gateway:

1. Send the validated `reply` through the normal WorkTool path.
2. Normalize and apply `tagDecision` through existing tag validation,
   group-exclusivity, one-way-change, and event-recording logic.
3. Apply `flowDecision.collectedDataPatch` through the existing flow-session
   collected-data logic.
4. Mark legacy historical analysis complete only after the validated decisions
   have been processed.

If the initial call or its format repair ultimately fails, do not mark history
analysis complete. The next eligible live customer message may retry the same
bounded historical analysis. Existing fallback-reply behavior remains active.

## Add-Date Tag

After a successful history import, select the earliest valid imported inbound
customer timestamp. Pass it through the existing Beijing-time date-tag
calculation, including the Agent's configured cutoff time, and write the date
tag idempotently.

The current service deployment date and the current live message date must not
replace an available historical timestamp. If history is empty or contains no
valid timestamp, do not invent a legacy add date.

## Logging

Structured logs for the first legacy analysis include:

- Bot ID and conversation key;
- configured history character limit;
- selected character count;
- selected and omitted message counts;
- earliest imported customer timestamp;
- whether tag decisions were applied;
- names of collected-data keys applied;
- completion or retry status.

Logs must not contain the complete historical text, secrets, or API keys.

## Error Handling

- History import empty: process the current message normally without historical
  text or inferred legacy tags.
- History import failure: preserve the existing legacy-history failure status
  and process the current message normally.
- Invalid setting: normalize on read and save.
- Invalid Agent JSON: use the existing response validation and repair flow.
- Invalid tag decision: reject it through the gateway and repair/fallback path.
- Unknown or disallowed tags: existing tag business rules remain authoritative.
- Invalid collected-data fields: existing flow-field rules remain
  authoritative.
- Agent failure after history import: retain imported messages and retry
  historical analysis on the next eligible live message.

## Verification

Tests must prove:

1. Selection starts with the newest messages but renders selected messages in
   chronological order.
2. A message that would cross the budget is not partially included.
3. Emoji and other Unicode code points are counted safely.
4. Outbound messages and empty customer messages are excluded.
5. The live message is complete and outside the historical budget.
6. Defaults, minimum, maximum, and per-Bot setting isolation work.
7. The Config-tab field loads and saves through the Bot-scoped API.
8. A legacy request includes plain customer text and does not contain
   `history_context` or a JSON history array.
9. A valid response applies both `tagDecision` and
   `collectedDataPatch`.
10. Later normal requests do not resend an already completed historical block.
11. Failed analysis remains retryable.
12. The earliest imported timestamp creates the date tag idempotently.
13. A 6000-character history configuration fits the bounded overall request or
    fails explicitly rather than being silently removed.
14. Existing new-customer, group-chat, manual-tag, activation, and fallback
    behaviors continue to pass their regression tests.
