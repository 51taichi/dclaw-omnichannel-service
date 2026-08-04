# Conversation Metadata Flow Design

## Goal

Unify private and group conversation metadata so date tags, business tags, and the current task use the available horizontal space before wrapping. The conversation list and selected-conversation header must follow the same rule.

## Current Problem

Private conversation cards reserve a dedicated grid column for the current task. This reduces the tag area and causes business tags to wrap earlier than they do in group conversations. The selected-conversation header also has separate metadata and task/action regions, so adding group task information can produce the same premature wrapping.

## Chosen Design

Use one shared flow layout for conversation metadata:

1. Render metadata in the order: date tag, business tags, current task.
2. Use a flex row with wrapping so each item keeps its natural width.
3. Wrap only when the remaining row width cannot contain the next complete item.
4. Keep the current-task badge at its existing fixed width and ellipsis behavior so long node names cannot resize a card.
5. Keep the manual-tag button, avatar, name, handoff switch, asset button, group-task button, and delete action in their existing interaction positions.
6. Apply the same metadata flow behavior to private and group conversations. A missing date, business tag, or task simply removes that item without leaving reserved blank space.

## Implementation Boundaries

- Reuse the existing tag-chip rendering and visual styles.
- Add a shared metadata-flow wrapper rather than separate private and group layout exceptions.
- Do not change conversation data, tag ordering rules, task state, handoff behavior, or API calls.
- Do not change the group task details panel; only prevent its presence from forcing metadata to wrap before space is exhausted.
- Preserve responsive behavior: on narrow widths, complete chips move to the next line and remain fully readable.

## Verification

Automated boundary tests will verify:

- Private and group cards use the same metadata-flow container.
- Date, business tags, and current task appear in the agreed order.
- The task no longer owns a separate grid column.
- The shared container uses horizontal flex wrapping and does not reserve empty space for absent metadata.
- The selected-conversation header uses the same wrapping rule while its action buttons remain independent.

Manual browser verification will cover private and group sessions with zero, one, and multiple tags, including a current task and group task information, at desktop and narrower viewport widths.
