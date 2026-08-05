# Task 2 report: rename active service identity

## Files

- Modified `package.json` and `package-lock.json` with the new package identity.
- Modified `src/config.js` so the single-Bot configuration selects `BOT_ID` before the temporary `ROBOT_ID` fallback.
- Modified `src/server.js` for the health and startup service identities.
- Modified `README.md` for the independent omnichannel identity, runtime database path, and migration-only WorkTool guidance.
- Added `tests/service-identity.test.js`.

## Red / green evidence

1. Red: `node --test tests/service-identity.test.js` initially reported 3 failures: old package metadata, `/health.service` as `worktool-bot-service`, and `ROBOT_ID` winning when both single-Bot variables were set. The subprocess was started with an isolated `DATABASE_PATH` and all workers disabled.
2. Green: after the minimal metadata, configuration, and server changes, `npm install --package-lock-only --ignore-scripts && node --test tests/service-identity.test.js` passed all 3 tests.

## Final commands and results

```text
node --test tests/service-identity.test.js tests/server-boundary.test.js
5 tests passed, 0 failed.

npm pkg get name description
name: dclaw-omnichannel-service
description: Channel-neutral DClaw customer service and sales platform

git diff --check
No whitespace errors.
```

## Commit

`chore: rename service runtime identity`

## Self-review

- The explicit `BOTS_CONFIG_JSON` and `BOTS_CONFIG_PATH` branch remains ahead of the single-Bot fallback, so its behavior is unchanged.
- The subprocess health test performs a real HTTP request, asserts the response identity and startup output, owns a temporary database, disables workers, and cleans up its child process and temp directory.
- No legacy database migration/read/copy or Whapi network code was introduced.

## Concerns

None. WorkTool-specific documentation is retained only as clearly labeled migration guidance; Whapi is explicitly documented as not yet connected.
