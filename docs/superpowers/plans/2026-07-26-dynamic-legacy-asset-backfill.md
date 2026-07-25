# Dynamic Legacy Asset Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect bounded legacy-history assets from every field dynamically configured across the selected Agent's task nodes.

**Architecture:** A pure `flow-assets` module owns dynamic field derivation and patch filtering. DClaw request construction exposes the full field union only for legacy analysis, while the server uses the same union to accept configured keys and preserve existing values during backfill. A persisted rollout timestamp makes old completed sessions eligible for one reanalysis without adding per-Agent hardcoded data.

**Tech Stack:** Node.js ESM, Express, SQLite `app_settings`, Node test runner.

## Global Constraints

- Asset field names come only from `machine.config.nodes[].collectFields`.
- No Agent workspace files are modified.
- Legacy reanalysis fills empty values only.
- Node completion and transition remain current-node scoped.
- Tests follow red-green TDD.

---

### Task 1: Dynamic Flow Asset Rules

**Files:**
- Create: `src/flow-assets.js`
- Create: `tests/flow-assets.test.js`

**Interfaces:**
- Produces: `listConfiguredFlowCollectFields(flow): string[]`
- Produces: `filterConfiguredCollectedDataPatch({ flow, patch, fillOnlyMissing }): object`

- [ ] **Step 1: Write failing tests**

Test that fields from multiple nodes are trimmed, deduplicated, and retained in
configuration order. Test that unknown keys and empty values are rejected, and
that `fillOnlyMissing` preserves existing non-empty session values.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/flow-assets.test.js`

Expected: FAIL because `src/flow-assets.js` does not exist.

- [ ] **Step 3: Implement the pure helpers**

Read `flow.machine.nodes`, derive the field union, and filter patches without
mutating the flow or Agent response.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/flow-assets.test.js`

Expected: all flow-assets tests pass.

### Task 2: Legacy Request Carries All Dynamic Fields

**Files:**
- Modify: `src/dclaw.js`
- Modify: `tests/dclaw-tags.test.js`

**Interfaces:**
- Consumes: `listConfiguredFlowCollectFields(flow)`
- Produces: legacy `flow.collectibleFields` and bounded
  `flow.session.collectedData`

- [ ] **Step 1: Write a failing cross-node request test**

Place `手机` on an earlier node while the current node collects another field.
Assert that the legacy request contains both fields and explicit instructions
to backfill only configured empty assets.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/dclaw-tags.test.js`

Expected: FAIL because the legacy payload only contains current-node fields.

- [ ] **Step 3: Implement the legacy-only payload**

Extend `compactFlowForAgent` with a legacy-analysis option. Include all dynamic
fields and current values only when bounded legacy history is present. Keep
normal requests unchanged.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/dclaw-tags.test.js`

Expected: all DClaw tag tests pass.

### Task 3: Server-Side Patch Authority And One-Time Reanalysis

**Files:**
- Modify: `src/server.js`
- Modify: `tests/server-legacy-history-boundary.test.js`
- Modify: `tests/server-tags-boundary.test.js`

**Interfaces:**
- Consumes: `filterConfiguredCollectedDataPatch`
- Uses: versioned `app_settings` rollout timestamp
- Preserves: `markLegacyHistoryContextSent`

- [ ] **Step 1: Write failing boundary tests**

Assert that `applyFlowDecision` filters the Agent patch through the shared
dynamic field helper and uses `fillOnlyMissing` for legacy analysis. Assert
that historical analysis eligibility includes sessions whose sent timestamp
predates the persisted rollout timestamp.

- [ ] **Step 2: Verify RED**

Run:
`node --test tests/server-legacy-history-boundary.test.js tests/server-tags-boundary.test.js`

Expected: FAIL because filtering and rollout eligibility are absent.

- [ ] **Step 3: Implement minimal server wiring**

Initialize one versioned rollout timestamp through `getSetting`/`setSetting`,
extend the legacy-analysis predicate, filter the patch before
`mergeFlowSessionData`, and pass the backfill flag from the coalesced request
path.

- [ ] **Step 4: Verify GREEN**

Run:
`node --test tests/server-legacy-history-boundary.test.js tests/server-tags-boundary.test.js`

Expected: all selected server tests pass.

### Task 4: Regression And Delivery

**Files:**
- Verify all modified production and test files.

- [ ] **Step 1: Run focused integration tests**

Run:
`node --test tests/flow-assets.test.js tests/dclaw-tags.test.js tests/server-legacy-history-boundary.test.js tests/server-tags-boundary.test.js`

- [ ] **Step 2: Run full regression**

Run: `npm test`

- [ ] **Step 3: Check syntax and patch hygiene**

Run: `node --check src/flow-assets.js`

Run: `node --check src/dclaw.js`

Run: `node --check src/server.js`

Run: `git diff --check`

- [ ] **Step 4: Commit and push**

Commit only the feature's files, absorb remote `main` changes with rebase when
the shared worktree is clean, rerun the full suite, and push to `origin/main`.
