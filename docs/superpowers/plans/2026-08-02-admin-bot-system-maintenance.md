# Admin Bot System Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Bot access-key maintenance and debug auto-reply configuration from the workspace console to the administrator Bots page.

**Architecture:** Keep the existing Bot-scoped service APIs unchanged. The administrator client owns a selected Bot maintenance context, loads debug configuration with a request-version guard, and submits access-key and debug changes independently; the workspace console stops rendering and requesting both system settings.

**Tech Stack:** Static HTML, CSS, browser JavaScript, Node.js test runner.

## Global Constraints

- Do not modify service routes, database code, message handling, debug matching, or reply ordering.
- Continue using the existing Bot access-key and debug-reply endpoints.
- Never read or display an existing Bot access key.
- Clear stale maintenance state before loading another Bot.
- Keep administrator controls icon-labelled and consistent with existing admin forms.

---

### Task 1: Define the ownership boundary

**Files:**
- Modify: `tests/admin-console-boundary.test.js`
- Modify: `tests/console-auth-boundary.test.js`
- Modify: `tests/console-debug-reply-boundary.test.js`

**Interfaces:**
- Consumes: administrator and workspace HTML, JavaScript, and CSS.
- Produces: failing assertions for admin-owned Bot maintenance and the absence of workspace-owned system controls.

- [ ] **Step 1: Add failing administrator ownership tests**

Assert that the Bots panel contains `botMaintenancePanel`, `adminBotAccessKeyForm`, and `adminDebugReplyForm`; that the administrator client calls the two existing Bot APIs; and that `selectBotForEditing(botId)` loads maintenance by selected Bot ID.

- [ ] **Step 2: Add failing workspace removal tests**

Assert that workspace HTML does not contain `accessKeyPanel`, `accessKeyForm`, `debugPanel`, or `debugReplyForm`, and workspace JavaScript no longer contains the access-key or debug-reply endpoints.

- [ ] **Step 3: Verify RED**

Run `node --test tests/admin-console-boundary.test.js tests/console-auth-boundary.test.js tests/console-debug-reply-boundary.test.js`.

Expected: FAIL because both controls still belong to the workspace and the administrator maintenance panel does not exist.

### Task 2: Add administrator Bot maintenance

**Files:**
- Modify: `public/admin/index.html`
- Modify: `public/admin/app.js`
- Modify: `public/admin/styles.css`

**Interfaces:**
- Consumes: `adminRequest(path, options)`, administrator session header injection, and Bot records in `state.bots`.
- Produces: `selectBotForEditing(botId)`, `clearBotMaintenance()`, `loadBotMaintenance(botId)`, `saveBotAccessKey(event)`, and `saveAdminDebugReply(event)`.

- [ ] **Step 1: Add the hidden maintenance panel**

Place `#botMaintenancePanel` below the Bot base form. Add a password form with `name="accessKey"`, and a debug form with `enabled`, `trigger`, and `reply`. Include icons in every label and button.

- [ ] **Step 2: Add selected-Bot state and stale-request protection**

Add `selectedBotId` and `debugReplyLoadVersion` to administrator state. Clearing maintenance increments the version, hides the panel, clears the key, resets debug fields to `ping` and `pong`, and disables save operations until a Bot is selected.

- [ ] **Step 3: Load maintenance from the Edit action**

Replace inline edit-field assignment with `selectBotForEditing(botId)`. It fills the base form, exposes the panel, clears previous values, and requests the selected Bot debug setting. Ignore a response when its request version or selected Bot no longer matches.

- [ ] **Step 4: Save each system setting independently**

`saveBotAccessKey(event)` requires a selected Bot and non-empty new key, submits the existing access-key request, then clears the password. `saveAdminDebugReply(event)` submits the enabled flag, trigger, and reply to the existing debug-reply request.

- [ ] **Step 5: Preserve context after saving the base Bot**

Use the returned binding Bot ID, reload global data, and reselect the saved Bot. If the Bot ID input diverges from the selected Bot, clear maintenance context to prevent editing the wrong Bot.

- [ ] **Step 6: Style two compact maintenance cards**

Use a responsive two-column grid on desktop and one column below 760px. Keep password and debug operations visually separate with independent actions and loading-disabled states.

### Task 3: Remove system maintenance from the workspace

**Files:**
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`

**Interfaces:**
- Consumes: the current workspace configuration tab.
- Produces: a business-only workspace configuration page with no Bot key or debug auto-reply state.

- [ ] **Step 1: Remove both visible modules**

Delete `#debugPanel`, `#debugReplyForm`, `#accessKeyPanel`, and `#accessKeyForm` from workspace HTML.

- [ ] **Step 2: Remove workspace client ownership**

Delete element bindings, debug load-version state, clear/reset behavior, debug load/save functions, access-key save function, endpoint strings, role visibility toggles, and form event listeners.

- [ ] **Step 3: Keep remaining Bot lifecycle intact**

Update loader boundaries so Agent loading proceeds directly to remaining business configuration. Verify Bot switching, locking, and admin config-tab visibility still use their existing flow.

### Task 4: Verify and integrate

**Files:**
- Verify all modified files.

**Interfaces:**
- Consumes: repository test suite and Git history.
- Produces: one scoped implementation commit pushed to `origin/main`.

- [ ] **Step 1: Run focused tests**

Run `node --test tests/admin-console-boundary.test.js tests/console-auth-boundary.test.js tests/console-debug-reply-boundary.test.js`.

Expected: PASS.

- [ ] **Step 2: Run syntax and full regression checks**

Run `node --check public/admin/app.js`, `node --check public/console/app.js`, and `npm test`.

Expected: all tests pass.

- [ ] **Step 3: Review and commit only scoped files**

Run `git diff --check` and `git status --short`, then commit the admin UI, workspace UI, boundary tests, and this plan as `Move Bot maintenance to admin console`.

- [ ] **Step 4: Rebase and push safely**

Fetch `origin/main`, rebase, rerun `npm test`, and push `main`.
