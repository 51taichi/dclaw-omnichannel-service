# Group Management and Reply Policy Design

## Summary

Add a Bot-scoped **群管理** console tab for discovering and configuring group
conversations. Group and private-chat business state remain isolated. They share
the existing reply capabilities and the complete tag feature. Tag definitions
and behavior are shared, while tag results, conversations, roles, backgrounds,
and private task state remain scoped to their own channel.

The feature supports groups created through the console and groups into which
the Bot was invited by someone else. Group creation is optional and is never a
prerequisite for group replies.

## Product Boundaries

Group management owns:

- group discovery and selection;
- optional external-group creation;
- external group-name and announcement updates;
- group reply defaults;
- Agent-only group background;
- manually maintained role and per-person reply overrides;
- group-to-tag-group bindings;
- group tag alerts that navigate to evidence in the existing conversation tab.
- group tag activation delivery using the shared tag configuration.

Group management does not own:

- private-chat tasks, flow nodes, activation reminders, or human handoff;
- private-chat customer tags or customer profiles;
- chat-history display;
- live group membership truth;
- kicking members, dissolving groups, or other destructive group operations;
- background polling.

## Console Layout

The **群管理** tab has a header action and a two-column body:

```text
群管理                                      [创建外部群]
┌────────────────────── 30% ─┬────────────────────────── 70% ─┐
│ 搜索 / 刷新群列表           │ 当前群摘要       [修改群信息] │
│                              │ 群默认回复策略               │
│ 群列表                       │ 群背景                       │
│                              │ 角色配置                     │
│                              │ 应用标签组                   │
│                              │                    [保存配置]│
└──────────────────────────────┴──────────────────────────────┘
```

The tab never renders group messages. Chat history remains in **会话**.

### Empty and loading states

- No selected group: the right pane asks the user to select a group.
- No groups: explain that a group appears after the Bot receives a group
  message, the user refreshes the list, or the user creates a group.
- A newly discovered group is marked **待配置** until a local configuration is
  saved.

## Group Discovery Without Polling

There is no scheduled or background group-list polling in any release.

Groups enter the local registry only through:

1. an incoming message from an unknown group;
2. a group-creation command accepted by WorkTool;
3. one synchronization when the user opens **群管理**;
4. an explicit **刷新群列表** action.

The WorkTool group-list endpoint is deprecated. Losing that endpoint must not
break replies for already known or newly messaging groups.

## Stable Local Group Identity

Each group receives an immutable local `groupId`. Conversations, messages,
configuration, roles, tag bindings, tag state, and alerts reference this ID
rather than using the current group name as their durable identity.

A group record retains:

- Bot ID;
- immutable local group ID;
- current group name;
- current group remark when available;
- historical names and remarks;
- discovery source and timestamps;
- WorkTool creation time when available;
- local configuration version.

All matching and data access are Bot-scoped.

### Renames

When this system successfully renames a group, it updates the current name and
retains the old name as an alias. History and configuration remain attached to
the same local group.

When a group is renamed externally and WorkTool provides no stable identity
that proves the mapping, the new name is registered as a pending group. The
system does not merge groups by name similarity. An administrator may manually
merge it into the original record.

Unresolved same-Bot group-name conflicts block external group mutations because
WorkTool addresses these operations by name or remark. Reply processing may
continue for the callback conversation.

## New-Group Defaults

Whether created by this system or discovered externally, a group initially has:

- default reply policy: **仅被 @ 时回复**;
- unconfigured people inheriting the group policy;
- empty Agent background;
- the system date tag group bound;
- no other tag groups bound.

## Create External Group Dialog

The header **创建外部群** button opens a dialog. Group creation is not shown as
an expanded section in the main page.

Fields:

- group name;
- searchable multi-select of the current Bot's private contacts;
- group announcement;
- optional group remark when supported by WorkTool.

The contact selector reuses the interaction model of the Push tab address book,
but filters out group targets. Selected names become WorkTool `selectList`.

On submit:

1. validate input and prevent duplicate clicks;
2. send WorkTool command type `206`;
3. distinguish command acceptance from device execution success;
4. create a local `creating` group record after command acceptance;
5. close the dialog and select that group in the left pane;
6. allow immediate local configuration;
7. retain invitees only as role-configuration suggestions, not as proof of
   current group membership;
8. confirm actual creation later through a command result, group message, or
   user-triggered refresh.

WorkTool does not create a duplicate-named group. The UI must not report that
case as a new group success.

## Modify Group Information Dialog

The right-pane **修改群信息** action opens a separate dialog for public
Enterprise WeChat data:

- current group name, prefilled;
- current group announcement, prefilled;
- current group remark when supported, prefilled.

This data is separate from the Agent-only group background.

The save operation compares each editable value with its synchronized original.
It sends only changed fields and makes no WorkTool call when nothing changed.
Successful renames update local aliases. Failed external writes retain the
entered values for retry and do not roll back local group configuration.

