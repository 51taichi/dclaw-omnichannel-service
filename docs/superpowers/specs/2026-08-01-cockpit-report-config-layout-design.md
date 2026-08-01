# Cockpit Report Config Layout Design

## Goal

Make the cockpit report configuration fields compact, aligned, and readable without changing report configuration behavior.

## Layout

- Keep timezone and no-reply threshold in the existing two-column first row.
- Use a consistent compact label width across the report configuration form.
- Keep daily, weekly, and monthly recipient fields as full-width stacked rows so long recipient lists remain easy to edit.
- Vertically center icons, labels, input values, and units.

## Labels And Help

- Add a semantic icon before every field label.
- Use the short labels `统计时区`, `未回复阈值`, `日报接收人`, `周报接收人`, and `月报接收人`.
- Render `小时` as a unit beside the numeric threshold value instead of embedding it in the label.
- Move the shared `每行一个企微联系人` instruction to one help control beside the module title, with a native tooltip.

## Behavior

- Preserve all existing field names, values, validation, submit handling, switches, and report-generation actions.
- Do not alter the server API or persisted report configuration.

## Verification

- Add boundary coverage for semantic icons, short labels, the shared help tooltip, the threshold unit, and scoped compact label sizing.
- Run the complete test suite before pushing.
