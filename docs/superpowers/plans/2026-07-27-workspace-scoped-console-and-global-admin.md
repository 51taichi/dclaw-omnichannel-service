# Workspace-Scoped Console and Global Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add URL-scoped workspace Bot lists and a separate singleton global-admin console without changing existing Bot permissions or business behavior.

**Architecture:** Keep `bot_id` as the only business-data boundary. Add focused admin-auth and workspace domain modules around new SQLite records, wire their routes into the existing Express server, and put the new global management UI in `/admin/`. The existing `/console/:slug` frontend gains only a workspace entry gate and workspace-filtered Bot source; all Bot unlock, role, conversation, task, tag, push, log, callback, and worker behavior remains intact.

**Tech Stack:** Node.js ES modules, Express 5, `node:sqlite` `DatabaseSync`, `node:crypto`, browser-native JavaScript, HTML/CSS, Node test runner, Superpowers image generation/editing workflow.

## Global Constraints

- A Bot belongs to zero or one workspace; a workspace can contain multiple Bots.
- Workspace access only filters visible Bots and never grants Bot business access.
- Bot passwords, 8-hour Bot sessions, `bot`/`admin` roles, and all current business APIs keep their existing behavior.
- `/api/public/bots` remains public with unchanged response semantics.
- `/console/:slug` is the only employee entry; `/console/` redirects to `/admin/`.
- Workspace slugs are 3-32 lowercase letters, digits, or hyphens and reject reserved names.
- Workspace sessions have a fixed, non-rolling 30-day lifetime.
- The singleton administrator username is always `admin`; no administrator-account CRUD is added.
- The first upgraded startup initializes the database admin password once from `ADMIN_API_KEY`; later logins use only the database hash.
- Admin page sessions remain in memory for 8 hours and expire on restart or logout.
- The employee-facing console must not display the fixed concepts “部门”, “组织”, or “工作区”.
- Login success shows the happy mascot and a complete 3-second countdown before navigation.
- Existing callbacks, Agent invocation, message persistence, activations, tags, assets, proactive sends, actions, and workers must not be modified.
- Use the existing `deepmega-dclaw-logo.png`; generate optimized transparent PNG derivatives for all three mascot states.

---

## File Structure

### New backend files

- `src/admin-auth.js`: singleton admin credential bootstrap, password verification/change, and in-memory admin sessions.
- `src/workspaces.js`: slug validation, workspace mutations, phrase verification, persistent workspace sessions, and public workspace views.
- `scripts/reset-admin-password.js`: interactive SSH password recovery command.

### New frontend files

- `public/shared/auth-shell.js`: reusable idle/failure/success login shell and 3-second countdown.
- `public/shared/auth-shell.css`: shared login layout, Logo sizing, mascot sizing, and responsive rules.
- `public/shared/assets/auth-question.png`: transparent initial mascot.
- `public/shared/assets/auth-failure.png`: transparent failure mascot without original Logo/text.
- `public/shared/assets/auth-success.png`: transparent success mascot.
- `public/admin/index.html`: independent global-admin page.
- `public/admin/app.js`: admin authentication, workspaces, Bots, Agents, system settings, and assignment UI.
- `public/admin/styles.css`: admin-specific layout layered over the current console styles.
- `public/console/workspace-entry.js`: workspace slug/session gate and workspace Bot loader.

### Modified backend files

- `src/db.js`: new tables, indexes, admin credential persistence, workspace persistence, assignments, and workspace-session queries.
- `src/server.js`: database-backed global admin checks, admin/workspace endpoints, shared/admin static routes, and console route behavior.
- `src/auth.js`: no Bot-session semantic changes; only shared hash utility use if required.
- `package.json`: add `admin:reset-password`.

### Modified existing frontend files

- `public/console/index.html`: load workspace entry/auth shell, remove Agent maintenance UI, preserve Agent selection in Bot binding.
- `public/console/app.js`: load workspace-filtered Bots and defer startup until workspace authentication; retain all Bot-scoped behavior.
- `public/console/styles.css`: only minimal entry-gate integration if shared styles cannot cover it.

### Tests

- `tests/db-admin-credential.test.js`
- `tests/admin-auth.test.js`
- `tests/db-workspaces.test.js`
- `tests/workspace-auth.test.js`
- `tests/server-global-admin-boundary.test.js`
- `tests/server-workspace-boundary.test.js`
- `tests/auth-shell-boundary.test.js`
- `tests/admin-console-boundary.test.js`
- `tests/console-workspace-boundary.test.js`
- Update `tests/server-auth-boundary.test.js`
- Update `tests/console-auth-boundary.test.js`
- Update `tests/bot-auth.test.js` only if a shared hash helper signature changes.

---

### Task 1: Persist and Authenticate the Singleton Global Administrator

**Files:**
- Create: `src/admin-auth.js`
- Create: `scripts/reset-admin-password.js`
- Create: `tests/db-admin-credential.test.js`
- Create: `tests/admin-auth.test.js`
- Modify: `src/db.js`
- Modify: `package.json`

