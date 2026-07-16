# Task 2 Report: Per-message activation scheduling

## Implemented

- Added `scheduleCurrentActivation` in `src/server.js`. It reads Task 1 activation progress, schedules only the current unfinished message, records its `messageIndex`, and calculates the due time from that message's own interval and attempt count.
- Updated normal flow replies to invalidate earlier work and schedule the current remaining message without resetting progress.
- Updated friend-added handling to schedule only for a newly created entry session. Existing sessions, including existing entry sessions, are left unchanged.
- Raw delivery now sends the persisted `task.messageContent`. Agent-polished delivery gives DClaw only that same single message.
- After a confirmed WorkTool send, the worker marks the task sent, advances activation progress, validates the current generation/node again, and schedules the next task from `sentTask.sentAt`.
- Preserved the existing processing-status check immediately before a WorkTool send and the post-send mark guard.

## Tests

- `node --test tests/server-activation-boundary.test.js tests/server-friend-added-activation-boundary.test.js`
  - Passed: 13/13.
- `npm test`
  - Passed: 155/156.
  - Remaining failure: `tests/server-activation-worker-boundary.test.js` asserts the obsolete source text `anchorAt: task.anchorAt`. Task 2 requires and implements an effective-send-time anchor (`anchorAt: sentTask.sentAt`), so I did not restore the old behavior or modify that unassigned test file.

## Scope

Modified only the assigned server and boundary-test files, plus this requested report. Other concurrent worktree changes were left untouched.

## Final Review Fixes

- Saving an Agent-owned flow machine now cancels pending and processing activation tasks, clears activation progress, and advances the activation generation for every Bot currently bound to that Agent. It preserves the current node.
- A WorkTool delivery that succeeds after cancellation is recorded as sent. Its progress can advance only on the same active node, is monotonic, and never schedules a successor from the canceled delivery.
- Verification: `node --test tests/db-activation.test.js tests/server-activation-boundary.test.js tests/server-friend-added-activation-boundary.test.js tests/server-activation-worker-boundary.test.js tests/console-activation-boundary.test.js tests/docs-activation-boundary.test.js` passed 39/39; `npm test` passed 166/166; `git diff --check` passed.

## Fix

- Root cause: the console node-change endpoint called `updateFlowSessionNode`, which resets activation progress, but did not call `invalidateFlowActivation`. Pending old-node tasks therefore remained active and the activation generation was unchanged.
- Tests:
  - `node --test tests/server-activation-boundary.test.js` (RED): 7 passed, 1 failed at `manual console node changes immediately invalidate prior activation work` because the invalidation call was absent.
  - `node --test tests/server-activation-boundary.test.js tests/server-friend-added-activation-boundary.test.js tests/server-activation-worker-boundary.test.js` (GREEN): 17 passed, 0 failed.
- Commit: `fix: invalidate activation on manual node changes`.
- Scope: `src/server.js`, `tests/server-activation-boundary.test.js`, and this report only; existing console, docs, and worker-test worktree changes were left untouched.
