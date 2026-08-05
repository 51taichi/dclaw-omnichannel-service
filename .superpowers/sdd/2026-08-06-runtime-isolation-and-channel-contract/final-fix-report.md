# Stage 0–1 Final Fix Report

## Result

All four Important and both Minor final-review findings were fixed in the current project root with no worktree, push, Whapi network code, or provider-name branching.

## Changes

- Deployment identity: `compose.yaml` now names both the service and container `dclaw-omnichannel-service`; `.env.example` makes `BOT_ID` canonical, marks empty `ROBOT_ID` as a temporary fallback, and documents `DATA_DIR` plus `DATABASE_PATH`.
- Send results: `assertSendResult` accepts only documented own data fields, rejects accessors/symbols/credential extensions/unsafe audit graphs, and returns a recursively immutable standard snapshot.
- Channel errors: every code has a canonical public message; direct and converted errors cannot retain caller-controlled secret-bearing messages or stacks; typed errors are rebuilt with their safe code/context and a sanitized non-enumerable cause.
- Inbound events: the complete documented event/chat/sender/message scalar schema is exact and type-checked, timestamps require RFC 3339 form, attachment/mention/raw audit values require JSON-like data, and returned graphs are detached recursive frozen snapshots. `message: null` is limited to non-message events.
- Registry capabilities: registration stores a frozen capability snapshot, so later caller mutation cannot alter resolution.
- Fake capabilities: every present override must be boolean; `null`, numbers, strings, accessors, hidden fields, and unknown fields fail contract validation.

## TDD evidence

| Finding | Red command and observed result | Green command and observed result |
| --- | --- | --- |
| Deployment identity | `node --test tests/service-identity.test.js` — exit 1; 5 pass, 2 fail (old compose service/container and missing canonical example values) | same command — exit 0; 7 pass, 0 fail |
| Strict send result | `node --test tests/channel-contract.test.js` — exit 1; 7 pass, 2 fail (caller alias returned and credential extensions accepted) | `node --test tests/channel-contract.test.js tests/channel-delivery.test.js` — exit 0; 20 pass, 0 fail |
| Safe ChannelError | `node --test tests/channel-errors.test.js` — exit 1; 4 pass, 4 fail (caller message/cause retained and typed error passed through) | all four channel files — exit 0; 35 pass, 0 fail at that cycle |
| Strict inbound events | `node --test tests/channel-contract.test.js` — exit 1; 8 pass, 4 fail (input aliases, incomplete scalar validation, and unsafe extensions) | `node --test tests/channel-contract.test.js tests/channel-delivery.test.js` — exit 0; 23 pass, 0 fail |
| RFC 3339 timestamp edge | `node --test tests/channel-contract.test.js` — exit 1; 11 pass, 1 fail because JavaScript parsed `"1"` as a date | same command — exit 0; 12 pass, 0 fail |
| Immutable capabilities and typed fake overrides | `node --test tests/channel-registry.test.js tests/channel-delivery.test.js` — exit 1; 18 pass, 2 fail | all four channel files — exit 0; 40 pass, 0 fail |

Each red failure was caused by the targeted missing behavior rather than test setup or syntax errors.

## Final verification

| Command | Result |
| --- | --- |
| `node --test tests/channel-*.test.js` | exit 0; 40 pass, 0 fail |
| `node --test tests/runtime-paths.test.js tests/service-identity.test.js tests/db-bot-isolation.test.js` | exit 0; 21 pass, 0 fail |
| `npm test` | exit 0; 1019 pass, 0 fail, 0 skipped/cancelled |
| `git diff --check` | exit 0; no output |
| `rg -n 'gate\.whapi\.cloud\|Bearer ' src/channels` | exit 1; no matches, as required |
| `rg -n 'provider\s*(===\|!==)' src/channels src/core 2>/dev/null \|\| true` | exit 0 through `|| true`; the only matches are `typeof` string validation, not provider-name branching; `src/core` is absent |

## Scope audit

Changed implementation/artifact files are limited to `.env.example`, `compose.yaml`, and `src/channels/{contract,errors,registry}.js` plus `src/channels/fake/adapter.js`. Regression changes are limited to the five matching Stage 0–1 test files and this report. No network, filesystem migration, business delivery-path, or provider-specific branch was added.

## Concerns

None remaining.
