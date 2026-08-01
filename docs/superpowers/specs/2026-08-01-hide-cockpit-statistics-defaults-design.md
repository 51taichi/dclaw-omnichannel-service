# Hide Cockpit Statistics Defaults Design

## Goal

Remove the visible `统计时区` and `未回复阈值` controls from the cockpit report configuration because they are system-level rules rather than customer-facing choices.

## Confirmed Defaults

- Statistics timezone: `Asia/Shanghai`
- Default no-reply threshold: `24` hours

## Considered Approaches

1. **Hidden fixed form values (selected).** Replace the two visible labeled controls with hidden inputs carrying the confirmed defaults. This keeps the current form serialization and API payload unchanged while removing the confusing UI.
2. **JavaScript-only defaults.** Remove the fields and inject constants while saving. This works, but spreads form defaults into event-handling code and makes the form contract less visible.
3. **Server-enforced defaults.** Remove the fields from the client payload and force the values in server normalization. This is stronger enforcement but expands a presentation cleanup into an API and persistence behavior change.

The hidden-input approach is the smallest safe change and preserves the existing backend contract.

## UI Behavior

- The configuration page no longer displays labels, icons, inputs, or units for `统计时区` and `未回复阈值`.
- Report recipient fields become the first visible controls in the cockpit report panel.
- The existing recipient layout remains three equal columns on desktop and one column on narrow screens.

## Data Flow

- `cockpitConfigForm` continues to expose `timezone` and `defaultNoReplyHours` to the existing JavaScript code.
- Saving the form continues to send the same payload shape.
- Loading saved configuration may still assign values to these hidden controls, but the fixed defaults remain the product defaults for new configurations.
- No server route, database schema, aggregation rule, or report-generation logic changes.

## Testing

- Add a console boundary test that rejects visible `统计时区` and `未回复阈值` labels inside the cockpit report panel.
- Require hidden inputs named `timezone` and `defaultNoReplyHours` with values `Asia/Shanghai` and `24`.
- Keep existing tests proving the form field names and report recipient layout.
- Run the focused cockpit boundary test and the full test suite.

## Scope

Only console HTML and its boundary test are expected to change. Backend defaults and report semantics remain unchanged.
