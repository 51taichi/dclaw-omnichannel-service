# Task 6: Standard delivery and fake adapter

## Changed files

- `src/channels/delivery.js` — adds normalized, capability-aware command delivery with account validation, standard-result validation, and safe error conversion.
- `src/channels/fake/adapter.js` — adds a complete deterministic in-memory adapter with immutable sent-command snapshots, FIFO outcomes, reset support, and stable utility responses.
- `tests/channel-delivery.test.js` — covers dispatch, input and recorded-command immutability, account validation, capabilities, queued outcomes/errors, malformed responses, safe unexpected-error conversion, reset behavior, and instance isolation.

## TDD evidence

1. Added `tests/channel-delivery.test.js` before either production module.
2. Ran `node --test tests/channel-delivery.test.js`; it failed as expected with `ERR_MODULE_NOT_FOUND` for `src/channels/delivery.js`.
3. Implemented the minimal delivery and fake adapter behavior, then ran the test successfully.
4. Added the direct fake-adapter snapshot regression before changing the fake implementation. It failed because the recorded nested metadata changed from `direct` to `changed`, then passed after the fake normalized its own command snapshot.

## Verification

```sh
node --test tests/channel-errors.test.js tests/channel-contract.test.js tests/channel-registry.test.js tests/channel-delivery.test.js
```

Result: 30 passed, 0 failed (exit code 0).

`git diff --check` completed with no output.

## Self-review

- Delivery normalizes before account lookup, refuses absent/mismatched accounts before registry resolution or adapter invocation, and maps text to `sendText` and all other types to `sendMedia` after required-content validation.
- Registry capability resolution controls text/media eligibility. Existing `ChannelError` instances pass through untouched; unexpected errors become safe retryable channel errors without exposing provider error text through serialization.
- Fake instances own all mutable state. Queued outcomes are FIFO, send records are immutable, default message IDs are deterministic, and `clear()` resets queues, records, and IDs.
- The implementation has no logging, provider-specific delivery branching, filesystem access, or network access.

## Concerns

None.

## Review fix: deeply immutable fake command records

- Added a regression for a retained extension field (`custom.nested`) passed directly to the fake adapter. Before the fix, mutating that nested field after `sendText` changed the stored record; the focused test failed with `changed` where `direct` was expected.
- The fake now creates its own recursive frozen snapshot after command normalization, so every retained plain object or array field is isolated from later caller mutation while supported command fields keep their existing normalization semantics.
- Re-ran `node --test tests/channel-errors.test.js tests/channel-contract.test.js tests/channel-registry.test.js tests/channel-delivery.test.js`: 31 passed, 0 failed (exit code 0).
