# Task 1 Report: Normalize, Persist, and Reset Per-Message Progress

## Status

Completed and committed from baseline `d15c25f`.

## Implementation

- Added migration-safe columns for `flow_sessions.activation_state_json` and
  `flow_activation_tasks.message_index` / `message_content`.
- Normalized legacy string activation messages into canonical objects with
  per-message `content`, `intervalMinutes`, and `maxTimes` values.
- Persisted the selected message metadata when scheduling activation tasks and
  exposed it through task row mapping.
- Added `getFlowActivationProgress` and transactional
  `advanceFlowActivationProgress` APIs. The advance operation checks the
  session's current node and generation before storing the next progress state.
- Cleared activation progress on node transitions, conversation reset, and
  Agent rebind resets.

## Tests

TDD red phase:

- `node --test tests/db-activation.test.js` initially failed because activation
  messages were still strings, task message metadata was absent, and progress
  APIs did not exist.

Green and regression verification:

- `node --test tests/db-activation.test.js` passed: 6 tests, 0 failures.
- `npm test` passed: 153 tests, 0 failures.

The new focused coverage verifies canonical object messages, default progress,
one-send advancement to the next message, two-send in-message progress, stale
generation rejection, node-change clearing, and conversation-reset clearing.

## Commit

- `d6082d6a6ee8077e0aefffe1a6cc3c33d9590b0f feat: persist sequential activation progress`

## Concerns

None. The original report was intentionally left uncommitted because the
required commit contract specified staging only `src/db.js` and
`tests/db-activation.test.js`.

## Review Fix

- Corrected the stale-generation assertion in `tests/db-activation.test.js` to
  use valid `messageIndex: 0` for its one-element message list.
- Added an assertion that progress remains unchanged after the stale attempt.
- Test fix commit: `e558c9f021ed0c9cd1aa296bdba599c0ebd2de17`
- `node --test tests/db-activation.test.js` passed: 6 tests, 0 failures.
