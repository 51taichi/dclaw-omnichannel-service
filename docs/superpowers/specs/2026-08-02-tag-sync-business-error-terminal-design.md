# Tag Sync Business Errors Are Terminal

## Goal

Stop retrying a tag synchronization command after WorkTool has returned a type 213 command callback, including callbacks with a non-zero `errorCode`.

Allow each Bot administrator to decide whether customer-added date tags are included in WorkTool synchronization. Date-tag synchronization is disabled by default.

## Behavior

- A successful type 213 callback marks the matching Outbox rows as `succeeded`.
- A type 213 callback with any non-zero `errorCode` also marks the matching Outbox rows as `succeeded`, because WorkTool has returned a final business result.
- The original WorkTool `errorReason` or `errorMsg` is preserved in `last_error`, regardless of language and including error codes 201103 and 201104.
- If WorkTool supplies no error text, `last_error` records `其他原因（错误码 <code>）`.
- Business-error callbacks increment the run's succeeded count and do not receive a retry time.
- HTTP submission failures, network failures, and missing callbacks remain retryable through the existing submission-failure and lease-expiry paths.
- Command callbacks whose `type` is not 213 do not enter the tag synchronization callback handler.

## Date Tag Synchronization

- Each Bot tag-sync config exposes a `同步添加日期标签` switch.
- The switch defaults to off for new and existing Bots.
- The switch applies equally to scheduled nightly runs, manual runs, incremental tag changes, and the initial backfill.
- When disabled, date tags are not registered in the Outbox.
- Saving the disabled setting removes pending or failed date-tag Outbox rows, including rows created by an older version. Processing rows are allowed to finish so an already submitted WorkTool command is not orphaned.
- Already succeeded Outbox rows and tags already present in WorkTool remain unchanged.
- Re-enabling the switch backfills the currently assigned date tag for each eligible private customer; it does not synthesize historical dates.

## Compatibility

Business-error handling reuses the existing `succeeded` Outbox status and `last_error` column. Date-tag filtering adds one Bot config column, one Outbox tag-type column, and one console switch. Existing Outbox rows derive their tag type from `conversation_tags` during migration. These changes do not alter customer replies, activation messages, proactive sends, tag assignment, or nightly scheduling.

## Tests

- A non-zero type 213 callback resolves matching rows as succeeded, preserves the original error text, and does not set a retry time.
- A non-zero type 213 callback without error text records the generic reason with its error code.
- A type 203 callback is ignored by tag synchronization.
- Existing transport-failure and lease-expiry retry tests continue to pass.
- Bot config defaults date-tag synchronization off and persists the switch.
- Incremental registration and initial backfill exclude date tags while disabled.
- Disabling the switch removes pending and failed date-tag rows without touching processing or succeeded rows.
- Enabling the switch backfills each customer's currently assigned date tag.
