# Whapi Private Chat Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize durable Whapi events, process them with a restart-safe worker, and route private WhatsApp messages and replies through the existing DClaw/Gateway business flow without WorkTool wire dependencies.

**Architecture:** A pure Whapi mapper converts one stored envelope into standard channel events. A provider-neutral leased worker claims persisted envelopes and dispatches standard events. A narrow legacy-core bridge temporarily translates standard private message events into the current core message shape while preserving stable Whapi conversation identity; outbound replies use Channel Delivery.

**Tech Stack:** Node.js ES modules, `node:sqlite`, built-in `node:test`, Express 5.

## Global Constraints

- Modify only this repository and do not create a worktree.
- Follow red-green-refactor TDD.
- Do not wait for DClaw in the public Webhook request.
- Do not expose Whapi wire fields outside `src/channels/whapi/` except raw audit payload storage.
- Use stable Channel, chat, sender, and message IDs; never use display names as identity.
- Preserve all existing Gateway, tag, asset, handoff, coalescing, and failure-isolation behavior.

### Task 1: Whapi event mapper

**Files:** Create `src/channels/whapi/mapper.js`; create `tests/whapi-mapper.test.js`; modify `src/channels/whapi/adapter.js`.

- [ ] Add fixtures for private/group text, supported media, quote, mentions, statuses, account health, and unknown events.
- [ ] Confirm tests fail before the mapper exists.
- [ ] Implement `normalizeWhapiWebhook({ channelAccountId, payload })` returning exact standard contract events with RFC3339 timestamps and immutable raw snapshots.
- [ ] Wire Adapter `normalizeWebhook` to the mapper and run channel tests.
- [ ] Commit `feat: normalize whapi webhook events`.

### Task 2: Persistent webhook worker

**Files:** Modify `src/db.js`; create `src/channels/webhook-worker.js`; create `tests/channel-webhook-worker.test.js`; extend DB tests.

- [ ] Test atomic claiming, leases, completion, terminal invalid events, retry backoff, expired-lease recovery, and non-overlapping ticks.
- [ ] Add DB claim/complete/fail/recover APIs over `channel_webhook_events`.
- [ ] Implement `createChannelWebhookWorker({ claim, normalize, dispatch, complete, fail })` with bounded batches and retries.
- [ ] Run focused tests and commit `feat: process durable channel webhooks`.

### Task 3: Stable private identity and core bridge

**Files:** Create `src/channels/core-message-bridge.js`; modify `src/db.js`; modify `src/server.js`; create `tests/channel-core-message-bridge.test.js`; extend server integration tests.

- [ ] Test `whapi:<channelAccountId>:private:<externalUserId>` keys and legacy-core message translation using display names only as presentation.
- [ ] Make conversation identity prefer explicit provider/account/chat metadata without changing remaining legacy callbacks.
- [ ] Dispatch Whapi private messages through existing persistence, handoff, coalescing, DClaw, Gateway, tags, assets, and first-message entry behavior.
- [ ] Start the worker only after composition dependencies exist; Webhook response remains independent.
- [ ] Run focused and full tests; commit `feat: route whapi private messages`.

### Task 4: Private outbound delivery and status

**Files:** Modify `src/server.js`, `src/db.js`, and focused tests.

- [ ] Replace customer-visible private reply sends with Channel Delivery when the conversation has channel identity.
- [ ] Persist provider message ID and pending status before non-critical audit work.
- [ ] Apply Whapi status events monotonically (`pending`, `sent`, `delivered`, `read`/`played`, `failed`) without triggering replies.
- [ ] Verify Agent text/media, manual reply, fallback, and handoff behavior against Fake/Whapi adapters.
- [ ] Run `npm test` and commit `feat: complete whapi private chat loop`.

### Task 5: Stage 3 verification

- [ ] Prove duplicate Webhooks do not duplicate replies or first-message activation.
- [ ] Prove restart recovery and two-account conversation/session isolation.
- [ ] Prove no core module reads Whapi payload fields or calls `gate.whapi.cloud`.
- [ ] Run all focused tests and the full suite with zero failures.
- [ ] Continue immediately to the group migration plan.
