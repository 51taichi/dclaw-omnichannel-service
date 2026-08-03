# Group Conversation Handoff And Manual Tags Design

## Goal

Allow group conversations in the shared **会话** workspace to use the same
human-handoff and manual-tag interactions as private conversations, without
changing private behavior or introducing group task-state semantics.

This design supersedes the manual-tag and handoff exclusions in
`2026-07-29-group-conversation-ui-separation-design.md`.

## Chosen Approach

Use the existing conversation-level handoff and tag services for both private
and group conversations. Resolve only the outbound target by conversation
type: a private conversation targets its customer, while a group conversation
targets the managed group's current name.

This keeps one behavior contract for both channels. Merely exposing the current
UI would leave server-side rejections in place, while separate group endpoints
would duplicate handoff and tag rules and make future maintenance less safe.

## Console Behavior

- Group conversation cards show the same AI/human handoff switch and manual-tag
  button as private conversation cards.
- Clicking or keyboard-activating the group tag button opens the existing tag
  menu. The same menu is also available from the group card context menu.
- Selecting a group conversation shows the same AI-status or manual-reply
  composer below the message history.
- Group cards remain free of private task-node and asset controls.
- Existing private layout, behavior, sorting, and controls remain unchanged.
- Human-handoff conversations sort before AI-controlled conversations within
  the currently selected private or group list.

## Handoff Behavior

Changing a group conversation to human handoff updates the existing
`flow_sessions.handoff_status` field. It cancels any pending inbound coalesced
batch and any pending tag-activation tasks for that conversation. Groups do not
currently have customer flow-activation tasks, so this feature does not create
or depend on them.

While a group is in human handoff:

- every supported inbound text callback is persisted before any decision;
- DClaw receives the existing `handoff_transcript_message` request;
- DClaw must not produce a customer-visible reply or advance a task node;
- enabled normal tags are still evaluated and accepted tag changes are applied;
- the service does not automatically reply to the group;
- the group's normal reply policy is not used to suppress the silent handoff
  transcript, because human handoff already owns the visible reply decision.

Returning the conversation to AI restores its configured group reply policy,
including mention-only, always-reply, or never-reply behavior.

## Manual Reply Delivery

The existing manual-reply endpoint accepts both private and group conversation
keys while retaining the requirements that the session exists, belongs to the
selected Bot, and is currently in human handoff.

For a group conversation, the target is resolved from the managed group linked
to the conversation key. The current group name is used; stale aliases or old
remarks are not used for delivery. A successful WorkTool send is inserted into
both the conversation message history and outgoing-message audit, exactly as it
is for private manual replies.

If the managed group or current target name cannot be resolved, the request
fails without inserting a false outbound message.

## Manual Tags And Tag Activations

The manual-tag endpoint accepts group conversations and reuses the existing
schema validation, mutual-exclusion, one-way override, audit, alert, and tag
activation scheduling behavior.

When a manually added group tag has an enabled activation message, the existing
tag-activation worker resolves the managed group's current name and sends the
message to that group. Entering human handoff cancels pending tag activations in
the same way as private handoff. Date tags remain system-managed and are not
offered as manual choices.

## Explicit Non-Goals

- Do not add customer flow-activation tasks to group conversations.
- Do not add task-node or asset controls to group conversations.
- Do not implement per-group scheduled push tasks in this change.
- Do not change private handoff, private manual reply, or private manual-tag
  behavior.
- Do not change group management roles or automatic reply-policy configuration.

Future per-group scheduled pushes should use the same canonical managed-group
target resolver, but their scheduling and handoff interaction require a
separate design.

## Error Handling And Observability

- Reject requests for missing sessions, wrong Bot ownership, disabled bindings,
  non-human manual replies, missing tags, and unresolved group targets.
- Keep the current rule that failed WorkTool sends do not create successful
  outbound conversation records.
- Include the conversation key and resolved target in manual-reply logs.
- Mark human-handoff message processing with the existing `human_handoff`
  status after silent DClaw synchronization finishes or fails.

## Verification

- Console boundary tests prove group cards expose the handoff and manual-tag
  controls, context-menu entry, and manual composer.
- Server tests prove group manual tags are accepted and preserve existing tag
  activation behavior.
- Server tests prove group manual replies require human handoff, target the
  managed group's current name, and persist successful sends.
- Inbound boundary tests prove group human handoff bypasses visible Agent reply
  processing while retaining silent DClaw tag evaluation.
- Existing private handoff, private tags, group reply-policy, group management,
  activation, and full-suite tests remain green.
