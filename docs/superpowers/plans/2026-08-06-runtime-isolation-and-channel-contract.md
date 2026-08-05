# Runtime Isolation and Channel Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the copied service an independent runtime identity and introduce the provider-neutral contract through which Whapi will replace every WorkTool client responsibility.

**Architecture:** Extract pure runtime path selection, point the existing SQLite initialization at a new database, and update package/service identity without migrating old data. Add focused channel contract, safe error, registry, delivery, and Fake Adapter modules; do not yet call Whapi or change existing business send paths.

**Tech Stack:** Node.js ES modules, built-in `node:test`, `node:assert/strict`, `node:sqlite`, Express 5, npm.

## Global Constraints

- Modify files only under `/Users/moxi/Desktop/codex space/agent create/dclaw-omnichannel-service`.
- Work in the current repository; do not create a worktree.
- Do not push unless explicitly requested.
- Do not migrate, read, rename, or copy the old WorkTool SQLite database.
- Do not add Whapi network calls in this stage.
- Do not mechanically rename WorkTool symbols or change existing business delivery paths in this stage.
- No core module may branch on provider names.
- No error or log field may expose credentials or raw provider bodies.
- Follow strict red-green-refactor TDD.
- Baseline: `npm test` passes 967 tests with 0 failures on 2026-08-06.

---

### Task 1: Extract and apply independent runtime paths

**Files:**
- Create: `src/runtime-paths.js`
- Create: `tests/runtime-paths.test.js`
- Modify: `src/db.js:1-30`

**Interfaces:**
- Produces: `resolveRuntimePaths({ cwd, env }) -> { dataDir, databasePath }`.

- [ ] Write tests for default `data/dclaw-omnichannel-service.sqlite`, relative `DATA_DIR`, relative `DATABASE_PATH`, and absolute `DATABASE_PATH`.
- [ ] Run `node --test tests/runtime-paths.test.js` and confirm failure because the module is missing.
- [ ] Implement the pure resolver:

```js
export function resolveRuntimePaths({ cwd = process.cwd(), env = process.env } = {}) {
  if (env.DATABASE_PATH) {
    const databasePath = path.resolve(cwd, env.DATABASE_PATH);
    return { dataDir: path.dirname(databasePath), databasePath };
  }
  const dataDir = path.resolve(cwd, env.DATA_DIR || "data");
  return {
    dataDir,
    databasePath: path.join(dataDir, "dclaw-omnichannel-service.sqlite")
  };
}
```

- [ ] Update `src/db.js` to create `dataDir` and open `databasePath` from the resolver.
- [ ] Add a subprocess integration test that places an empty `worktool-bot-service.sqlite` sentinel in a temporary directory, imports `src/db.js`, and proves the sentinel remains empty while the new database is created.
- [ ] Run `node --test tests/runtime-paths.test.js tests/db-bot-isolation.test.js tests/db-message-key.test.js`.
- [ ] Commit: `refactor: isolate omnichannel database runtime`.

