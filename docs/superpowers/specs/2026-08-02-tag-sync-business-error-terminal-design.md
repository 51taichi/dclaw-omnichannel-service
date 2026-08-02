# Tag Sync Business Errors Are Terminal

## Goal

Stop retrying a tag synchronization command after WorkTool has returned a type 213 command callback, including callbacks with a non-zero `errorCode`.

## Behavior

- A successful type 213 callback marks the matching Outbox rows as `succeeded`.
- A type 213 callback with any non-zero `errorCode` also marks the matching Outbox rows as `succeeded`, because WorkTool has returned a final business result.
- The original WorkTool `errorReason` or `errorMsg` is preserved in `last_error`, regardless of language.
- If WorkTool supplies no error text, `last_error` records `其他原因（错误码 <code>）`.
- Business-error callbacks increment the run's succeeded count and do not receive a retry time.
- HTTP submission failures, network failures, and missing callbacks remain retryable through the existing submission-failure and lease-expiry paths.
- Command callbacks whose `type` is not 213 do not enter the tag synchronization callback handler.

## Compatibility

The implementation reuses the existing `succeeded` Outbox status and `last_error` column. It adds no migration or UI state and does not change customer replies, activation messages, proactive sends, tag assignment, or nightly scheduling.

## Tests

- A non-zero type 213 callback resolves matching rows as succeeded, preserves the original error text, and does not set a retry time.
- A non-zero type 213 callback without error text records the generic reason with its error code.
- A type 203 callback is ignored by tag synchronization.
- Existing transport-failure and lease-expiry retry tests continue to pass.
