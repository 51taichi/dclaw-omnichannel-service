# Whapi Client Replacement Design

## Purpose

Replace the copied WorkTool/WeCom channel runtime with Whapi.Cloud/WhatsApp while preserving the existing DClaw, Agent Response Gateway, conversation, state-machine, tag, asset, handoff, proactive, cockpit, and group-automation business capabilities.

This project is an independent overseas-channel service. It does not preserve WorkTool or WeCom runtime compatibility and does not migrate the old SQLite data.

## Hard Constraints

- Only modify files under `/Users/moxi/Desktop/codex space/agent create/dclaw-omnichannel-service`.
- Work directly in the current repository; do not create a worktree.
- Use a new independent SQLite database; never read, copy, rename, or migrate the old WorkTool database automatically.
- One service instance is deployed in phase one.
- One internal Bot maps to one Whapi Channel and one DClaw Agent binding.
- Whapi Tokens are encrypted with an environment-provided master key before persistence.
- No Token, ciphertext, IV, authentication tag, authorization header, or raw credential may reach the browser or ordinary logs.
- Do not mechanically replace `worktool` strings. Replace behavior behind explicit channel boundaries.
- Preserve the current 967-test baseline until obsolete WorkTool tests are deliberately replaced by Whapi tests.
- Follow TDD for every behavior change.

## Chosen Migration Strategy

Use gradual replacement within the current codebase:

1. Isolate package, database, configuration, Cookie, logs, and deployment identity.
2. Introduce a provider-neutral Channel Adapter contract and Fake Adapter.
3. Add Whapi account persistence, encrypted credentials, HTTP Client, and health mapping.
4. Add durable Whapi Webhook intake and event normalization.
5. Replace private-chat receive/send paths.
6. Replace group receive/send and group-management paths.
7. Replace proactive, activation, tag, manual-reply, and automation delivery paths.
8. Remove WorkTool history, friend-added, tag-sync, callback, WeCom, UI, configuration, schema, and tests.
9. Perform multi-account and media acceptance testing.

Whapi replacement is considered complete only after no production module outside `src/channels/whapi/` contains Whapi wire fields or API endpoints and no active WorkTool/WeCom runtime remains.

## Target Architecture

```text
Whapi Cloud
  -> HTTPS Webhook
  -> durable channel_webhook_events row + idempotency key
  -> fast HTTP 200
  -> single-instance persistent webhook worker
  -> Whapi Adapter normalization
  -> provider-neutral event dispatcher
  -> existing conversation/DClaw/Gateway/business core
  -> provider-neutral outbound command
  -> Channel Registry
  -> Whapi Adapter/Client
  -> Whapi Cloud
```

Target modules:

```text
src/channels/
  contract.js
  errors.js
  registry.js
  delivery.js
  webhook-worker.js
  fake/adapter.js
  whapi/
    adapter.js
    client.js
    mapper.js
    capabilities.js
    health.js
    media.js
```

The current `server.js` remains the composition root during migration. Channel-neutral orchestration is extracted in focused modules as each WorkTool call site is replaced; unrelated business logic is not rewritten.

## Channel Contract

Every adapter provides:

```js
{
  provider,
  capabilities,
  normalizeWebhook(input),
  sendText(command),
  sendMedia(command),
  getAccountHealth(account),
  configureWebhook(account),
  listChats(account, options),
  listGroups(account, options),
  getGroup(account, externalGroupId),
  listGroupParticipants(account, externalGroupId)
}
```

Capabilities are explicit booleans:

```js
{
  privateChats: true,
  groupChats: true,
  text: true,
  media: true,
  deliveryReceipts: true,
  readReceipts: true,
  groupParticipants: true,
  groupMentions: true,
  nativeMentionAll: false,
  contactLabels: false,
  friendAddedEvent: false
}
```

Core modules ask for capabilities; they never branch on a provider name.

Standard inbound event:

```js
{
  provider: "whapi",
  channelAccountId,
  eventId,
  eventType,
  occurredAt,
  chat: { externalId, type, displayName },
  sender: { externalId, displayName },
  message: {
    externalId,
    type,
    text,
    attachments,
    quotedMessageId,
    mentions,
    fromMe
  },
  rawPayload
}
```

Standard outbound command:

```js
{
  channelAccountId,
  externalChatId,
  messageType,
  text,
  attachments,
  mentions,
  replyToExternalMessageId,
  idempotencyKey,
  metadata
}
```

Standard result:

```js
{
  accepted,
  externalMessageId,
  status,
  providerResponse
}
```

`providerResponse` is an audit-only value. Business code may not inspect it.