### Task 2: Rename active service identity

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/config.js`
- Modify: `src/server.js`
- Modify: `README.md`
- Create: `tests/service-identity.test.js`

**Interfaces:**
- Produces package/service ID `dclaw-omnichannel-service`.
- Produces canonical fallback environment input `BOT_ID`, with temporary `ROBOT_ID` fallback only until WorkTool removal.

- [ ] Write a package metadata test that parses `package.json` and asserts the independent name/description.
- [ ] Add a subprocess HTTP integration test that starts the service with an isolated temporary database and disabled workers, calls `/health`, and asserts `service === "dclaw-omnichannel-service"`; do not grep source text.
- [ ] Run the focused tests and confirm they fail on the old identity.
- [ ] Change `package.json`, regenerate only lock metadata with `npm install --package-lock-only --ignore-scripts`, and update the health/startup identity.
- [ ] Make `src/config.js` prefer `BOT_ID || ROBOT_ID` without changing existing explicit multi-Bot configuration.
- [ ] Rewrite the active README introduction and startup instructions for the independent omnichannel project. Clearly label remaining WorkTool instructions as temporary migration-only behavior rather than testing prose with source assertions.
- [ ] Run `node --test tests/service-identity.test.js tests/server-boundary.test.js` and `npm pkg get name description`.
- [ ] Commit: `chore: rename service runtime identity`.

### Task 3: Implement credential-safe channel errors

**Files:**
- Create: `src/channels/errors.js`
- Create: `tests/channel-errors.test.js`

**Interfaces:**
- Produces frozen `CHANNEL_ERROR_CODES`.
- Produces `ChannelError extends Error`.
- Produces `toChannelError(value, context)`.

- [ ] Write failing tests for `invalid_contract`, `unknown_provider`, `unsupported_capability`, `authentication_required`, `rate_limited`, `temporary_provider_failure`, `permanent_provider_rejection`, and `invalid_provider_response`.
- [ ] Prove `JSON.stringify(error)` cannot contain arbitrary `token`, `authorization`, request headers, or provider response values supplied to the constructor.
- [ ] Run `node --test tests/channel-errors.test.js` and confirm the missing-module failure.
- [ ] Implement a constructor that copies only `provider`, `channelAccountId`, `operation`, and `retryable`, and keeps `cause` non-enumerable.
- [ ] Implement `toChannelError` so unexpected errors become retryable temporary errors with the public message `Channel operation failed` and do not copy the original message into enumerable metadata.
- [ ] Run focused tests.
- [ ] Commit: `feat: add safe channel errors`.

### Task 4: Implement the provider-neutral contract

**Files:**
- Create: `src/channels/contract.js`
- Create: `tests/channel-contract.test.js`

**Interfaces:**
- Produces `CHANNEL_CAPABILITY_KEYS`.
- Produces `assertProviderId`, `assertCapabilities`, `assertChannelAdapter`.
- Produces `normalizeSendCommand`, `assertSendResult`, `assertInboundEvents`.

- [ ] Write failing tests requiring lowercase provider identifiers and the exact eleven boolean capabilities from the design.
- [ ] Write failing tests requiring all adapter methods from the design.
- [ ] Write failing command tests requiring `channelAccountId`, `externalChatId`, `messageType`, and `idempotencyKey`; arrays and metadata must become immutable snapshots.
- [ ] Write failing result tests requiring boolean `accepted`, a status, and an external message ID for accepted results.
- [ ] Write failing inbound-event tests for private/group message events and non-message account events; validate structure without embedding rejected payloads in errors.
- [ ] Run focused tests and confirm missing exports.
- [ ] Implement small exact-key, record, string, array, clone, and freeze helpers. All failures use `ChannelError("invalid_contract", ...)`.
- [ ] Run `node --test tests/channel-errors.test.js tests/channel-contract.test.js`.
- [ ] Commit: `feat: define channel adapter contract`.

### Task 5: Implement the instance-scoped registry

**Files:**
- Create: `src/channels/registry.js`
- Create: `tests/channel-registry.test.js`

**Interfaces:**
- Produces `createChannelRegistry() -> { register, unregister, get, resolve, list }`.

- [ ] Write failing tests for registration, sorted listing, duplicate rejection, removal, unknown provider, missing account identity, capability rejection, and two independent instances.
- [ ] Run the test and confirm the module is missing.
- [ ] Implement a closure-owned `Map`; do not export global mutable registry state.
- [ ] `resolve({ provider, channelAccountId }, requiredCapability)` validates account identity and capability before returning the adapter.
- [ ] Run `node --test tests/channel-errors.test.js tests/channel-contract.test.js tests/channel-registry.test.js`.
- [ ] Commit: `feat: add channel adapter registry`.

### Task 6: Implement standard delivery and Fake Adapter

**Files:**
- Create: `src/channels/delivery.js`
- Create: `src/channels/fake/adapter.js`
- Create: `tests/channel-delivery.test.js`

**Interfaces:**
- Produces `createChannelDelivery({ registry, resolveAccount }) -> { send }`.
- Produces `createFakeChannelAdapter(options)` with deterministic recorded commands and queued outcomes.

- [ ] Write failing delivery tests using a real registry and fake account resolver.
- [ ] Prove text uses `sendText`, every other supported message type uses `sendMedia`, commands are immutable, accepted IDs are deterministic, and unknown accounts never invoke an adapter.
- [ ] Cover disabled text/media capabilities; authentication, temporary, and permanent errors; malformed provider results; unexpected secret-bearing errors; and independent fake instances.
- [ ] Run focused tests and confirm missing modules.
- [ ] Implement delivery in this order: normalize command, resolve account, verify matching account ID, capability-resolve adapter, invoke method, validate result, sanitize unexpected exceptions.
- [ ] Implement all adapter methods in the fake without network/filesystem access. Default sends return `fake-message-1`, `fake-message-2`, and so on.
- [ ] Run all channel tests.
- [ ] Commit: `feat: add channel delivery and fake adapter`.

### Task 7: Verify stage 0–1

**Files:**
- Modify only Task 1–6 files if corrections are required.

- [ ] Run `git diff --check`.
- [ ] Run `rg -n 'gate\.whapi\.cloud|Bearer ' src/channels` and prove no Whapi network code exists.
- [ ] Run `rg -n 'provider\s*(===|!==)' src/channels src/core 2>/dev/null || true` and prove no provider branching.
- [ ] Run all new tests together.
- [ ] Run `npm test` and require at least the original 967 tests plus new tests, with zero failures.
- [ ] Inspect `git status --short`, `git diff --stat`, and the new commit list; preserve unrelated user changes.
- [ ] Update the project plan status and report exact evidence.

## Next Stage

After this plan passes, immediately create and execute the Stage 2 plan for encrypted Whapi account persistence, write-only Token administration, Whapi HTTP Client, health mapping, and Webhook configuration. Stage 2 must consume the contract produced here and may place Whapi endpoints only under `src/channels/whapi/`.
