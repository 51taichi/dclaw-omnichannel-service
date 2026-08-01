# Cockpit Report Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cockpit statistics auditable and daily reports useful when AI analysis fails, without changing or entering the core reply path.

**Architecture:** Keep aggregation, validation, AI analysis, and presentation as cockpit-only asynchronous stages. Validate immutable snapshots before report generation, produce deterministic fallback analysis on AI failure, and expose separate statistics and AI statuses in the cockpit UI.

**Tech Stack:** Node.js ESM, Express, SQLite, vanilla browser JavaScript, Node test runner.

## Global Constraints

- Do not modify inbound message handling, reply generation, reply prompts, or message sending behavior.
- Cockpit work remains asynchronous and reads only already committed business data.
- AI analysis failure must never fail or delay core Bot replies.
- Existing cockpit reports and API clients remain backward compatible.

---

### Task 1: Snapshot audit contract

**Files:**
- Create: `src/cockpit-audit.js`
- Test: `tests/cockpit-audit.test.js`

**Interfaces:**
- Produces: `auditCockpitSnapshot(snapshot): { status, checks, warnings }`.

- [ ] Write failing tests covering communication-outcome totals, node-share totals, negative metrics, and a valid snapshot.
- [ ] Run `node --test tests/cockpit-audit.test.js` and confirm failure.
- [ ] Implement a pure cockpit-only auditor with no database or reply dependencies.
- [ ] Run the audit tests and confirm they pass.

### Task 2: Deterministic fallback analysis and explicit statuses

**Files:**
- Modify: `src/cockpit-report-generator.js`
- Test: `tests/cockpit-report-generator.test.js`

**Interfaces:**
- Consumes: `auditCockpitSnapshot(snapshot)`.
- Produces: report summary fields `statisticsStatus` and `analysisStatus`; fallback analysis containing evidence-backed summary, problems, and actions.

- [ ] Add failing tests for verified statistics, invalid statistics rejection, AI success, and AI fallback.
- [ ] Run the focused report-generator tests and confirm failure.
- [ ] Generate deterministic Chinese fallback analysis when AI invocation fails.
- [ ] Preserve `ready`/`ready_with_ai_error` storage compatibility while adding explicit status fields.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Safe scheduled AI recovery

**Files:**
- Modify: `src/server.js`
- Test: `tests/server-cockpit-boundary.test.js`

**Interfaces:**
- Existing scheduled generator creates a new revision when the latest report for a snapshot has `analysisStatus: fallback`.
- A successful report for the same snapshot remains idempotent.

- [ ] Add a failing boundary test for retrying an AI-fallback report without rebuilding its snapshot.
- [ ] Run the focused server cockpit test and confirm failure.
- [ ] Adjust cockpit-only scheduled report selection to retry fallback reports safely.
- [ ] Run the focused test and confirm it passes.

### Task 4: User-facing status and copy

**Files:**
- Modify: `public/console/cockpit.js`
- Modify: `public/console/styles.css`
- Test: `tests/console-cockpit-boundary.test.js`

**Interfaces:**
- Displays Chinese statistics and AI status badges.
- Never exposes `ready_with_ai_error` as user-facing copy.
- Renames `等待中` to `待客户回复` with overlap guidance.

- [ ] Add failing console boundary assertions for the status labels, fallback copy, and renamed metric.
- [ ] Run the focused console test and confirm failure.
- [ ] Implement compact status badges and deterministic fallback content rendering.
- [ ] Run the focused test and confirm it passes.

### Task 5: Isolation and regression verification

**Files:**
- Test: existing cockpit and reply-boundary suites.

**Interfaces:**
- Core reply contracts remain unchanged.

- [ ] Run all cockpit tests.
- [ ] Run `tests/server-reply-contract.test.js`, inbound-coalescing, group-reply-policy, and agent-concurrency boundary tests.
- [ ] Run the complete test suite.
- [ ] Inspect `git diff` to verify no core reply-path source was modified outside the cockpit scheduler wiring.
- [ ] Commit the verified change on `main`.