**Interfaces:**
- Produces from `src/db.js`:
  - `getGlobalAdminCredential(): { username, passwordHash, createdAt, updatedAt } | null`
  - `initializeGlobalAdminCredential({ passwordHash }): { initialized, credential }`
  - `updateGlobalAdminCredential({ passwordHash }): credential`
- Produces from `src/admin-auth.js`:
  - `initializeAdminAuth({ bootstrapPassword }): { ready, initialized, reason }`
  - `verifyAdminPassword(password): boolean`
  - `createAdminSession({ ttlMs?, nowMs? }): { token, role, expiresAt }`
  - `getAdminSession(token, { nowMs? }?): session | null`
  - `deleteAdminSession(token): boolean`
  - `deleteAllAdminSessions(): number`
  - `changeAdminPassword(password): credential`
- Consumed later by `src/server.js` and the reset script.

- [ ] **Step 1: Write failing database credential tests**

```js
test("global admin credential initializes once and never stores plaintext", () => {
  const first = db.initializeGlobalAdminCredential({
    passwordHash: auth.hashAccessKey("first-secret")
  });
  const second = db.initializeGlobalAdminCredential({
    passwordHash: auth.hashAccessKey("replacement-secret")
  });

  assert.equal(first.initialized, true);
  assert.equal(second.initialized, false);
  assert.equal(auth.verifyAccessKey("first-secret", db.getGlobalAdminCredential().passwordHash), true);
  assert.equal(db.getGlobalAdminCredential().passwordHash.includes("first-secret"), false);
});
```

Also assert `updateGlobalAdminCredential()` replaces the hash and keeps `username === "admin"`.

- [ ] **Step 2: Run the database test and verify the schema/API is missing**

Run:

```bash
node --test tests/db-admin-credential.test.js
```

Expected: FAIL because the credential functions do not exist.

- [ ] **Step 3: Add the singleton credential table and persistence functions**

Add to the startup schema in `src/db.js`:

```sql
CREATE TABLE IF NOT EXISTS global_admin_credentials (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  username TEXT NOT NULL DEFAULT 'admin',
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Use `INSERT OR IGNORE` for one-time initialization and `UPDATE ... WHERE singleton_id = 1` for password changes. Never persist the plaintext password.

- [ ] **Step 4: Run the database test and verify it passes**

Run:

```bash
node --test tests/db-admin-credential.test.js
```

Expected: PASS.

- [ ] **Step 5: Write failing admin-auth lifecycle tests**

```js
test("admin auth bootstraps once, creates 8 hour sessions, and invalidates them on password change", () => {
  const initialized = adminAuth.initializeAdminAuth({ bootstrapPassword: "env-secret" });
  assert.equal(initialized.ready, true);
  assert.equal(adminAuth.verifyAdminPassword("env-secret"), true);

  const session = adminAuth.createAdminSession({ ttlMs: 1000, nowMs: 100 });
  assert.equal(adminAuth.getAdminSession(session.token, { nowMs: 500 }).role, "admin");
  assert.equal(adminAuth.getAdminSession(session.token, { nowMs: 1101 }), null);

  const active = adminAuth.createAdminSession({ nowMs: 200 });
  adminAuth.changeAdminPassword("database-secret");
  assert.equal(adminAuth.getAdminSession(active.token), null);
  assert.equal(adminAuth.verifyAdminPassword("database-secret"), true);
  assert.equal(adminAuth.verifyAdminPassword("env-secret"), false);
});
```

Add a test showing that an already initialized database is not overwritten by a different bootstrap password.

- [ ] **Step 6: Run the auth tests and verify they fail**

Run:

```bash
node --test tests/admin-auth.test.js
```

Expected: FAIL because `src/admin-auth.js` does not exist.

- [ ] **Step 7: Implement admin bootstrap, verification, sessions, and password changes**

Use `hashAccessKey()`/`verifyAccessKey()` for password hashes and `crypto.randomUUID()` for session tokens. Keep sessions in a module-local `Map`.

```js
const adminSessions = new Map();
const defaultAdminSessionTtlMs =
  Number(process.env.ADMIN_SESSION_TTL_HOURS || 8) * 60 * 60 * 1000;
```

`initializeAdminAuth()` returns `{ ready: false, initialized: false, reason: "admin password is not initialized" }` when the database is empty and no bootstrap password exists. It must not throw in a way that stops workers from starting.

- [ ] **Step 8: Add and test the SSH reset command**

Add:

```json
"admin:reset-password": "node scripts/reset-admin-password.js"
```

The script must:

1. Read a hidden or non-echoed password where terminal support allows it.
2. Ask for confirmation.
3. Reject empty/mismatched values.
4. Initialize the singleton credential when the database is empty; otherwise call `changeAdminPassword()`.
5. Print only a success/failure message, never the password.

Test both the empty-database recovery path and reusable password-change function in `tests/admin-auth.test.js`; add a source-boundary assertion that the script never logs the submitted value.

- [ ] **Step 9: Run focused tests**

Run:

```bash
node --test tests/db-admin-credential.test.js tests/admin-auth.test.js tests/bot-auth.test.js
```

Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add src/db.js src/admin-auth.js scripts/reset-admin-password.js package.json tests/db-admin-credential.test.js tests/admin-auth.test.js
git commit -m "Add singleton global admin authentication"
```