## Runtime and Database Isolation

The new default database is:

```text
<DATA_DIR>/dclaw-omnichannel-service.sqlite
```

`DATABASE_PATH` may override the complete path. The selected parent directory is created before SQLite opens. There is no fallback to `worktool-bot-service.sqlite`.

Package name, service health identity, startup output, default Cookie names, README, Docker/deployment identifiers, data directories, and example environment configuration use `dclaw-omnichannel-service` or a channel-neutral `DCLAW_OMNICHANNEL_` identity.

Because no old data must be retained, the new database is created with the final channel-neutral schema. Compatibility columns may exist temporarily only while a call path still depends on them; they are removed in the cleanup stage.

## Account and Credential Model

`channel_accounts` stores:

- internal `bot_id` primary key;
- `provider` (`whapi` in phase one);
- external Whapi `channel_id`, unique with provider;
- encrypted Token ciphertext, IV, authentication tag, and masked suffix;
- Webhook Secret hash;
- enabled state;
- raw provider status and normalized health status;
- last health check, last successful Webhook, last error, and timestamps.

`CHANNEL_TOKEN_ENCRYPTION_KEY` is required for Token writes and provider calls. It resolves to exactly 32 bytes. AES-256-GCM uses a fresh random 12-byte IV for every encryption and authenticates the account/provider identity as additional authenticated data.

Missing or invalid key configuration fails closed. Existing encrypted Tokens are never downgraded to plaintext. Admin reads expose only `tokenConfigured` and `tokenSuffix`; Token replacement is a write-only operation.

Webhook Secrets are generated with cryptographically secure randomness and stored as strong hashes. The public callback uses an unguessable account path plus a secret presented in a configurable Whapi custom header when available. Query-secret compatibility is not introduced.

## Whapi HTTP Client

The Client is the only module that knows `https://gate.whapi.cloud`, Bearer authorization, Whapi endpoint paths, or raw response envelopes.

It supports:

- health and settings;
- Webhook configuration;
- text, image, video, audio, voice, and document sends;
- chat/group listing and pagination;
- group details and participants;
- group creation where Whapi supports the existing product action;
- media retrieval needed for durable local storage.

Requests use bounded timeouts. Responses are parsed safely even when a provider returns non-JSON data. Typed errors distinguish:

- authentication required/non-`AUTH` Channel;
- rate limited;
- retryable network, timeout, and 5xx failure;
- permanent 4xx rejection;
- malformed provider response.

Errors carry only provider, account, operation, retryability, safe status, and a sanitized reason. They never include Token or complete raw bodies.

Whapi health maps `AUTH` to connected, `QR` to auth-required, short `INIT/LAUNCH` transitions to degraded, and sustained unavailable states to disconnected. Sends pause while the account is not connected.

## Webhook Intake and Idempotency

The route is account-scoped and public only for Whapi callbacks. It:

1. resolves the account from an unguessable public identifier;
2. validates the account Webhook Secret using constant-time comparison;
3. validates body size and JSON structure;
4. records the raw event and idempotency key transactionally;
5. returns HTTP 200 immediately for new and duplicate valid events;
6. returns authentication failure for invalid secrets without revealing account existence;
7. never waits for DClaw or media downloads.

`channel_webhook_events` stores provider, account, event kind, method, stable identity, payload, processing state, attempts, lease, retry time, sanitized error, and timestamps.

Primary message idempotency key:

```text
provider + channelAccountId + eventType + externalMessageId
```

Events without a message ID use a stable hash of normalized identity-bearing fields. Duplicate statuses may update the same message more than once but may not create replies or tasks.

A single-instance persistent worker claims rows with a lease, normalizes one Whapi payload into zero or more standard events, and dispatches them. The lease permits safe restart recovery. Invalid/unknown events are audited and terminal; transient provider/storage failures use bounded retry with backoff.

## Private Chat Flow

Whapi private `chat_id`, sender ID, and message ID become stable external identifiers. Display names and phone-like values are presentation fields only.

Conversation key:

```text
whapi:<channelAccountId>:private:<externalUserId>
```

The first inbound customer message for an account replaces the WorkTool friend-added signal. It creates the customer, date tag, conversation, entry-node state, and initial activation work exactly once.

After persistence, the existing flow remains:

```text
handoff check
-> coalescing
-> DClaw context
-> Agent Response Gateway
-> tag/asset/node decisions
-> customer-visible reply first
-> asynchronous alerts/statistics/activation
```

Inbound text and attachment metadata are passed to DClaw through the existing trusted attachment contract. A media download failure preserves the message and placeholder rather than dropping the event.