The UI validates or warns about WorkTool name limitations, reserved characters,
duplicate names, and Bot group-management permission requirements.

## Group Background

Group background is private Agent context, not a public group announcement.
Examples include the customer, purchase date, product, deployment phase, and
known service issues.

It is:

- stored only in this service;
- scoped to one Bot and one group;
- included in eligible group Agent requests;
- never copied into a private conversation;
- bounded before insertion into an Agent request;
- not exposed verbatim merely because a group participant asks for internal
  context.

## Role Configuration, Not Membership Management

The right pane is named **角色配置**. It is not presented as a live group member
list because WorkTool does not provide reliable current membership through the
selected APIs and membership changes over time.

Role suggestions may come from:

- contacts selected during group creation;
- names observed in group-message callbacks;
- manual additions.

The product does not track `invited`, `joined`, `left`, or other membership
states. A person disappearing or reappearing does not automatically delete or
change their role.

Each role may store:

- current recognized name;
- historical aliases;
- identity type such as customer, customer assistant, internal colleague, or
  partner;
- free-form responsibility and relationship notes;
- reply-policy override;
- optional desired WorkTool member remark;
- whether to synchronize that remark.

Deleting a role removes only local role information and the reply override. It
does not remove the person from the real group.

### Name changes and aliases

WorkTool callbacks expose `receivedName`, not a stable member ID. Matching uses
the Bot, local group, current name, and known aliases.

When this system successfully changes a member remark, the new remark becomes
the current recognized name and the previous name becomes an alias. This is
required because later WorkTool remark calls must address an already remarked
person by the current remark.

An externally changed, unmatched name is added as an unconfigured person. The
system never auto-merges by fuzzy name similarity. The customer may manually
merge it with an existing role, preserving all aliases.

### Member remark synchronization

Local role edits never imply a WorkTool remark change. Synchronization is
opt-in per person.

On **保存配置**:

- save local role data first;
- consider only people with remark synchronization enabled;
- compare desired and original remarks;
- omit unchanged remarks;
- reject ambiguous group or person targets;
- batch changed remark commands when supported;
- report each external result independently;
- preserve successful local saves when external synchronization fails.

## Reply Policies

Group default policies:

- **始终回复**
- **仅被 @ 时回复**
- **从不回复**

Per-role policies:

- **继承群设置** (default)
- **始终回复**
- **仅被 @ 时回复**
- **从不回复**

The UI guidance is:

- **始终回复**: recommended for important customers; every message enters the
  Agent reply and tag-recognition path.
- **仅被 @ 时回复**: only messages that actually mention the Bot enter that
  path; other messages are recorded only.
- **从不回复**: suitable for colleagues or observers whose messages should be
  recorded without immediate Agent processing.
- **继承群设置**: use the group's default.

There is no separate `important customer` field and no independent tag-analysis
switch.

### Inbound decision

For every supported group callback:

1. resolve the Bot and local group;
2. persist and deduplicate the message;
3. suppress Bot-authored outbound echoes;
4. match the sender to a configured role or alias;
5. resolve the final policy from the role override or group default;
6. evaluate `atMe` when required;
7. if not triggered, stop after persistence;
8. if triggered, build the group Agent request, perform normal response
   validation, apply eligible tag decisions, and send the reply and attachments
   to the current group.

Messages that do not trigger the Agent remain available as group history for a
later eligible request.

WorkTool callback binding must use `openCallback=1` and `replyAll=1`; otherwise
non-mentioned messages cannot be recorded or handled by **始终回复**.

## Shared Reply Capabilities

An eligible group request uses the same capabilities as an eligible private
request:

- the assigned DClaw Agent;
- enterprise knowledge;
- approved attachments and sources;
- human reply-style rules;
- general rules;
- response validation and retry;
- inbound coalescing;
- WorkTool text and media delivery.

Channel-specific state remains separate. A group request receives no private
flow node, private activation state, private handoff state, or private customer
tag state.

## Group-to-Tag-Group Bindings

The Tags tab remains the single definition surface for:

- tag groups and tags;
- recognition conditions;
- mutually exclusive or non-exclusive behavior;
- voice-alert enablement;
- tag activation messages, intervals, repetition, and Agent polishing;
- all other existing tag semantics.

Each group selects which tag groups apply. The binding unit is the tag group,
not an individual tag. Binding controls eligibility only; it does not override
tag behavior.

- Unbound groups are omitted from that group's Agent tag context.
- Changes inside a bound tag group apply automatically.
- Newly created ordinary tag groups are not automatically bound to existing
  groups.
- Deleted tag groups invalidate their bindings.

Group tag state is stored on the group conversation and never copied to or from
private conversations.

### Date tag group

The system date tag group is always bound and cannot be removed. The group date
uses:

1. WorkTool `createTime` when available;
2. the system's successful group-creation time;
3. the first-discovered time as a documented fallback.