---

### Task 2: Add Workspace Persistence, Assignment, and Phrase Sessions

**Files:**
- Create: `src/workspaces.js`
- Create: `tests/db-workspaces.test.js`
- Create: `tests/workspace-auth.test.js`
- Modify: `src/db.js`

**Interfaces:**
- Produces from `src/db.js`:
  - `insertWorkspace(record)`
  - `updateWorkspaceRecord(record)`
  - `getWorkspaceById(id)`
  - `getWorkspaceBySlug(slug)`
  - `listWorkspaces()`
  - `deleteWorkspaceRecord(id)`
  - `assignBotsToWorkspace({ workspaceId, botIds })`
  - `unassignBotFromWorkspace({ workspaceId, botId })`
  - `transferBotToWorkspace({ botId, targetWorkspaceId })`
  - `listWorkspaceBots(workspaceId)`
  - `listUnassignedBotBindings()`
  - `insertWorkspaceSession(record)`
  - `getWorkspaceSessionByTokenHash(tokenHash)`
  - `deleteWorkspaceSessionByTokenHash(tokenHash)`
  - `deleteWorkspaceSessions(workspaceId)`
- Produces from `src/workspaces.js`:
  - `createWorkspace(input)`
  - `updateWorkspace(id, input)`
  - `removeWorkspace(id)`
  - `getWorkspaceChallenge(slug)`
  - `unlockWorkspace({ slug, response, ttlMs?, nowMs? })`
  - `createWorkspaceSessionForAdmin(workspaceId, options?)`
  - `resolveWorkspaceSession(token, options?)`
  - `logoutWorkspace(token)`
  - `workspaceSessionTokenHash(token)`
  - `normalizeWorkspaceSlug(value)`
- Consumed later by workspace/admin HTTP routes.

- [ ] **Step 1: Write failing workspace persistence tests**

Create two Bots, two workspaces, and assert:

```js
db.assignBotsToWorkspace({ workspaceId: first.id, botIds: ["bot_a"] });

assert.deepEqual(
  db.listWorkspaceBots(first.id).map((bot) => bot.botId),
  ["bot_a"]
);
assert.throws(
  () => db.assignBotsToWorkspace({ workspaceId: second.id, botIds: ["bot_a"] }),
  /already assigned/
);
```

Also assert:

- Multi-select assignment is transactional.
- Transfer moves the mapping without changing the Bot binding.
- Unassign/delete workspace preserves the Bot binding and its business rows.
- `deleteBotData(botId)` removes a stale `workspace_bots` mapping.

- [ ] **Step 2: Run persistence tests and verify they fail**

Run:

```bash
node --test tests/db-workspaces.test.js
```

Expected: FAIL because workspace tables/functions do not exist.

- [ ] **Step 3: Add workspace tables, indexes, row mapping, and transactional functions**

Add:

```sql
CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  challenge_text TEXT NOT NULL,
  response_hash TEXT NOT NULL,
  auth_version INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_bots (
  workspace_id INTEGER NOT NULL,
  bot_id TEXT NOT NULL UNIQUE,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, bot_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS workspace_sessions (
  token_hash TEXT PRIMARY KEY,
  workspace_id INTEGER NOT NULL,
  auth_version INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_sessions_expiry
ON workspace_sessions (expires_at);
```

Use explicit transactions for assignment, transfer, and workspace deletion because SQLite foreign-key enforcement is not assumed.

- [ ] **Step 4: Run persistence tests and verify they pass**

Run:

```bash
node --test tests/db-workspaces.test.js
```

Expected: PASS.

- [ ] **Step 5: Write failing workspace-domain tests**

Test slug rules:

```js
assert.equal(workspaces.normalizeWorkspaceSlug("sales-east"), "sales-east");
for (const invalid of ["ABCD", "中文", "a", "admin", "api", "has space", "a/b"]) {
  assert.throws(() => workspaces.normalizeWorkspaceSlug(invalid));
}
```

Test phrase/session behavior:

```js
const workspace = workspaces.createWorkspace({
  name: "鲸小助",
  slug: "jingxiaozhu",
  challengeText: "我们的目标是",
  response: "没有烦恼"
});
const unlocked = workspaces.unlockWorkspace({
  slug: workspace.slug,
  response: "没有烦恼",
  ttlMs: 1000,
  nowMs: 100
});

assert.equal(workspaces.resolveWorkspaceSession(unlocked.token, { nowMs: 500 }).workspace.id, workspace.id);
assert.equal(workspaces.resolveWorkspaceSession(unlocked.token, { nowMs: 1101 }), null);
assert.throws(() => workspaces.unlockWorkspace({ slug: workspace.slug, response: "答错了" }), /invalid phrase/);
```

Also assert:

- The database never contains the plaintext response.
- Updating only `name` does not invalidate sessions.
- Updating slug, challenge, or response increments `authVersion` and invalidates old sessions.
- Disabling a workspace invalidates access immediately.
- Admin-created workspace sessions use the same persisted 30-day token format.

