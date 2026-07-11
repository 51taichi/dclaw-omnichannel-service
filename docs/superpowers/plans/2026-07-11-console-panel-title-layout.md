# Console Panel Title Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove redundant panel titles from flow machine and proactive push panels, and move add-node beside the flow name.

**Architecture:** Adjust only console HTML/CSS and boundary tests. Existing JS element IDs and event listeners remain unchanged.

**Tech Stack:** Plain HTML, CSS, browser JavaScript, Node test runner.

## Global Constraints

- Do not change server APIs.
- Keep `#addFlowNodeButton` id unchanged.
- Keep proactive task query title unchanged.
- Keep existing form behavior unchanged.

---

### Task 1: Update Layout Tests

**Files:**
- Modify: `tests/console-handoff-boundary.test.js`

**Interfaces:**
- Consumes: console HTML/CSS text fixtures.
- Produces: assertions for title removal and adaptive push layout.

- [ ] Assert `#flowMachinePanel` no longer contains a section title.
- [ ] Assert `#addFlowNodeButton` exists inside the flow name row.
- [ ] Assert `#proactivePanel` no longer contains a section title.
- [ ] Assert proactive panel CSS contains adaptive height and scroll behavior.

### Task 2: Update Console Markup And Styles

**Files:**
- Modify: `public/console/index.html`
- Modify: `public/console/styles.css`

**Interfaces:**
- Consumes: existing form controls and button IDs.
- Produces: compact flow/proactive panel layout.

- [ ] Remove flow machine title header.
- [ ] Wrap flow name input and add-node button in a row.
- [ ] Remove proactive push title header.
- [ ] Add CSS for `flow-name-row`, proactive adaptive panel height, and scrollable proactive content.

### Task 3: Verify

Run:

```bash
npm test -- tests/console-handoff-boundary.test.js
npm test
node --check public/console/app.js
```

Expected: all pass.
