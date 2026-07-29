# Proactive Filter Intersection Design

## Goal

Make proactive push target filtering predictable and make the final recipient
set visible without allowing zero, few, or many recipients to change the page
layout.

## Confirmed Requirements

1. Active automatic filters use intersection semantics.
2. A target selected by both `A类` and today's add date is included.
3. A target that matches only one active condition is excluded.
4. Multiple selected normal tags also use intersection semantics.
5. Date and normal-tag filters continue to fetch matching targets across every
   server page.
6. Manual target checkboxes and the existing all-private/all-group controls
   remain available.
7. The final selected target set is shown immediately above the message
   composer, to the left of the pagination bar.
8. The selected-target row has a fixed height and never wraps.
9. Zero targets show a compact `已选 0` state.
10. A few targets show compact name chips and the selected count.
11. Many targets show only the names that fit plus a `+N` control.
12. The `+N` control opens an overlaid, scrollable complete list without
    changing document layout.
13. Pagination remains fixed on the right and keeps its current control sizes.
14. Narrow viewports hide preview chips before allowing pagination to shift.

## Root Cause

The current console writes every result returned by a selected tag or date
directly into the shared `selectedTargets` map. Its removal helper preserves a
target whenever any other filter also contains it. This explicitly implements
set union, so selecting `A类` and a date produces `A类 OR date`, not
`A类 AND date`.

## Selection Model

Keep three concepts separate:

- `proactiveTagSelections`: one complete target map per active automatic
  filter;
- `proactiveManualTargetKeys`: targets explicitly selected through target
  cards or bulk buttons;
- `selectedTargets`: the final send set rendered by the UI and submitted to
  the server.

Each automatic filter stores `Map<targetKey, target>`. Reconciliation computes
the intersection of all active automatic maps. Manual selections remain
explicit additions so existing direct-selection workflows continue to work.
Changing or removing an automatic filter recalculates its complete automatic
result instead of incrementally adding or subtracting union members.

The pure intersection operation lives in a small browser-compatible module so
its behavior is covered by direct Node tests.

## Selected Target Bar

The row contains:

- a left selected-target summary with fixed height and `min-width: 0`;
- a count button that remains visible in every state;
- a clipped, single-line preview of the first few selected targets;
- an optional `+N` button;
- an absolutely positioned full-list popover;
- the existing pagination bar aligned to the right.

The popover is removed from normal flow. It has a bounded width and height,
scrolls internally, closes on outside click or Escape, and does not move the
message composer or pagination controls.

## Compatibility

This change is console-only. It does not change proactive task persistence,
send order, scheduling, server target APIs, tag storage, conversation
filtering, or any non-push tab.

Manual selection continues to work across pages. Clearing targets clears
manual and automatic state together, as before.

## Verification

- Unit tests prove two and three filter maps produce intersection results.
- Boundary tests prove the selected-target row is present, fixed, clipped, and
  positioned before the message composer with pagination on the right.
- Existing proactive scheduling, pagination, and bulk-selection tests remain
  green.
- Full `npm test` passes.
- Desktop and narrow viewport screenshots confirm that zero, few, and many
  selected targets do not shift the page structure.
