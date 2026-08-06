# WorkTool Residue Cleanup Design

## Goal

Make this repository a clean Whapi.Cloud-only service without modifying any other project.

## Scope

- Delete obsolete WorkTool/WeCom scripts, fixtures, and provider-specific historical plans or designs.
- Rename active test descriptions, temporary paths, fixture identifiers, browser storage keys, and example configuration values that still use WorkTool/WeCom terminology.
- Remove obsolete WorkTool/WeCom negative assertions when they no longer protect a meaningful active boundary.
- Keep the current Whapi migration plan and replacement design. They may mention WorkTool/WeCom only where needed to explain the migration boundary, removed components, or incompatibility with the old service.
- Keep the README migration-boundary sentence for operational safety.

## Safety Boundary

All reads, edits, deletions, tests, and Git operations are limited to:

`/Users/moxi/Desktop/codex space/agent create/dclaw-omnichannel-service`

No sibling repository, deployed server, database, Docker resource, or external service is changed.

## Verification

1. Search the entire repository, excluding `.git`, for WorkTool/WeCom names and old environment-variable or callback identifiers.
2. Review every remaining match and allow only intentional migration-boundary documentation.
3. Run syntax checks and the complete Node test suite.
4. Run `git diff --check` and inspect the final diff before committing.

## Success Criteria

- No active source, script, configuration, UI, fixture, or test depends on or presents WorkTool/WeCom terminology.
- Remaining mentions exist only in the current Whapi migration documentation and README boundary notice.
- The full automated test suite passes.
