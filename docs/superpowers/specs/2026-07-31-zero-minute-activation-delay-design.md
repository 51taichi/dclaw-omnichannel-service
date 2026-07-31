# Zero-Minute Activation Delay Design

## Goal

Allow an activation message interval of `0` minutes for customers who should receive an initial message quickly. A configured value of `0` means a real countdown of five seconds, not an immediate synchronous send.

## Behavior

- The task and tag activation interval controls accept whole numbers greater than or equal to zero.
- `intervalMinutes: 0` is preserved through UI state, API payloads, normalization, and database persistence.
- At scheduling time, an interval of zero produces a due time five seconds after the anchor time.
- Positive values keep their existing minute-based behavior.
- Repeated sends configured with a zero interval use a five-second delay for each attempt.
- Existing configurations and database rows require no migration.

## Implementation Boundaries

### Console

Change both activation interval inputs to use `min="0"`. Input handlers and configuration normalization must preserve zero instead of replacing it with one or a default value.

### Configuration Normalization

Flow and tag activation normalizers accept zero while retaining current defaults for missing, empty, or invalid values. Negative values are clamped to zero.

### Scheduling

Centralize the delay conversion so every activation path follows the same rule:

- zero minutes: always `5,000` milliseconds, including repeated attempts;
- positive minutes: `intervalMinutes * 60,000` milliseconds per interval multiplier.

This applies to friend-added entry activation, normal flow activation, subsequent activation attempts, subsequent activation messages, and tag activation.

## Error Handling

- Empty and non-numeric values continue to use the established default.
- Negative values are normalized to zero and therefore schedule after five seconds.
- The scheduler always produces a future timestamp for zero-minute activation, avoiding races caused by immediate execution.

## Verification

- Console boundary tests prove both controls permit and preserve zero.
- Activation normalization tests prove zero survives flow and tag configuration handling.
- Scheduling tests prove zero maps to five seconds and positive values remain minute-based.
- Existing activation, friend-added, tag activation, and full test suites must remain green.
