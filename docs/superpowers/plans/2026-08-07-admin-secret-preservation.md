# Admin Secret Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent ordinary Agent and Bot edits from clearing previously configured integration secrets.

**Architecture:** Treat secret fields as patch values at the HTTP boundary. Missing, blank, and masked placeholder values resolve to the stored secret; only a new non-empty value replaces it. The admin UI displays configured state with a mask and omits unchanged secret fields from update requests.

**Tech Stack:** Node.js 22, Express, SQLite, browser JavaScript, Node test runner.

## Global Constraints

- Do not expose complete Whapi tokens, webhook secrets, or OpenAPI API keys through read APIs, logs, or browser persistence.
- Missing, blank, and masked secret values preserve the stored value.
- Only an explicitly submitted new non-empty secret replaces the stored value.
- Authentication passwords remain hash-only and outside ordinary configuration saves.

---

### Task 1: Preserve Agent API Keys at the server boundary

**Files:**
- Modify: `src/server.js`
- Modify: `src/db.js`
- Test: `tests/db-bot-isolation.test.js`
- Test: `tests/server-global-admin-boundary.test.js`

**Interfaces:**
- Consumes: existing `getAgent(agentId)` and `upsertAgent(agent)` functions.
- Produces: Agent PUT behavior where `agentApiKey` is unchanged for missing, blank, or `*****` input.

- [ ] **Step 1: Write failing tests**

Add database/API-boundary coverage demonstrating that an existing `agentApiKey` survives updates containing `undefined`, `""`, and `"*****"`, while a new value replaces it.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/db-bot-isolation.test.js tests/server-global-admin-boundary.test.js`

Expected: the preservation assertion fails because `PUT /api/agents/:agentId` currently converts blank input to `""`.

- [ ] **Step 3: Implement minimal preservation logic**

Resolve the incoming value before `upsertAgent`:

```js
function preservedSecret(value, existingValue = "") {
  const candidate = String(value ?? "").trim();
  return !candidate || /^\*+$/.test(candidate) ? existingValue : candidate;
}
```

Use the existing Agent value for both direct Agent edits and compatibility paths that update Agent data through Bot requests.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/db-bot-isolation.test.js tests/server-global-admin-boundary.test.js`

Expected: PASS.

---

### Task 2: Preserve Whapi credentials and avoid unnecessary webhook rotation

**Files:**
- Modify: `src/server.js`
- Test: `tests/server-whapi-webhook.test.js`
- Test: `tests/server-global-admin-boundary.test.js`

**Interfaces:**
- Consumes: `saveWhapiAccount({ botId, body })`, stored channel account credentials, and `preservedSecret` semantics from Task 1.
- Produces: Bot update behavior that retains encrypted Token and hashed Webhook Secret for missing, blank, or masked inputs.

- [ ] **Step 1: Write failing tests**

Cover editing an existing Bot with blank/masked `apiToken` and `webhookSecret`. Assert the encrypted Token metadata and Webhook Secret hash remain unchanged and webhook configuration is not invoked without a new Secret.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/server-whapi-webhook.test.js tests/server-global-admin-boundary.test.js`

Expected: at least the masked placeholder case fails before implementation.

- [ ] **Step 3: Implement minimal server handling**

Normalize missing, blank, and all-asterisk secret inputs to “not supplied.” Preserve existing encrypted Token and hashed Webhook Secret. Configure Whapi only when creating an account or when a genuinely new Webhook Secret is supplied.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/server-whapi-webhook.test.js tests/server-global-admin-boundary.test.js`

Expected: PASS.

---

### Task 3: Show configured masks without submitting placeholders

**Files:**
- Modify: `public/admin/app.js`
- Modify: `public/admin/index.html`
- Test: `tests/admin-console-boundary.test.js`

**Interfaces:**
- Consumes: `agentApiKey` configured state and channel account `tokenConfigured` state from admin list responses.
- Produces: masked edit fields and request bodies that omit unchanged secrets.

- [ ] **Step 1: Write failing UI boundary tests**

Assert that edit forms display `*****` for configured values and that `saveAgent`/`saveBot` delete secret properties whose values are blank or all asterisks before serialization.

- [ ] **Step 2: Run test and verify RED**

Run: `node --test tests/admin-console-boundary.test.js`

Expected: FAIL because edit handlers currently set secret fields to blank and save handlers always submit them.

- [ ] **Step 3: Implement minimal UI behavior**

Add a shared client helper:

```js
function changedSecret(value) {
  const candidate = String(value || "").trim();
  return candidate && !/^\*+$/.test(candidate) ? candidate : "";
}
```

Use masks only as visual configured-state indicators. Omit empty/masked secret properties from JSON bodies.

- [ ] **Step 4: Run focused test and verify GREEN**

Run: `node --test tests/admin-console-boundary.test.js`

Expected: PASS.

---

### Task 4: Regression verification and delivery

**Files:**
- Modify only if a regression is found in files already in scope.

**Interfaces:**
- Consumes: all behavior from Tasks 1–3.
- Produces: deployable commit with no secret-loss regression.

- [ ] **Step 1: Run the complete test suite**

Run: `npm test`

Expected: zero failures; documented skips are acceptable.

- [ ] **Step 2: Run static checks**

Run: `git diff --check`

Expected: no output.

- [ ] **Step 3: Review the final diff for secret exposure**

Verify no complete secret is added to list APIs, logs, fixtures committed with production values, or browser storage.

- [ ] **Step 4: Commit and push**

```bash
git add src/server.js src/db.js public/admin/app.js public/admin/index.html tests docs/superpowers
git commit -m "fix: preserve integration secrets on config edits"
git push origin main
```