All private outbound sources—Agent reply, manual reply, flow activation, tag activation, proactive send, scheduled send, and fallback reply—use the channel delivery service. They persist the Whapi message ID and initial status before downstream audit work.

## Group Flow

Conversation key:

```text
whapi:<channelAccountId>:group:<externalGroupId>
```

Every group message is persisted before reply-policy decisions. The stable group ID is canonical across name changes. Sender stable ID and display name are saved per message.

Existing group background, roles, reply policies, confidentiality validation, manual tags, handoff, tasks, summaries, evidence navigation, and conversation memory remain. Private state-machine assets are excluded.

Whapi group changes update managed group names and participants. Group management uses Whapi group endpoints instead of WorkTool group commands. Mentions carry participant IDs, not display names. `@所有人` is implemented only by retrieving participants and passing each eligible ID in `mentions`; `nativeMentionAll` remains false.

## Media

Inbound attachment records store provider media ID, type, MIME, filename, size, source message, temporary URL metadata, local path, checksum, and download state.

Media required for conversation history is downloaded promptly into this project's isolated upload/storage directory. Provider URLs and authorization material are never persisted as public application URLs. Downloads enforce maximum size, allowed types, timeout, redirect, and filename rules.

Outbound media accepts the existing internal attachment representation. The Whapi Adapter selects the image/video/audio/voice/document endpoint and returns one standard result per sent item. Partial attachment failure is audited without losing successfully sent items.

## Delivery Status and Reliability

Whapi message statuses map monotonically where appropriate:

```text
pending -> sent -> delivered -> read/played
```

`failed` records a provider rejection and safe reason. Duplicate or out-of-order status events cannot regress a terminal higher status. Status events update existing outbound rows by provider, account, and external message ID.

Real-time customer and manual replies use the highest delivery priority. Activation and tag sends use normal priority. Proactive and group-automation batches use background priority with per-account throttling and bounded concurrency.

Retryable failures use bounded attempts with jittered backoff. Authentication-required failures pause until health returns to connected. Permanent provider rejection is terminal. A single target failure never aborts a batch.

## WorkTool/WeCom Removal

As each Whapi path is accepted, remove rather than retain:

- `src/worktool.js`, WorkTool history and cache;
- `src/wecom.js`;
- message/command callback routes and callback configuration routes;
- WorkTool group actions and raw command formats;
- friend-added signal handling;
- WeCom tag synchronization and contact cleanup;
- WorkTool-specific database columns and tables;
- WorkTool/WeCom environment variables, README text, logs, icons, admin fields, and tests.

Internal tags remain; only synchronization to WeCom is removed. Existing business tests are rewritten against the Fake/Whapi boundary before obsolete provider tests are deleted.

## Admin Experience

Bot administration retains the current product structure and adds Whapi account fields:

- display name;
- Channel ID;
- write-only Token replacement;
- generated Webhook callback address;
- connected/degraded/auth-required/disconnected state;
- last Webhook, health check, and safe error;
- test connection and configure Webhook actions;
- enable/disable switch.

The browser never receives the Token. A disabled account keeps history but stops Agent, manual, proactive, activation, and automation sends.

## Testing and Acceptance

TDD layers:

1. Contract/Fake Adapter tests.
2. Credential encryption and redaction tests.
3. Whapi Client request/response/error tests with controlled fetch doubles.
4. Mapper fixtures for private/group text, media, quote, mention, group changes, and statuses.
5. Webhook integration tests for authentication, durable-first acknowledgment, duplicates, arrays, unknown events, retries, and account isolation.
6. Core regression tests rewritten from WorkTool calls to standard channel commands.
7. Full suite after every migration slice.
8. Real Whapi acceptance only after automated behavior is green.

Final acceptance includes two Channels, private/group conversations, all required media, mentions, handoff, tags, state machine, proactive/scheduled sends, disconnect/recovery, status progression, restart recovery, and proof of no cross-account state.

## Implementation Boundaries

The work is delivered in independently verifiable stages:

- Stage 0–1: runtime isolation and channel contract.
- Stage 2: account security, Whapi Client, health, and Webhook configuration.
- Stage 3: durable Webhook and private chat closure.
- Stage 4: group closure.
- Stage 5: proactive delivery, media durability, and reliability.
- Stage 6: remove all old channel runtime and schema.
- Stage 7: complete automated and real acceptance.

Each stage has a detailed implementation plan derived from the current code immediately before execution. No stage may claim completion from narrow tests alone; its own requirements and the full regression suite must be verified.
