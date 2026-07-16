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
