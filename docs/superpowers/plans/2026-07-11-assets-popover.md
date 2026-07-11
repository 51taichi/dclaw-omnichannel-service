# Assets Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the conversation assets panel open as an overlay popover that does not affect chat layout.

**Architecture:** Keep the existing HTML location and JS toggle behavior, but change CSS so `.chat-view` is the positioning context and `.assets-panel` is absolutely positioned.

**Tech Stack:** Plain HTML, CSS, browser JavaScript, Node test runner.

## Global Constraints

- Do not change server APIs or asset data shape.
- Preserve existing asset icon toggle behavior.
- The asset panel must not participate in normal layout when visible.

---

### Task 1: Convert Assets Panel To Popover

**Files:**
- Modify: `public/console/styles.css`
- Modify: `tests/console-handoff-boundary.test.js`

**Interfaces:**
- Consumes: existing `#assetsPanel` element and `toggleAssetsPanel()`.
- Produces: `.assets-panel` popover style.

- [ ] **Step 1: Update tests**

Assert `.chat-view` has positioning context and `.assets-panel` uses absolute positioning.

- [ ] **Step 2: Run focused test**

Run: `npm test -- tests/console-handoff-boundary.test.js`

Expected: FAIL until CSS is updated.

- [ ] **Step 3: Update CSS**

Set `.chat-view { position: relative; }` if not already present. Set `.assets-panel` to `position: absolute`, anchored near the top right, with `z-index`, `max-height`, and internal scrolling.

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- tests/console-handoff-boundary.test.js
npm test
```

Expected: all tests pass.