- [ ] **Step 6: Run the domain tests and verify they fail**

Run:

```bash
node --test tests/workspace-auth.test.js
```

Expected: FAIL because `src/workspaces.js` does not exist.

- [ ] **Step 7: Implement workspace validation and session orchestration**

Use:

```js
const WORKSPACE_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RESERVED_SLUGS = new Set(["admin", "api", "assets", "public", "uploads", "console"]);
```

Hash phrase responses with `hashAccessKey()`. Hash random session tokens with SHA-256 before persistence:

```js
export function workspaceSessionTokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}
```

`resolveWorkspaceSession()` must verify expiration, workspace enabled state, and matching `authVersion`. Invalid rows are deleted and return `null`.

- [ ] **Step 8: Run focused tests**

Run:

```bash
node --test tests/db-workspaces.test.js tests/workspace-auth.test.js
```

Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add src/db.js src/workspaces.js tests/db-workspaces.test.js tests/workspace-auth.test.js
git commit -m "Add workspace persistence and phrase sessions"
```

---

### Task 3: Wire Global Admin and Workspace HTTP APIs Without Changing Business Routes

**Files:**
- Create: `tests/server-global-admin-boundary.test.js`
- Create: `tests/server-workspace-boundary.test.js`
- Modify: `tests/server-auth-boundary.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes Task 1 admin-auth functions.
- Consumes Task 2 workspace-domain and database functions.
- Produces the admin/workspace routes defined in the design spec.
- Existing business routes continue to consume `assertBotAccess()` and `assertAdminForBot()` unchanged at call sites.

- [ ] **Step 1: Write failing global-admin server boundary tests**

Assert `src/server.js` contains:

```js
[
  '"/api/admin/login"',
  '"/api/admin/logout"',
  '"/api/admin/session"',
  '"/api/admin/password"',
  '"x-admin-session-token"'
]
```

Also assert:

- `isAdminKey()` calls `verifyAdminPassword()` and no longer compares to `process.env.ADMIN_API_KEY`.
- `/api/bots/:botId/unlock` uses `verifyAdminPassword(key)`.
- `assertAdminAccess()` and `assertAdminForBot()` accept a valid admin session.
- Workspace transfer/removal routes never call `deleteBotSession()` or `deleteBotSessionsForBot()`.
- Bootstrap failure is logged but does not occur inside callback/worker startup.

- [ ] **Step 2: Write failing workspace route boundary tests**

Assert routes for:

```text
GET    /api/admin/workspaces
POST   /api/admin/workspaces
GET    /api/admin/workspaces/:id
PUT    /api/admin/workspaces/:id
DELETE /api/admin/workspaces/:id
POST   /api/admin/workspaces/:id/bots
DELETE /api/admin/workspaces/:id/bots/:botId
POST   /api/admin/workspaces/:id/bots/:botId/transfer
POST   /api/admin/workspaces/:id/session

GET    /api/workspaces/:slug/challenge
POST   /api/workspaces/:slug/unlock
POST   /api/workspaces/:slug/logout
GET    /api/workspaces/:slug/bots
```

The admin-only session endpoint is the implementation of “打开工作区时跳过口令”; it returns a standard workspace token for the selected workspace.

Assert the Bot-list route applies `publicBotView()` and does not call `listBotBindings()` directly in its response.

- [ ] **Step 3: Run boundary tests and verify they fail**

Run:

```bash
node --test tests/server-global-admin-boundary.test.js tests/server-workspace-boundary.test.js tests/server-auth-boundary.test.js
```

Expected: FAIL on missing routes and database-backed admin checks.

- [ ] **Step 4: Initialize admin auth without blocking business startup**

After database imports and before admin requests are served:

```js
const adminAuthState = initializeAdminAuth({
  bootstrapPassword: process.env.ADMIN_API_KEY
});
if (!adminAuthState.ready) {
  logWarn("admin_auth.not_ready", { reason: adminAuthState.reason });
}
```

Do not throw from this path. Callback secrets and all worker initialization remain independent.

- [ ] **Step 5: Replace only global-admin credential checks**

Implement:

```js
function getRequestAdminSession(req) {
  return getAdminSession(req.header("x-admin-session-token"));
}

function isAdminKey(req) {
  return verifyAdminPassword(getRequestAdminKey(req));
}
```

Extend `assertAdminAccess()` and `assertAdminForBot()` to accept the admin session. Do not change `assertBotAccess()` Bot-session matching or any business route declaration.

- [ ] **Step 6: Add administrator routes**

Use these response shapes:

```json
{
  "ok": true,
  "session": {
    "token": "uuid",
    "role": "admin",
    "expiresAt": "ISO-8601"
  }
}
```

`PUT /api/admin/password` accepts:

```json
{ "password": "new password" }
```

It changes the hash, clears all admin sessions, and returns `{ "ok": true, "reauthenticate": true }`. The caller must log in again.

- [ ] **Step 7: Add workspace management and entry routes**

Use consistent error codes:

- `400`: invalid slug/body.
- `401`: invalid phrase/session/admin session.
- `404`: unknown workspace.
- `409`: duplicate slug or Bot already assigned.
- `423`: disabled workspace.

