# Group Conversation UI Separation Design

## Goal

Keep private and group conversations in the shared **会话** workspace while
showing only the business controls that apply to each channel.

## Conversation Type Navigation

- The type selector contains only **私聊** and **群聊**.
- **私聊** is selected by default.
- Switching type clears the previously selected conversation so a group detail
  cannot remain visible under the private list, or vice versa.
- Opening a tag alert selects the conversation type encoded by the alert's
  conversation key before loading and locating the evidence.

## Private Conversation Behavior

Private conversations keep all existing behavior:

- task-status filtering and task-state card metadata;
- customer assets in the card and detail header;
- manual tagging from the card and context menu;
- human handoff controls;
- automatic and date-tag display.

## Group Conversation Behavior

Group conversations use only group-relevant controls:

- search, date-tag filtering, and normal-tag filtering remain available;
- the task-status filter is hidden and its value is not sent to the server;
- task and asset metadata are omitted from group cards;
- the asset action and popover are omitted from the group detail header;
- manual-tag triggers, context-menu tagging, and the manual-tag API are
  unavailable for groups;
- automatic tags remain visible on the card and in the detail header.

The group card continues to show the date tag separately from other automatic
tags. Removing manual tagging does not remove tag recognition, alerting,
activation delivery, filtering, or evidence navigation.

## Group Creation Date Tag

The system date tag for a managed group uses `managed_groups.group_created_at`.
When the first callback creates the canonical group conversation, the service
ensures the date tag using that managed creation timestamp. It does not use
private task state and does not alter private conversation date-tag behavior.
At service startup, existing managed group conversations without a date tag are
backfilled from the same managed creation timestamp, without replacing any
existing date tag.
WorkTool timestamps without an explicit offset are interpreted as Beijing time.
If a callback discovers a group before the group-list API supplies its actual
creation time, the later authoritative timestamp updates both the managed group
record and the system-created group date tag.

## Verification

- Boundary tests cover the two-tab default and channel-specific controls.
- Database tests cover a managed group's creation-date tag.
- Server boundary tests cover group manual-tag rejection and managed date-tag
  persistence.
- Existing private conversation tests must remain green.
