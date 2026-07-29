# Group Management UI Polish Design

## Goal

Improve the existing group-management interface without changing its product
structure, data behavior, or 30/70 workbench layout. Fix the compressed dialog,
misaligned role editor, crowded tag choices, and weak group-list hierarchy shown
in the annotated screenshots. Add icons to all group-management headings,
fields, status metadata, and actions.

## Scope

### Group management header

- Remove the `群管理` heading and the explanatory sentence about viewing
  history in the conversation tab.
- Keep the refresh and create actions in a compact right-aligned toolbar
  without leaving an empty title column.

### Group list

- Keep the 30% sidebar.
- Render each group as a structured card with a leading group icon.
- Give the group name, optional remark, and reply-policy status separate rows.
- Use remark and reply-policy icons so secondary information remains scannable.
- Keep the complete card clickable and preserve the existing selected state.

### Group configuration

- Add icons to the selected-group heading, announcement, modify action, reply
  policy, background, tag-group legend, save action, role heading, add action,
  and save-role action.
- Render tag groups as uniform selection cards.
- Render the required establishment-date binding with calendar and lock icons.
- Preserve native checkbox semantics and all existing values.

### Role editor

- Add a dedicated column header with icons.
- Align member name, identity, description, reply policy, member remark, sync
  control, and delete action to one shared grid.
- Keep sync and delete controls at stable widths.
- On narrow screens, switch each role to a labeled vertical card rather than
  allowing horizontal clipping.

### Create and modify dialogs

- Give group dialogs a dedicated one-column layout instead of inheriting the
  generic confirmation dialog's icon/content grid.
- Use a header row with an icon, title, and supporting copy.
- Add icons to group name, announcement, contact search, remark switch, and
  remark fields.
- Keep the contact list full width and scrollable.
- Add icons to cancel, create, and save buttons.
- Constrain dialog height to the viewport and scroll only the body when needed.

## Styling boundaries

- Scope all changes under existing `groups-*` classes.
- Reuse the existing SVG symbol set and color variables.
- Do not introduce image assets, a new icon library, or global form overrides.
- Do not modify backend routes, persistence, reply policies, tag behavior, or
  WorkTool commands.

## Verification

- Extend the group-console boundary test to assert the dedicated dialog layout,
  structured group cards, tag cards, role header, and icon usage.
- Run JavaScript syntax validation, the focused console tests, and the full
  project test suite.
- Verify the CSS does not alter generic confirmation and unlock dialogs.
