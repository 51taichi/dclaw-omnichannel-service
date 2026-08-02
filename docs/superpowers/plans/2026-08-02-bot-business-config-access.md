# Bot Business Config Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the workspace Config tab available to every unlocked Bot session, restore Bot password management in both consoles, and limit tag-sync schedule options to 00:00-06:00.

**Architecture:** Reuse the existing Bot-scoped session token for all workspace business configuration routes. Keep administrator-only destructive and global maintenance routes unchanged. The workspace and admin consoles will share the existing access-key endpoint, while the workspace presents its own compact card.

**Tech Stack:** Node.js, Express, browser JavaScript, HTML, CSS, Node test runner.

## Global Constraints

- An unlocked Bot session can view and operate every workspace tab, including Config.
- Bot password changes are allowed through both workspace and administrator consoles.
- Administrator password and global maintenance permissions remain unchanged.
- Tag synchronization schedule options range from 00:00 through 06:00 in 15-minute steps.
- Existing inbound message, Agent invocation, and reply behavior must remain unchanged.

---

### Task 1: Define the new access boundary

**Files:**
- Modify: `tests/console-auth-boundary.test.js`
- Modify: `tests/server-auth-boundary.test.js`
- Modify: `tests/server-global-admin-boundary.test.js`

- [ ] Add assertions that Config is never hidden for an unlocked Bot role and that business configuration routes use `assertBotAccess`.
- [ ] Add assertions that the access-key route accepts Bot-scoped access while global Bot binding and deletion routes remain administrator-only.
- [ ] Run the focused tests and confirm they fail on the old administrator checks.

### Task 2: Apply Bot-scoped business permissions

**Files:**
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Modify: `src/server.js`

- [ ] Remove Config-specific role hiding, disabling, and navigation rejection.
- [ ] Load all Config forms for either `bot` or `admin` unlocked roles.
- [ ] Replace administrator checks with `assertBotAccess` only for workspace business config and Bot password routes.
- [ ] Keep deletion, binding, Agent management, and administrator password routes unchanged.
- [ ] Run focused authorization tests until green.

### Task 3: Restore workspace Bot password management

**Files:**
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Modify: `tests/console-auth-boundary.test.js`

- [ ] Add a collapsible Bot password panel to Config with an icon, password input, and primary save action.
- [ ] Submit the new password through the existing Bot-scoped request helper.
- [ ] Clear the field after success and retain the current session until the user locks or it expires.
- [ ] Run the focused console test until green.

### Task 4: Restrict synchronization hours

**Files:**
- Modify: `public/console/app.js`
- Modify: `src/tag-sync.js`
- Modify: `tests/console-tag-sync-boundary.test.js`
- Modify: `tests/tag-sync.test.js`

- [ ] Assert that browser options contain only 00:00-06:00 labels and no `次日`, `22:00`, or `23:00` entries.
- [ ] Assert that server normalization accepts forward ranges inside 00:00-06:00 and rejects values outside that range.
- [ ] Implement the matching client option builder and server validation.
- [ ] Run focused tag-sync tests until green.

### Task 5: Verify and publish

**Files:**
- Verify all modified files.

- [ ] Run `git diff --check`.
- [ ] Run `npm test` and require zero failures.
- [ ] Review the diff to ensure no unrelated backend changes are staged.
- [ ] Commit the scoped files and push `main` to `origin`.
