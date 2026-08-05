# Task 5: Instance-scoped channel registry

## Delivered

- Added `createChannelRegistry()` with closure-owned adapter storage.
- Registration validates adapters through the channel contract, rejects duplicate providers, and returns the registered adapter.
- Lookup, removal, capability-aware resolution, and immutable alphabetical provider snapshots use documented channel errors and safe error context.
- Added coverage for registration/listing, duplicates, removal, unknown providers, invalid account IDs, unsupported capabilities, and instance isolation.

## TDD evidence

1. Added `tests/channel-registry.test.js` before production code.
2. Ran `node --test tests/channel-registry.test.js`; it failed as expected with `ERR_MODULE_NOT_FOUND` for `src/channels/registry.js`.
3. Added the minimal registry implementation and reran the test suite.

## Verification

`node --test tests/channel-errors.test.js tests/channel-contract.test.js tests/channel-registry.test.js`

- Exit code: 0
- Tests: 20 passed, 0 failed

## Scope

Only the Task 5 registry implementation, its tests, and this report are included in the task commit.

## Review fix: remove module-scope mutability

- Replaced the module-scope `Set` of known capabilities with a frozen array and `includes` lookup. The registry keeps its only mutable state (`Map`) inside `createChannelRegistry()`.
- Existing capability-resolution tests cover the preserved unknown/disabled/allowed capability behavior; no source-shape test was added because it would be brittle rather than consumer-observable.
- Re-ran `node --test tests/channel-errors.test.js tests/channel-contract.test.js tests/channel-registry.test.js`: 20 passed, 0 failed (exit code 0).