The stored tag metadata records the date source.

### Recognition and alerts

Tag recognition runs only for messages that actually trigger the Agent reply
path. It follows the tag definition without group-specific exceptions:

- mutually exclusive groups replace tags normally;
- non-exclusive groups accumulate tags normally;
- existing identical tags are not added again;
- normal add, replace, and remove decisions are preserved.

Alert behavior also follows the tag definition:

- a tag without voice alerts enabled never creates an alert;
- an alert-enabled tag creates an alert only when the normal tag operation adds
  it or replaces another tag with it;
- a repeated decision for an already active tag creates no alert;
- callback duplication or retry creates no duplicate tag operation or alert.

### Tag activation

Tag activation is part of the shared tag feature, not part of the private task
state machine. When a group receives a tag whose configuration includes
activation messages:

- schedule activation using the tag's existing interval, repetition, and Agent
  polishing rules;
- send due activation content to the current group;
- retain the same stale-tag, replacement, removal, cancellation, retry, and
  idempotency behavior used by the tag feature;
- use the managed group's current WorkTool address at send time so a successful
  group rename does not strand a pending activation;
- never create or advance a private flow node or flow-node activation task.

Binding a tag group means the group receives the complete tag behavior. Group
management must not silently disable a capability configured on the tag.

## Alert Navigation

A group alert records:

- Bot and local group identity;
- current group name;
- tag group and tag;
- sender name;
- evidence conversation-message ID and excerpt;
- occurrence time.

Clicking it:

1. switches to **会话**;
2. selects the group conversation;
3. loads history around the evidence message;
4. scrolls to and highlights the evidence;
5. marks the alert read using the existing alert workflow.

No message history is added to **群管理**.

## Saving and Concurrency

Local configuration uses optimistic versioning. A stale editor cannot silently
overwrite a newer save; the user must refresh and reapply changes.

External writes and local configuration have separate outcomes:

- local background, reply, role, and tag-binding saves may succeed even when
  WorkTool group mutations fail;
- each failed external field or person is shown explicitly and can be retried;
- there is no infinite background retry.

An in-flight Agent invocation uses its already constructed context snapshot.
The next eligible message uses the new configuration.

## Failure Handling

- A Bot without group-management permission may still use all local reply,
  background, role, and tag-binding features.
- Missing or deprecated group-list access does not stop callback-based group
  discovery or replies.
- Ambiguous group names block external mutation but not local configuration.
- Unknown senders inherit the group policy.
- Invalid or unsupported messages are recorded according to existing message
  rules but do not enter unsupported Agent processing.
- WorkTool command acceptance is not presented as confirmed device execution.
- All WorkTool mutations respect request-rate limits and use batching where
  safe.

## Data Isolation

Tests and implementation must guarantee:

- same-named groups on different Bots are isolated;
- group backgrounds never enter private requests;
- group roles do not alter private contacts;
- group tags do not alter private tags;
- group messages never advance private tasks or schedule private flow-node
  activations;
- private handoff does not suppress group replies;
- group resets or merges cannot affect same-named private conversations;
- every console route enforces existing Bot/workspace authorization.

## Acceptance Criteria

1. A Bot invited into an unknown group defaults to mention-only replies.
2. A group configured for always-reply answers an unmentioned eligible sender.
3. A mention-only role records ordinary messages and replies when mentioned.
4. A never-reply role records messages without Agent invocation.
5. An unconfigured sender inherits the group default.
6. Group background and roles appear in the eligible Agent context.
7. Knowledge, attachments, reply rules, validation, and coalescing work in
   groups.
8. Creating a group selects a local creating record and opens configuration.
9. Command acceptance and execution success are represented separately.
10. Renaming a group through this system preserves history, tags, and config.
11. Externally renamed ambiguous groups are not automatically merged.
12. Unchanged group fields and member remarks produce no WorkTool mutation.
13. A WorkTool permission failure does not discard local configuration.
14. A successful member remark change updates the current name and preserves
    the old alias.
15. Removing a role does not remove a real group participant.
16. Each group recognizes tags only from its bound tag groups.
17. Mutual exclusion, accumulation, removal, and voice alerts follow shared tag
    rules.
18. A repeated active tag creates no duplicate alert.
19. Clicking a group alert opens the group in **会话** and highlights evidence.
20. Duplicate callbacks do not duplicate replies, tags, or alerts.
21. A group tag with activation configured schedules and sends activation
    content to that group using the tag's normal rules.
22. Private task, flow-node activation, handoff, and tag state remain unchanged.
23. The system performs no background group-list polling.

## Explicit Non-Goals

- Real-time or authoritative group-member synchronization.
- Presence, joined, invited, or left member states.
- Automatic fuzzy identity merging.
- Per-message silent tag analysis independent of reply triggering.
- Group task state machines or group flow-node activation reminders.
- Group chat history inside **群管理**.
- Kicking participants or dissolving groups.
- Background group-list polling.
