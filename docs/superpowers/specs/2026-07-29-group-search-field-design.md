# Group Search Field Design

## Goal

Replace the icon-only group-list search input with the console's standard
split-label field shown in the reference image.

## Design

- Keep the existing `groupSearchInput` and its current input event behavior.
- Render a left field label with the search icon and text **搜索群**.
- Render the input on the right with placeholder **搜索群名**.
- Reuse the shared `field-label` visual language and keep the control at the
  existing sidebar width and standard 42-pixel field height.
- Remove only the obsolete group-search icon overlay and left input padding.

## Verification

- A boundary test asserts the exact label and placeholder.
- A boundary test asserts the split two-column layout and absence of the old
  absolute icon overlay.
- Existing group-management and full test suites remain green.
