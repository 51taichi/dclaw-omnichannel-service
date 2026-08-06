# WorkTool Residue Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Remove obsolete WorkTool/WeCom artifacts and terminology from this repository while retaining only intentional Whapi migration-boundary documentation.

**Architecture:** Treat active runtime, scripts, configuration, UI, fixtures, and tests as the executable surface and make them provider-neutral or Whapi-specific. Delete superseded historical plans/specs, while retaining the current Whapi migration plan, current replacement design, cleanup documents, and the README safety boundary.

**Tech Stack:** Node.js ESM, built-in `node:test`, Express, SQLite, Git.

## Global Constraints

- Modify only `/Users/moxi/Desktop/codex space/agent create/dclaw-omnichannel-service`.
- Do not modify sibling projects, deployed services, databases, Docker resources, or external services.
- Preserve intentional WorkTool/WeCom mentions only in the README safety notice and current Whapi migration/replacement/cleanup documentation.
- The complete test suite must pass.

---

### Task 1: Remove obsolete provider artifacts

**Files:**
- Delete: `scripts/verify-wecom-contact-mapping.js`
- Delete: superseded WorkTool-specific files under `docs/superpowers/specs/`
- Delete: superseded WorkTool-specific files under `docs/superpowers/plans/`

**Interfaces:**
- Consumes: repository-wide search results.
- Produces: a repository with no obsolete executable provider script or misleading historical implementation instruction.

- [x] **Step 1: Inventory provider-specific filenames and contents**

Run:

```bash
find scripts docs/superpowers -type f -print | sort
rg -l -i 'worktool|wecom|wework|企业微信' scripts docs/superpowers
```

Expected: the WeCom verification script and older provider-specific plans/specs are listed.

- [x] **Step 2: Delete obsolete artifacts**

Delete the WeCom verification script and old plan/spec files whose described implementation depends on WorkTool/WeCom. Keep the current Whapi migration, replacement, and cleanup documents.

- [x] **Step 3: Verify no executable script imports removed providers**

Run:

```bash
rg -n -i 'worktool|wecom|wework|企业微信' scripts package.json
```

Expected: no matches.

### Task 2: Normalize active configuration and test fixtures

**Files:**
- Modify: `config/bots.example.json`
- Modify: matching files under `tests/`
- Modify: active files under `public/` if the audit finds provider-specific storage keys or copy.

**Interfaces:**
- Consumes: active Whapi channel contracts and existing provider-neutral naming.
- Produces: active examples and tests containing only Whapi or channel-neutral terminology.

- [x] **Step 1: Establish the failing static audit**

Run:

```bash
rg -n -i 'worktool|wecom|wework|企业微信|callback_secret|robot_id' config public scripts src tests package.json compose.yaml .env.example
```

Expected before cleanup: matches in example configuration, test names, fixture values, and negative legacy assertions.

- [x] **Step 2: Apply provider-neutral replacements**

Use these mappings where the value is only a test/example identifier:

```text
worktool-*                 -> omnichannel-*
WorkTool message           -> channel message
WorkTool reply/send        -> channel reply/send
worktool_console_*         -> dclaw_omnichannel_*
replace_with_worktool_bot_id -> replace_with_bot_id
```

Delete negative assertions that exist only to prove an already-deleted WorkTool route, constant, or command is absent. Preserve assertions for active Whapi authentication and Bot isolation.

- [x] **Step 3: Verify the active-surface audit**

Run the command from Step 1 again.

Expected: no matches.

### Task 3: Verify, document, and commit

**Files:**
- Modify: `docs/superpowers/plans/2026-08-06-worktool-residue-cleanup.md` checkbox state.

**Interfaces:**
- Consumes: cleaned repository.
- Produces: verified commit ready to push.

- [x] **Step 1: Review intentionally retained documentation matches**

Run:

```bash
rg -n -i --hidden --glob '!.git/**' 'worktool|wecom|wework|企业微信|callback_secret|robot_id' .
```

Expected: matches only in README and the current Whapi migration/replacement/cleanup documents.

- [x] **Step 2: Run syntax and full regression verification**

Run:

```bash
node --check src/server.js
node --check src/dclaw.js
node --check public/console/app.js
node --test
git diff --check
```

Expected: every command succeeds and the test summary contains zero failures.

- [x] **Step 3: Inspect and commit**

Run:

```bash
git status --short
git diff --stat
git add -A
git commit -m "chore: remove worktool repository residue"
```

Expected: one commit containing only files in this repository.