Workspace Bot list:

```js
const session = assertWorkspaceAccess(req, req.params.slug);
const bots = listWorkspaceBots(session.workspace.id).map(publicBotView);
res.json({ ok: true, workspace: session.publicWorkspace, bots });
```

Never include `responseHash`, Agent API keys, or Bot access-key hashes.

- [ ] **Step 8: Add static route behavior and allowed headers**

Before the existing console static middleware:

```js
app.get("/console", (req, res) => res.redirect(302, "/admin/"));
app.get("/console/", (req, res) => res.redirect(302, "/admin/"));
app.get(/^\/console\/[^/]+\/$/, (req, res) => res.redirect(302, req.path.slice(0, -1)));
app.use("/shared", express.static(path.join(publicDir, "shared")));
app.use("/admin", express.static(path.join(publicDir, "admin")));
app.use("/console", express.static(path.join(publicDir, "console")));
app.get(/^\/console\/[^/]+$/, (req, res) => {
  res.sendFile(path.join(publicDir, "console", "index.html"));
});
```

Add `x-admin-session-token` and `x-workspace-session-token` to the allowed browser headers without removing existing headers.

- [ ] **Step 9: Run focused server tests**

Run:

```bash
node --test tests/server-global-admin-boundary.test.js tests/server-workspace-boundary.test.js tests/server-auth-boundary.test.js tests/server-bot-isolation-boundary.test.js tests/bot-auth.test.js
```

Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add src/server.js tests/server-global-admin-boundary.test.js tests/server-workspace-boundary.test.js tests/server-auth-boundary.test.js
git commit -m "Expose global admin and workspace APIs"
```

---

### Task 4: Build the Shared Branded Authentication Shell and Image Assets

**Files:**
- Create: `public/shared/auth-shell.js`
- Create: `public/shared/auth-shell.css`
- Create: `public/shared/assets/auth-question.png`
- Create: `public/shared/assets/auth-failure.png`
- Create: `public/shared/assets/auth-success.png`
- Create: `tests/auth-shell-boundary.test.js`

**Interfaces:**
- Produces browser global:

```js
window.AuthShell.mount({
  root,
  title,
  prompt,
  accountLabel,
  fieldLabel,
  inputType,
  submitLabel,
  onSubmit
});
```

- Returned controller:

```js
{
  setIdle({ prompt }),
  setBusy(isBusy),
  setFailure(message),
  showSuccess({ message, seconds, onComplete }),
  focus(),
  destroy()
}
```

- Consumed by both admin login and workspace phrase entry.

- [ ] **Step 1: Write failing shared-shell boundary tests**

Assert:

- Logo URL is `/console/assets/deepmega-dclaw-logo.png`.
- State names are `idle`, `failure`, and `success`.
- `showSuccess()` defaults to 3 seconds and disables duplicate submission.
- CSS contains desktop Logo width `240px`-`300px`, mobile Logo width `190px`-`230px`.
- Desktop mascot width is capped at `220px` and `34%`.
- Failure image box is capped at `250px`.
- Mobile mascot width is `112px`-`140px`.
- The mascot container has stable dimensions across state changes.

- [ ] **Step 2: Run the shell test and verify it fails**

Run:

```bash
node --test tests/auth-shell-boundary.test.js
```

Expected: FAIL because the shared files/assets do not exist.

- [ ] **Step 3: Inspect all three source images before editing**

Use `view_image` on:

```text
/Users/moxi/Desktop/codex space/Q/微信图片_20260604143805_28_112.jpg
/Users/moxi/Desktop/codex space/Q/微信图片_20260604143828_29_112.jpg
/Users/moxi/Desktop/codex space/Q/微信图片_20260604144300_39_112.jpg
```

Confirm the full mascot and intended accessories are visible before editing.

- [ ] **Step 4: Generate the three transparent derivatives with the imagegen skill**

Use these exact editing goals:

```text
Initial: remove the background completely; preserve the confused mascot and question mark;
do not add text, logos, shadows, or new objects.

Failure: remove the background completely; remove the DClaw logo and all Chinese text;
preserve the angry mascot and broken laptop; do not add new objects.

Success: remove the background completely; preserve the happy waving mascot;
do not add text, logos, shadows, or new objects.
```

Write optimized PNG outputs to the three `public/shared/assets/` paths.

- [ ] **Step 5: Validate image format and transparency**

Run:

```bash
file public/shared/assets/auth-question.png public/shared/assets/auth-failure.png public/shared/assets/auth-success.png
sips -g pixelWidth -g pixelHeight -g hasAlpha public/shared/assets/auth-question.png public/shared/assets/auth-failure.png public/shared/assets/auth-success.png
```

Expected: all three are PNG, `hasAlpha: yes`, and no source-scale image is shipped unnecessarily. Inspect each output with `view_image` for white edges, background remnants, failure Logo/text, and accidental cropping.

- [ ] **Step 6: Implement the reusable shell and state controller**

Build stable markup once in `mount()`. `setFailure()` and `showSuccess()` must only swap state classes, message text, and image source; they must not reconstruct the entire page or resize the outer dialog.

Countdown core:

```js
function showSuccess({ message, seconds = 3, onComplete }) {
  setBusy(true);
  let remaining = seconds;
  renderSuccess(message, remaining);
  const timer = window.setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      window.clearInterval(timer);
      onComplete();
      return;
    }
    renderSuccess(message, remaining);
  }, 1000);
}
```

Ensure a second submit cannot run while `busy === true`.

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --test tests/auth-shell-boundary.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add public/shared tests/auth-shell-boundary.test.js
git commit -m "Add shared branded authentication shell"
```

