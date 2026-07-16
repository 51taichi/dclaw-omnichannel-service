# Task 3 Report: Per-Script Activation Console

## Delivered

- Replaced node-wide activation interval and count drafts with canonical per-message objects:
  `{ content, intervalMinutes, maxTimes }`.
- Added `defaultActivationMessage()` and `normalizeActivationMessageDraft()` to create valid defaults and convert legacy string drafts into object drafts.
- Kept the node-level activation enable toggle and `Agent 组织语言` option.
- Rendered every activation script as an `.activation-message-card` containing a message textarea, independent interval and send-count inputs, and a delete control.
- Updated message input handling, add, delete, and multiline paste behavior to retain the per-script settings.
- Added responsive card grid behavior at `900px` and below.
- Updated the operator documentation to describe sequential scripts, independent intervals/counts, cancellation/restart behavior, and stale progress invalidation after node changes.

## TDD Evidence

1. Updated `tests/console-activation-boundary.test.js` and `tests/docs-activation-boundary.test.js` before implementation.
2. Ran `node --test tests/console-activation-boundary.test.js tests/docs-activation-boundary.test.js` before implementation: 5 passing, 3 failing. The failures were the expected missing per-script markup, default message object insertion, and README wording.
3. Implemented the scoped console, CSS, and README changes.
4. After the initial implementation, re-ran the focused command: 8 passing, 0 failing.

## Verification

- Latest `node --test tests/console-activation-boundary.test.js tests/docs-activation-boundary.test.js`: 10 passing, 0 failing.
- `git diff --check`: passed with no whitespace errors.
- `npm test`: 155 passing, 1 failing. The remaining failure is in the server-only `tests/server-activation-worker-boundary.test.js` outside Task 3's write scope.

The remaining assertion still expects superseded node-wide scheduling/source strings while the concurrent Task 2 server work introduces sequential per-script activation. No server or server-test files were modified for Task 3.

## Scope

Task 3 changes are limited to `public/console/app.js`, `public/console/styles.css`, `README.md`, and the two requested console/documentation boundary tests. The report is this file.

## Fix

- Root cause: `createBlankFlowNode()` initialized activation with an empty `messages` array, so the editor only rendered a fallback message virtually; the console and README also retained wording that implied entry-node activation was anchored to every AI reply.
- Fix: persist one `defaultActivationMessage()` in every newly created flow node and document that the first entry-node timer starts after a new friend, while subsequent timing uses the most recent valid robot outbound message time.
- Test commands/output:
  - `node --test tests/console-activation-boundary.test.js tests/docs-activation-boundary.test.js` -> 10 passing, 0 failing.
  - `git diff --check` -> passed with no whitespace errors.
- Commit: `fix: persist activation defaults and clarify timing`.
- Scope: `public/console/app.js`, `README.md`, and this report only. Existing test and server-test changes were preserved and not staged.

## Final Review Fix

- Legacy string activation messages now inherit their containing node's saved `intervalMinutes` and `maxTimes` in the console, so opening and saving an existing state machine does not silently rewrite its timing.
