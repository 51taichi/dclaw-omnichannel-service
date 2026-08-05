# Whapi Account, Client, and Webhook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add encrypted Whapi account persistence, a credential-safe Whapi HTTP client and adapter, health mapping, webhook configuration, and durable authenticated webhook intake.

**Architecture:** Keep credentials and Whapi wire knowledge behind focused channel modules. `db.js` owns channel-account and webhook-event persistence, `src/channels/whapi/` owns Whapi API details, and a small webhook intake service performs authentication and durable-first acknowledgement without calling DClaw.

**Tech Stack:** Node.js ES modules, built-in `node:crypto`, `node:sqlite`, `fetch`, Express 5, `node:test`.

## Global Constraints

- Modify files only under `/Users/moxi/Desktop/codex space/agent create/dclaw-omnichannel-service`.
- Work directly in the current repository; do not create a worktree.
- Do not push unless explicitly requested.
- Follow strict red-green-refactor TDD.
- Never expose Token plaintext, ciphertext, IV, authentication tag, authorization headers, or raw provider error bodies to browsers or ordinary logs.
- Whapi endpoints and wire fields may appear only under `src/channels/whapi/` and controlled Whapi fixtures/tests.
- The current database is disposable and does not migrate or read WorkTool data.
- Webhook acknowledgement must not wait for DClaw, media download, or event processing.

---

### Task 1: Credential encryption

**Files:**
- Create: `src/channels/credentials.js`
- Create: `tests/channel-credentials.test.js`

**Interfaces:**
- Produces: `resolveTokenEncryptionKey(value) -> Buffer`.
- Produces: `encryptChannelToken({ token, key, provider, channelAccountId }) -> { ciphertext, iv, authTag, suffix }`.
- Produces: `decryptChannelToken({ encrypted, key, provider, channelAccountId }) -> string`.
- Produces: `hashWebhookSecret(secret)`, `verifyWebhookSecret(secret, encodedHash)`, and `generateWebhookSecret()`.

- [ ] Write tests proving accepted 32-byte base64/hex keys, rejected missing/invalid keys, AES-256-GCM round trips, a fresh 12-byte IV, account-bound AAD, and no plaintext in encrypted output.
- [ ] Run `node --test tests/channel-credentials.test.js` and confirm the module-not-found failure.
- [ ] Implement AES-256-GCM with provider/account AAD and scrypt-hashed webhook secrets verified with constant-time comparison.
- [ ] Run the focused test and commit `feat: add encrypted channel credentials`.

### Task 2: Whapi account persistence

**Files:**
- Modify: `src/db.js`
- Create: `tests/db-channel-accounts.test.js`

**Interfaces:**
- Consumes: encrypted Token fields and hashed webhook secrets from Task 1.
- Produces: `createChannelAccount`, `updateChannelAccountToken`, `getChannelAccount`, `getChannelAccountByPublicId`, `listChannelAccounts`, `updateChannelAccountHealth`, and `markChannelAccountWebhookSuccess`.

- [ ] Write subprocess database tests using a temporary `DATABASE_PATH`; create two accounts and prove provider/channel uniqueness and Bot isolation.
- [ ] Prove public/list reads expose `tokenConfigured` and `tokenSuffix` only, while an explicit internal credential read is the only API returning encrypted fields.
- [ ] Add `channel_accounts` with provider, channel ID, random public ID, encrypted Token columns, Webhook hash, enabled flag, normalized/raw health, timestamps, and sanitized last error.
- [ ] Implement exact-field persistence functions; never include secret columns in ordinary row mapping.
- [ ] Run focused DB tests and commit `feat: persist whapi channel accounts`.

### Task 3: Whapi HTTP client, health, and adapter

**Files:**
- Create: `src/channels/whapi/capabilities.js`
- Create: `src/channels/whapi/health.js`
- Create: `src/channels/whapi/client.js`
- Create: `src/channels/whapi/adapter.js`
- Create: `tests/whapi-client.test.js`
- Create: `tests/whapi-adapter.test.js`

