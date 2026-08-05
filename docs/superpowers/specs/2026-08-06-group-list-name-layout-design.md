# Group List Name Layout Design

## Goal

Make group names readable in the group-management sidebar without increasing the card height or removing the creation-date and local pin controls.

## Layout

- Keep the group avatar in the first fixed-width column and let it span both content rows.
- Give the group name the complete flexible second column on the first row.
- Place the creation-date badge in the flexible second column on the second row, aligned to the left.
- Keep the local pin control absolutely positioned at the right edge with its existing fixed square size.
- Reserve only the pin width on the selection button instead of reserving both the pin and date widths on the same row.

## Overflow Behavior

- Short and medium group names display in full.
- Truly long group names use a single-line ellipsis.
- The full group name remains available through a native hover title.
- The date badge always displays its complete eight-digit value.

## Constraints

- Preserve the current card height and list density.
- Preserve group selection and local pin behavior.
- Do not change API calls, group data, or backend code.
- Keep responsive behavior stable at the current sidebar width.

## Verification

- Add a boundary test for the two-column, two-row layout and full-name title.
- Run the focused group-management test and the complete test suite.
- Inspect the rendered sidebar with both long and short group names to confirm there is no overlap.