---

### Task 5: Build the Independent Global Administrator Console

**Files:**
- Create: `public/admin/index.html`
- Create: `public/admin/app.js`
- Create: `public/admin/styles.css`
- Create: `tests/admin-console-boundary.test.js`

**Interfaces:**
- Consumes shared `AuthShell`.
- Consumes `x-admin-session-token` APIs from Task 3.
- Writes workspace tokens into the same storage format consumed by Task 6:

```js
localStorage["worktool_workspace_sessions"] = JSON.stringify({
  [slug]: { token, expiresAt }
});
```

- [ ] **Step 1: Write failing admin-console boundary tests**

Assert the HTML contains:

```text
工作区
Bots
Agents
系统设置
退出
```

Assert the app contains:

- `worktool_admin_session`.
- `x-admin-session-token`.
- Admin login, logout, session, and password endpoints.
- Workspace create/update/delete/open operations.
- Multi-select assignment from unassigned Bots.
- Transfer confirmation showing source and target names.
- Agent list/create/edit/delete.
- Bot inventory, Agent binding, workspace column, and create/update controls.
- No administrator-account list or create-user UI.

- [ ] **Step 2: Run the admin-console test and verify it fails**

Run:

```bash
node --test tests/admin-console-boundary.test.js
```

Expected: FAIL because `public/admin/` does not exist.

- [ ] **Step 3: Build the branded admin login state**

Load:

```html
<link rel="stylesheet" href="/admin/styles.css" />
<link rel="stylesheet" href="/shared/auth-shell.css" />
<script src="/shared/auth-shell.js"></script>
```

Mount with:

```js
AuthShell.mount({
  root: document.querySelector("#adminAuthRoot"),
  title: "管理员登录",
  prompt: "登录后维护工作区、Bots、Agents 和系统设置。",
  accountLabel: "admin",
  fieldLabel: "管理员密码",
  inputType: "password",
  submitLabel: "进入管理后台",
  onSubmit: loginAdmin
});
```

On successful login, store the session before starting the 3-second countdown. A refresh during the countdown must verify the stored session and enter directly.

- [ ] **Step 4: Implement the admin API wrapper and session lifecycle**

```js
async function adminRequest(path, options = {}) {
  const session = readAdminSession();
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(session?.token ? { "x-admin-session-token": session.token } : {}),
      ...(options.headers || {})
    }
  });
  if (response.status === 401) {
    clearAdminSession();
    showAdminLogin();
  }
  return parseResponse(response);
}
```

Startup must call `/api/admin/session`; service restart therefore invalidates the browser token cleanly.

- [ ] **Step 5: Implement workspace list/detail and Bot assignment**

Use a two-column work area:

```text
[workspace list] [workspace detail + assigned Bots]
```

Assignment modal:

- Fetch unassigned Bots.
- Search by Bot name/ID.
- Checkbox multi-select.
- Submit `{ "botIds": ["..."] }`.
- Do not use drag-and-drop.

Transfer action must render `原工作区 -> 新工作区` and require a second confirmation. Delete confirmation must include assigned Bot count and state that Bot/business data remains.

- [ ] **Step 6: Implement the global Bot inventory**

Display:

- Bot ID/name.
- bound Agent.
- enabled state.
- assigned workspace.
- create/edit action.
- assign/transfer action.
- “进入配置” action.

For an assigned Bot, “进入配置”:

1. Calls `POST /api/admin/workspaces/:id/session`.
2. Stores the workspace session by slug.
3. Navigates to `/console/:slug?bot=:botId`.

For an unassigned Bot, disable “进入配置” and show “请先分配入口”. Continue to use the current `PUT /api/bots/:botId` semantics for Bot creation/binding.

- [ ] **Step 7: Move Agent maintenance into the Agents tab**

Recreate the current Agent fields and behavior:

```text
Agent ID
Agent 名称
DClaw Base URL
OpenAPI Public ID
OpenAPI API Key
启用
```

Use the existing `/api/agents` and `/api/agents/:agentId` APIs with the admin session header. Preserve the current “bound Agent cannot be deleted” conflict message.

- [ ] **Step 8: Implement system settings and logout**

Password change submits:

```json
{ "password": "new password" }
```

On success:

1. Clear the local admin session.
2. Return to the login shell.
3. Require the new password.

Logout calls `/api/admin/logout`, clears local state, and returns to the login shell.

- [ ] **Step 9: Reuse current visual language without nesting cards**

In `public/admin/styles.css`:

```css
@import url("/console/styles.css");
```

