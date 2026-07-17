# Task 5 Report: Tag Activation Scheduling and Worker

## Status

DONE

## Commit

c2fca2f2152a29a3bc5aa72655c581117fffc9cb

## Red Light

Command:

```bash
node --test tests/server-tag-activation-boundary.test.js
```

Summary:

- FAIL as expected before implementation.
- 4 tests failed because `scheduleTagActivationsForAcceptedChanges`, `tagActivationWorkerBusy`, `processTagActivationBatch`, `claimDueTagActivationTasks`, `isTagStillActiveForTask`, `tag.activation.stale_skipped`, and `buildDclawTagActivationRequest` did not exist yet.

## Green Light

Command:

```bash
node --test tests/server-tag-activation-boundary.test.js tests/server-activation-worker-boundary.test.js tests/dclaw-tags.test.js
```

Summary:

- PASS: 10 tests, 0 failures.
- Covered new tag activation boundary tests plus existing flow activation worker and DClaw tag contract boundaries.

Additional verification:

```bash
node --check src/server.js
node --test tests/dclaw-activation.test.js tests/dclaw-tags.test.js
git diff --check -- src/server.js src/dclaw.js src/db.js tests/server-tag-activation-boundary.test.js
```

Summary:

- `src/server.js` syntax check passed.
- DClaw activation/tag tests passed: 4 tests, 0 failures.
- `git diff --check` reported no whitespace errors.

## Modified Files

- `src/server.js`
- `src/dclaw.js`
- `tests/server-tag-activation-boundary.test.js`

`src/db.js` was not modified because Task 2/upstream already provided the tag activation table and helpers used by Task 5: `scheduleTagActivationTask`, `claimDueTagActivationTasks`, `cancelTagActivationTasks`, `markTagActivationTaskSent`, `markTagActivationTaskFailed`, and `listTagActivationTasks`.

## Implementation Summary

- Added tag activation boundary tests.
- Added `buildDclawTagActivationRequest` for `eventType=tag_activation_due`.
- Scheduled tag activation tasks after accepted `add`/`replace` tag changes with activation config.
- Canceled invalid old tag activation tasks for accepted replace/remove changes before applying the new tag state.
- Added an independent tag activation worker with separate config and `tagActivationWorkerBusy`.
- Worker claims due tag activation tasks, rechecks that the tag is still active before sending, sends raw configured copy when `polishByAgent=false`, and uses strict DClaw JSON reply parsing when `polishByAgent=true`.
- Polished activation replies fail closed on invalid format, unsafe attachment source, empty reply, stale tag, missing binding, or missing target.

## Self Review

- File ownership respected: no Mindspace demo dirty files were modified, staged, or committed.
- No new npm dependencies were added.
- Existing flow activation worker remains separate; tag activation has independent worker config, busy marker, claim function, and interval.
- Sending path performs a tag-active check before agent polish and again immediately before WorkTool send.
- Commit contains only `src/dclaw.js`, `src/server.js`, and `tests/server-tag-activation-boundary.test.js`.

## Concerns

- The report is written after the commit so it can contain the final commit hash; therefore it is not included in commit `c2fca2f2152a29a3bc5aa72655c581117fffc9cb`.

---

## Fix Report: Review Follow-up

### Status

DONE

### Red Light

Command:

```bash
node --test tests/server-tag-activation-boundary.test.js
```

Summary:

- FAIL as expected before the fix.
- 2 new tests failed because tag activation polish did not reject `agentReply.degraded`, and the send path did not use a DB guard to reserve a still-processing task with an active tag.

### Green Light

Commands:

```bash
node --test tests/server-tag-activation-boundary.test.js
node --check src/server.js
node --test tests/server-tag-activation-boundary.test.js tests/server-activation-worker-boundary.test.js tests/dclaw-tags.test.js
```

Summary:

- `tests/server-tag-activation-boundary.test.js`: PASS, 6 tests, 0 failures.
- `src/server.js` syntax check passed.
- Required coverage command: PASS, 12 tests, 0 failures.

### Implementation Summary

- Tag activation polish now fail-closes on degraded agent fallback replies and empty replies before any customer send.
- Added `reserveTagActivationTaskForSend` in `src/db.js`, which atomically moves a `processing` task to `sending` only when the matching conversation tag still exists.
- The worker now calls the DB guard immediately before `sendTextMessage`; stale tags are logged as `tag.activation.stale_skipped`, and canceled/sent/failed/missing tasks are logged as `tag.activation.canceled_skipped`.

### Concerns

- The guard prevents pre-send cancellation after reservation by moving the task to `sending`; it does not make the external WorkTool send itself transactional with SQLite.

---

## Fix Report: Second Review Follow-up

### Status

DONE

### Red Light

Command:

```bash
node --test tests/server-tag-activation-boundary.test.js
```

Summary:

- FAIL as expected before the fix.
- 1 new test failed because the tag activation send path did not schedule a next same-message attempt or next message after a successful send.

### Green Light

Commands:

```bash
node --test tests/server-tag-activation-boundary.test.js
node --test tests/server-tag-activation-boundary.test.js tests/server-activation-worker-boundary.test.js tests/dclaw-tags.test.js
node --check src/server.js
node --check src/db.js
```

Summary:

- `tests/server-tag-activation-boundary.test.js`: PASS, 7 tests, 0 failures.
- Required coverage command: PASS, 13 tests, 0 failures.
- `src/server.js` and `src/db.js` syntax checks passed.

### Implementation Summary

- Added `scheduleNextTagActivationTask` to continue the current activation message while `attemptNumber < maxTimes`.
- Added rollover scheduling to the next activation message with `attemptNumber=1` when the current message has reached its max attempts.
- Wired next-task creation only after `markTagActivationTaskSent` succeeds and the tag is still active, using the sent task's `sentAt` as the scheduling anchor.

### Concerns

- The sequence advancement is covered by the existing boundary-style tests, not by a full integration worker test with a live WorkTool send stub.
