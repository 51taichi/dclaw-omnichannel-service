# Bot Scoped Console Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build per-Bot console unlock with one shared unlock entry, Bot/admin roles, Bot relock, and admin-only Bot configuration/key reset.

**Architecture:** Add Bot access-key hash fields to `bot_agent_bindings`, an in-memory Bot session token layer in `src/auth.js`, and route-level authorization helpers in `src/server.js`. Update the console so public Bot list is visible without a key, locked Bots require a unified unlock dialog, Bot-role users cannot see the config tab, and admin-role users can reset the current Bot key.

**Tech Stack:** Node.js ESM, Express 5, `node:sqlite`, browser JavaScript, CSS, `node:test`.

## Global Constraints

- One unlock input is used for both admin and employee keys.
- Match `ADMIN_API_KEY` first, then the current Bot access key; if they are equal, role is `admin`.
- Store only Bot access-key hashes, never plaintext.
- Bot role cannot see or use the config tab.
- Admin role can modify Bot binding and current Bot access key.
- First version may relock locally by clearing browser token/role/selected Bot state.
- Do not change DClaw agent code.

---

### Task 1: Auth Model and Database Support

**Files:**
- Create: `src/auth.js`
- Modify: `src/db.js`
- Test: `tests/bot-auth.test.js`

**Interfaces:**
- Produces: `hashAccessKey(accessKey)`, `verifyAccessKey(accessKey, hash)`, `createBotSession({ botId, role })`, `getBotSession(token)`, `deleteBotSession(token)`, `publicBotView(binding)`, `setBotAccessKey({ botId, accessKey })`

- [ ] **Step 1: Write failing tests**

Create `tests/bot-auth.test.js` with tests for hashing, session creation, public Bot view redaction, and Bot access-key storage.

- [ ] **Step 2: Run tests**

Run: `npm test -- tests/bot-auth.test.js`
Expected: fail because `src/auth.js` and DB helpers do not exist.

- [ ] **Step 3: Implement auth and DB helpers**

Create `src/auth.js` with SHA-256 salted hash helpers using `crypto.scryptSync`, timing-safe verify, and in-memory session map. Modify `src/db.js` to add `access_key_hash`, `access_key_updated_at`, and `setBotAccessKey`.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/bot-auth.test.js`
Expected: pass.

### Task 2: Bot Unlock API and Route Authorization

**Files:**
- Modify: `src/server.js`
- Test: `tests/server-auth-boundary.test.js`

**Interfaces:**
- Consumes: Task 1 auth/session helpers.
- Produces: `GET /api/public/bots`, `POST /api/bots/:botId/unlock`, `PUT /api/bots/:botId/access-key`, route authorization helpers.

- [ ] **Step 1: Write failing boundary tests**

Create tests that assert `server.js` contains public Bot route, unlock route, access-key route, and no longer relies only on `assertAdmin` for business APIs.

- [ ] **Step 2: Run tests**

Run: `npm test -- tests/server-auth-boundary.test.js`
Expected: fail because routes do not exist.

- [ ] **Step 3: Implement routes and authorization helpers**

Add `assertAdminAccess`, `assertBotSession`, `assertBotAccess`, and `assertAdminForBot`. Keep `x-api-key` admin compatibility. Apply Bot access to business APIs scoped by `botId`, and admin access to Bot binding/config mutation.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/server-auth-boundary.test.js`
Expected: pass.

### Task 3: Console Unlock, Role UI, and Relock

**Files:**
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Test: `tests/console-auth-boundary.test.js`

**Interfaces:**
- Consumes: Task 2 API routes and token roles.
- Produces: locked Bot cards, unified unlock dialog, Bot/admin role state, relock button, admin-only config tab and access-key button.

- [ ] **Step 1: Write failing boundary tests**

Create tests that assert console contains unlock dialog/relock UI hooks and admin-only config/access-key controls.

- [ ] **Step 2: Run tests**

Run: `npm test -- tests/console-auth-boundary.test.js`
Expected: fail because UI hooks do not exist.

- [ ] **Step 3: Implement console changes**

Load `/api/public/bots` without a key. Store per-Bot token/role in localStorage. Send `x-bot-session-token` for bot-scoped API calls. Hide config tab for `role=bot`. Add relock button to clear current Bot token and return to locked state.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/console-auth-boundary.test.js`
Expected: pass.

### Task 4: Verification and Commit

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: documented admin and Bot scoped auth behavior.

- [ ] **Step 1: Update docs**

Document public Bot list, unified unlock, Bot key reset, and relock behavior.

- [ ] **Step 2: Run full verification**

Run: `npm test && node --check src/server.js && node --check src/auth.js && node --check src/db.js`
Expected: all pass.

- [ ] **Step 3: Commit and push**

Run:

```bash
git add .
git commit -m "Add bot-scoped console authentication"
git push origin main
```