Use the current header, colors, 8px-or-less card radii, buttons, icon system, form controls, and spacing. Reuse a local SVG symbol sprite sourced from the current console and Lucide-equivalent symbols already present there; do not add hand-drawn standalone SVG buttons. Keep page sections unframed; use cards only for repeated workspace/Bot/Agent items and modals.

- [ ] **Step 10: Run focused tests**

Run:

```bash
node --test tests/admin-console-boundary.test.js tests/auth-shell-boundary.test.js tests/server-global-admin-boundary.test.js
```

Expected: all PASS.

- [ ] **Step 11: Commit**

```bash
git add public/admin tests/admin-console-boundary.test.js
git commit -m "Add global administrator console"
```

---

### Task 6: Gate the Existing Console by Workspace and Remove Only Agent Maintenance

**Files:**
- Create: `public/console/workspace-entry.js`
- Create: `tests/console-workspace-boundary.test.js`
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Modify: `tests/console-auth-boundary.test.js`

**Interfaces:**
- Produces browser global:

```js
window.WorkspaceContext = {
  ready,
  slug,
  workspace,
  loadBots(),
  logout(),
  handleUnauthorized()
};
```

- `ready` resolves only after a valid workspace session exists.
- `loadBots()` calls `/api/workspaces/:slug/bots` with `x-workspace-session-token`.
- Existing `app.js` continues to own Bot sessions and all Bot-scoped APIs.

- [ ] **Step 1: Write failing workspace-console tests**

Assert:

- `index.html` loads `/shared/auth-shell.css`, `/shared/auth-shell.js`, and `/console/workspace-entry.js` before `app.js`.
- `workspace-entry.js` parses exactly `/console/:slug`.
- Workspace session storage key is `worktool_workspace_sessions`.
- Workspace requests send `x-workspace-session-token`.
- `app.js` waits for `WorkspaceContext.ready`.
- `loadBots()` uses `WorkspaceContext.loadBots()` rather than `/api/public/bots`.
- `/api/public/bots` does not disappear from server tests.
- Employee HTML no longer contains `agentManagementPanel`, `agentForm`, or `agentsList`.
- Bot form still contains `<select name="agentId" required>`.
- `app.js` still loads `/api/agents` for an admin-unlocked Bot so the binding select works.
- No conversation/task/tag/push/log functions are removed.

- [ ] **Step 2: Run console tests and verify they fail**

Run:

```bash
node --test tests/console-workspace-boundary.test.js tests/console-auth-boundary.test.js
```

Expected: FAIL on missing workspace gate and existing Agent maintenance UI.

- [ ] **Step 3: Implement workspace session parsing and gate**

Parse:

```js
const match = window.location.pathname.match(/^\/console\/([a-z0-9-]+)$/);
```

If it does not match, navigate to `/admin/`.

Session rules:

- Store sessions by slug.
- Validate stored sessions through `GET /api/workspaces/:slug/bots`.
- On 401/423, clear the slug token and mount the entry shell.
- Fetch the challenge before showing the shell.
- Submit the response to `/api/workspaces/:slug/unlock`.
- On success store token/expiry and show the happy mascot with a 3-second countdown.
- After countdown resolve `WorkspaceContext.ready`; do not reload the page.
- A valid stored session resolves immediately with no repeated animation.
- Unknown slugs render a branded “入口不存在” state using the same Logo and shell.
- Disabled workspaces render a branded “当前入口暂不可用” state without showing a phrase form or Bot data.

Employee copy may say “一起对个口令” and the configured display name, but must not show the fixed words “部门”, “组织”, or “工作区”.

- [ ] **Step 4: Defer existing app startup until entry succeeds**

Replace direct startup:

```js
WorkspaceContext.ready
  .then(() => loadBots())
  .catch((error) => {
    els.logsOutput.textContent = `无法加载配置：${error.message}`;
  });
```

Change only `loadBots()`:

```js
async function loadBots() {
  const data = await WorkspaceContext.loadBots();
  currentBots = data.bots || [];
  // Keep the existing Agent-option and Bot-context logic below this point.
}
```

Do not add workspace headers to Bot business requests. They continue using `x-bot-session-token`.

- [ ] **Step 5: Support admin navigation to a selected Bot**

After Bot rendering, read `?bot=` once. If the Bot exists in the current workspace, select its card/open its normal unlock flow. Do not auto-unlock it; the administrator still uses the current Bot unlock dialog and current global password.

- [ ] **Step 6: Remove Agent maintenance from Bot configuration**

Remove only:

- Agent management panel markup.
- Agent create/edit/delete form listeners.
- Agent card rendering and maintenance actions.

Retain:

- `currentAgents`.
- `loadAgents({ silent, headers })`.
- `renderAgentOptions()`.
- Bot binding `<select name="agentId">`.
- Admin Bot-context load of Agents using the selected Bot admin session.

Update `tests/console-auth-boundary.test.js` so it asserts Agent maintenance is absent while Agent selection remains.

- [ ] **Step 7: Add workspace logout control**

Add a small icon-only logout control to the employee header with a tooltip/accessible label. It calls `WorkspaceContext.logout()`, clears only the workspace session, clears local Bot selection context, and returns to the phrase gate. It does not delete Bot session tokens or server business data.

