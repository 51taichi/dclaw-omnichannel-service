# Admin Bot Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify Bot maintenance by moving password changes into a list action Dialog and making the direct-entry action open and select the matching Bot.

**Architecture:** Keep the existing Bot access-key API and workspace-session flow. Replace only the admin presentation and event wiring: the maintenance panel retains debug reply settings, while a modal owns password entry and the list action continues passing `?bot=<botId>` to the existing console direct-selection handler.

**Tech Stack:** Static HTML, CSS, browser JavaScript, Node.js built-in test runner.

## Global Constraints

- Do not change the Bot access-key API, authentication, or message-processing behavior.
- Do not read or display an existing Bot password.
- Use the existing admin modal, icon, button, and toast visual conventions.
- “进入 Bot” must open the assigned workspace and select the requested Bot.

---

### Task 1: Bot Password Dialog

**Files:**
- Modify: `tests/admin-console-boundary.test.js`
- Modify: `public/admin/index.html`
- Modify: `public/admin/app.js`
- Modify: `public/admin/styles.css`

**Interfaces:**
- Consumes: existing `PUT /api/bots/:botId/access-key` admin endpoint.
- Produces: `openBotPasswordDialog(botId)`, `closeBotPasswordDialog()`, and the `botPasswordModal` form controls.

- [x] **Step 1: Write the failing boundary test**

Assert that the maintenance heading contains only `botMaintenanceName`, the old key card is absent, and the Bot row contains a key-icon “修改密码” action connected to an admin modal.

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/admin-console-boundary.test.js`
Expected: FAIL because the old key card and “系统维护 ·” heading still exist.

- [x] **Step 3: Implement the Dialog and action wiring**

Remove `adminBotAccessKeyForm` from the maintenance grid. Add an accessible modal with current Bot name, a new-password field, cancel button, and submit button. Store the selected Bot ID on open, call the existing access-key endpoint on submit, disable the form during save, close on success, and clear state on close.

- [x] **Step 4: Run the focused test**

Run: `node --test tests/admin-console-boundary.test.js`
Expected: PASS.

### Task 2: Direct Bot Entry

**Files:**
- Modify: `tests/admin-console-boundary.test.js`
- Modify: `public/admin/app.js`

**Interfaces:**
- Consumes: `openWorkspace(botId)` and console `openDirectBotFromUrl()`.
- Produces: a list action labeled “进入 Bot” that opens `/console/:slug?bot=:botId`.

- [x] **Step 1: Add a failing direct-entry assertion**

Assert that the action label is “进入 Bot”, uses the open icon, and passes the row Bot ID into `openWorkspace` so the target URL includes the encoded `bot` query parameter.

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/admin-console-boundary.test.js`
Expected: FAIL because the current copy is “进入配置”.

- [x] **Step 3: Implement the copy and icon change**

Change the action to “进入 Bot” with `adminIcon("open")`; preserve the assigned-workspace guard and existing `openWorkspace(botId)` call.

- [x] **Step 4: Verify all tests and repository cleanliness**

Run: `node --test`
Expected: all tests pass with zero failures.

Run: `git diff --check`
Expected: no output and exit code 0.