**Interfaces:**
- Produces: `mapWhapiHealth(payload, { now, transitionStartedAt })`.
- Produces: `createWhapiClient({ token, fetchImpl, baseUrl, timeoutMs })` implementing `GET /health`, `GET/PATCH /settings`, text/media sends, chats, groups, and participants.
- Produces: `createWhapiAdapter({ resolveAccountClient })` satisfying the channel contract.

- [ ] Write controlled-fetch tests asserting Bearer authorization, JSON bodies, bounded timeout, `POST /messages/text`, media endpoint selection, pagination, and URL-encoded path IDs.
- [ ] Write error tests for 401/403 authentication, 429 rate limit, timeout/network/5xx retryability, permanent 4xx rejection, malformed success responses, and secret-free errors.
- [ ] Write health tests for `AUTH`, `QR`, short/long `INIT` and `LAUNCH`, `STOP`, and `SYNC_ERROR`.
- [ ] Implement the minimal client and adapter using only typed `ChannelError` values and standard contract results.
- [ ] Run all channel/Whapi tests and commit `feat: add whapi client and adapter`.

### Task 4: Webhook configuration

**Files:**
- Create: `src/channels/whapi/webhook.js`
- Create: `tests/whapi-webhook-config.test.js`

**Interfaces:**
- Produces: `buildWhapiWebhookUrl({ publicBaseUrl, publicId })`.
- Produces: `buildWhapiWebhookSettings({ url, secret })` for required message, status, group, user, and channel events with persistence enabled.
- Adapter `configureWebhook(account)` uses the client `PATCH /settings` operation.

- [ ] Write tests for HTTPS-only callback URLs, encoded public IDs, no query secrets, required event subscriptions, persistent delivery, and a custom secret header.
- [ ] Implement deterministic settings generation matching the official Whapi settings schema and reject non-HTTPS production URLs.
- [ ] Wire adapter configuration through the client without leaking the secret in returned audit data.
- [ ] Run focused tests and commit `feat: configure whapi webhooks`.

### Task 5: Durable authenticated webhook intake

**Files:**
- Modify: `src/db.js`
- Create: `src/channels/webhook-intake.js`
- Modify: `src/server.js`
- Create: `tests/channel-webhook-intake.test.js`
- Create: `tests/server-whapi-webhook.test.js`

**Interfaces:**
- Produces: `recordChannelWebhookEvent` with a unique idempotency key and processing state.
- Produces: `createWebhookIntake({ resolveAccount, verifySecret, recordEvent }) -> handle({ publicId, method, headers, body })`.
- Produces route `POST|PUT|PATCH|DELETE /webhooks/whapi/:publicId`.

- [ ] Write tests proving the same external event is stored once, duplicates return success, invalid secrets reveal no account existence, disabled accounts do not enqueue work, event arrays remain one durable envelope, and secret headers are never persisted.
- [ ] Add `channel_webhook_events` with provider/account/event identity, method, payload JSON, state, attempts, lease/retry fields, sanitized error, and timestamps.
- [ ] Implement intake identity derivation from stable Whapi envelope fields with a SHA-256 fallback for events without message IDs.
- [ ] Register all four HTTP methods using a small JSON body limit and return HTTP 200 immediately after the transaction.
- [ ] Run focused tests, `git diff --check`, all channel tests, and `npm test`.
- [ ] Commit `feat: add durable whapi webhook intake`.

### Task 6: Stage 2 verification

**Files:**
- Modify only Task 1–5 files for corrections.

- [ ] Run `rg -n 'gate\.whapi\.cloud|Bearer ' src --glob '!src/channels/whapi/**'` and require no matches.
- [ ] Run credential redaction tests and inspect public account responses.
- [ ] Run all new focused tests together.
- [ ] Run `npm test` with zero failures.
- [ ] Inspect `git status --short` and commit list, then continue immediately to the private-chat migration plan.