- [ ] **Step 8: Run focused console regression tests**

Run:

```bash
node --test \
  tests/console-workspace-boundary.test.js \
  tests/console-auth-boundary.test.js \
  tests/console-activation-boundary.test.js \
  tests/console-tags-boundary.test.js \
  tests/console-proactive-scheduling-boundary.test.js \
  tests/console-tag-alerts-boundary.test.js
```

Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add public/console tests/console-workspace-boundary.test.js tests/console-auth-boundary.test.js
git commit -m "Scope console Bot list to workspace URLs"
```

---

### Task 7: Document Migration and Verify the Complete System

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: any focused test only when verification exposes a real requirement gap.

**Interfaces:**
- Documents the one-time admin bootstrap, `/admin/`, `/console/:slug`, workspace setup, and SSH recovery command.
- Does not add deployment compatibility switches.

- [ ] **Step 1: Write the deployment documentation update**

Document:

```text
1. Keep ADMIN_API_KEY populated for the first upgraded startup.
2. Start the upgraded service once; it hashes that value into SQLite.
3. Log in at /admin/ and create/enable workspaces.
4. Assign each Bot to one workspace.
5. Distribute /console/:slug URLs.
6. Change the administrator password in the UI if desired.
7. Use npm run admin:reset-password only for SSH recovery.
```

Clarify that later `.env` password changes do not change the database password.

- [ ] **Step 2: Update `.env.example`**

Replace the existing comment with:

```dotenv
# Required only to initialize the singleton database admin password on first upgraded startup.
# After initialization, change the password in /admin/ or with npm run admin:reset-password.
ADMIN_API_KEY=replace_with_a_random_admin_key
ADMIN_SESSION_TTL_HOURS=8
```

Do not add workspace secrets to environment variables.

- [ ] **Step 3: Run database/auth/API/frontend focused suites**

Run:

```bash
node --test \
  tests/db-admin-credential.test.js \
  tests/admin-auth.test.js \
  tests/db-workspaces.test.js \
  tests/workspace-auth.test.js \
  tests/server-global-admin-boundary.test.js \
  tests/server-workspace-boundary.test.js \
  tests/admin-console-boundary.test.js \
  tests/console-workspace-boundary.test.js \
  tests/auth-shell-boundary.test.js
```

Expected: all PASS.

- [ ] **Step 4: Run the complete automated test suite**

Run:

```bash
npm test
```

Expected: all tests PASS with zero failures.

- [ ] **Step 5: Run source and repository hygiene checks**

Run:

```bash
git diff --check
rg -n "TBD|TODO|implement later|fill in" src public tests scripts README.md .env.example
```

Expected: no whitespace errors and no new placeholders.

- [ ] **Step 6: Start a local isolated smoke server**

Use a temporary data directory and unused port:

```bash
DATA_DIR="$(mktemp -d)" \
PORT=18767 \
ADMIN_API_KEY="local-admin-test" \
PUBLIC_BASE_URL="http://127.0.0.1:18767" \
CALLBACK_SECRET="local-callback-test" \
node src/server.js
```

Keep the process running through the browser checks, then stop it cleanly.

- [ ] **Step 7: Verify API migration and workspace behavior**

Exercise:

1. Admin login.
2. Workspace create with phrase.
3. Bot assignment.
4. Workspace challenge/unlock.
5. Workspace Bot filtering.
6. Bot unlock with its existing password.
7. Admin password change and old-session invalidation.
8. Disabled workspace rejection.
9. Bot transfer and preserved Bot binding.
10. Public `/api/public/bots` unchanged.

Capture response status and non-sensitive fields; never print passwords/tokens into committed files.

- [ ] **Step 8: Verify desktop and mobile UI in the browser**

Use the browser-control skill at:

```text
http://127.0.0.1:18767/admin/
http://127.0.0.1:18767/console/<test-slug>
```

Check at desktop and mobile viewports:

- Logo is readable and proportionate.
- Mascot never overlaps the form.
- Initial/failure/success states use the correct image.
- Success counts `3`, `2`, `1` before entering.
- Dialog dimensions remain stable between states.
- Admin tabs and workspace detail are usable.
- Assignment modal search/multi-select works.
- Employee console shows only assigned Bots.
- Existing Bot unlock and all current business tabs still work.

Take screenshots for evidence but do not commit transient screenshots.

- [ ] **Step 9: Commit documentation**

```bash
git add README.md .env.example
git commit -m "Document workspace and admin migration"
```

- [ ] **Step 10: Request final code review**

Invoke `superpowers:requesting-code-review` and review:

- Spec compliance.
- No business-route behavior changes.
- No credential plaintext persistence.
- Workspace authorization is limited to Bot-list filtering.
- Agent maintenance exists in `/admin/` before being removed from Bot config.
- Full test and browser evidence.

- [ ] **Step 11: Push after review fixes and final verification**

Run:

```bash
npm test
git diff --check
git status --short
git push origin main
```

Expected: tests pass, no unintended files remain, and all implementation commits are pushed.
