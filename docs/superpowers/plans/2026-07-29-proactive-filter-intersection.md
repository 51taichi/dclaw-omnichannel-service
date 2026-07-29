# Proactive Filter Intersection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make push-tab automatic filters use AND semantics and render a fixed, overflow-safe selected-recipient bar beside pagination.

**Architecture:** Introduce a pure browser module that intersects complete target maps for all active filters. Reconcile this automatic result with existing explicit manual selections, then render the final set in a fixed-height summary toolbar with an overlaid full-list popover.

**Tech Stack:** Browser ES modules, vanilla JavaScript, HTML, CSS, Node test runner.

## Global Constraints

- Do not change server APIs, send behavior, scheduling, or tabs outside Push.
- Preserve manual checkbox and all-private/all-group target selection.
- Keep pagination fixed on the right for zero, few, and many selected targets.
- Use test-first development and push the verified result to `main`.

---

### Task 1: Automatic Filter Intersection

**Files:**
- Create: `public/console/proactive-target-selection.js`
- Create: `tests/proactive-target-selection.test.js`
- Modify: `public/console/app.js`

**Interfaces:**
- Consumes: `Map<string, Map<string, Target>>` values stored in `state.proactiveTagSelections`.
- Produces: `intersectTargetMaps(targetMaps): Map<string, Target>`.

- [ ] **Step 1: Write failing pure behavior tests**

Add tests that pass two and three target maps and assert only keys present in
every map survive. Add an empty-filter test returning an empty map.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/proactive-target-selection.test.js
```

Expected: failure because `public/console/proactive-target-selection.js` does
not exist.

- [ ] **Step 3: Implement the pure intersection helper**

Create `intersectTargetMaps(targetMaps)` without mutating any input map. Use
the smallest map as the iteration base and retain a key only when every map
contains it.

- [ ] **Step 4: Reconcile automatic selections in the console**

Import the helper into `app.js`. Store each filter's fetched targets as a map,
replace union-preservation helpers with one reconciliation function, and call
it after adding, removing, or replacing a date/tag filter. Preserve targets in
`proactiveManualTargetKeys` as explicit additions.

- [ ] **Step 5: Run the focused test and relevant console tests**

Run:

```bash
node --test tests/proactive-target-selection.test.js tests/console-proactive-scheduling-boundary.test.js tests/console-session-type-boundary.test.js
```

Expected: all tests pass after boundary assertions are updated in Task 2.

### Task 2: Stable Selected Target Toolbar

**Files:**
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Modify: `tests/console-handoff-boundary.test.js`
- Modify: `tests/console-proactive-scheduling-boundary.test.js`
- Modify: `tests/console-session-type-boundary.test.js`

**Interfaces:**
- Consumes: `getSelectedTargets()`.
- Produces: fixed `#selectedTargetsSummary`, preview chips, `+N`, and
  `#selectedTargetsPopover`.

- [ ] **Step 1: Replace the obsolete no-chip boundary test**

Assert that the Push panel contains one selected-target row before the message
composer, the app renders count/preview/overflow states, and CSS fixes the row
height with hidden overflow and an absolute bounded popover.

- [ ] **Step 2: Run boundary tests and verify RED**

Run:

```bash
node --test tests/console-handoff-boundary.test.js tests/console-proactive-scheduling-boundary.test.js tests/console-session-type-boundary.test.js
```

Expected: failures because the selected-target toolbar does not exist.

- [ ] **Step 3: Add stable HTML structure**

Wrap the selected summary and existing pagination in
`.target-selection-row`. Add accessible count, preview, overflow, and popover
elements before `#proactiveMessageFields`.

- [ ] **Step 4: Render zero, few, and many selections**

Update `renderSelectedTargets()` to keep the count visible, render at most
three preview chips, show `+N` for overflow, render the complete popover list,
and close the popover when empty. Add click, outside-click, and Escape
handlers.

- [ ] **Step 5: Add fixed responsive styling**

Use a 40px grid row with `minmax(0, 1fr) auto`, keep pagination right-aligned,
prevent chip wrapping, and absolutely position the bounded scrollable popover.
At narrow widths, hide preview names before pagination can move.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
node --test tests/proactive-target-selection.test.js tests/console-handoff-boundary.test.js tests/console-proactive-scheduling-boundary.test.js tests/console-session-type-boundary.test.js
```

Expected: all focused tests pass.

### Task 3: Regression And Visual Verification

**Files:**
- Verify only; no planned production edits.

**Interfaces:**
- Consumes: completed implementation.
- Produces: verified commit on `main`.

- [ ] **Step 1: Run all tests**

```bash
npm test
```

- [ ] **Step 2: Check formatting and accidental changes**

```bash
git diff --check
git status --short
```

- [ ] **Step 3: Verify desktop and narrow layouts**

Capture the Push tab with zero, few, and many targets. Confirm the selected
row remains 40px, pagination does not move, chips do not wrap, and the full
list scrolls in an overlay.

- [ ] **Step 4: Commit and push**

```bash
git add docs/superpowers/specs/2026-07-29-proactive-filter-intersection-design.md \
  docs/superpowers/plans/2026-07-29-proactive-filter-intersection.md \
  public/console/proactive-target-selection.js \
  public/console/app.js \
  public/console/index.html \
  public/console/styles.css \
  tests/proactive-target-selection.test.js \
  tests/console-handoff-boundary.test.js \
  tests/console-proactive-scheduling-boundary.test.js \
  tests/console-session-type-boundary.test.js
git commit -m "Fix proactive filter intersection"
git push origin main
```
