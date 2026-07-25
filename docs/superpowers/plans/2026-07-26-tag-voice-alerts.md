# Agent Tag Decisions and Voice Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore continuous Agent-driven private-customer tagging and add durable, real-time voice alerts that navigate operators to the exact evidence message.

**Architecture:** Reuse the bounded legacy-history tag contract and existing tag adjudicator, then pass compact tag rules on every eligible private Agent request. Persist accepted tag outcomes, activation work, and alert records through a detailed database operation; publish committed alerts over authenticated SSE and render them through a focused console alert client.

**Tech Stack:** Node.js ES modules, Express 5, SQLite via `node:sqlite`, browser Fetch Streams/SSE, vanilla HTML/CSS/JavaScript, `node:test`, macOS `say` and `afconvert` for the committed MP3 asset.

## Global Constraints

- Normal AI replies use one DClaw call; no second model call is added for tagging.
- Every eligible private customer message receives compact tag rules, including human-handoff transcript requests.
- Group messages never receive customer tag rules.
- Legacy history remains bounded and is sent once; later messages retain tag rules without history.
- The server remains the authority for tag validity, exclusivity, one-way progression, idempotency, task scheduling, and alert creation.
- Only accepted state-changing Agent `add` and `replace` decisions can create alerts.
- Manual tags, date tags, removals, rejected decisions, and duplicate tags never create alerts.
- Alert state is Bot-scoped and shared across connected consoles.
- Real-time delivery uses authenticated SSE and persisted snapshots; continuous polling is forbidden.
- One Agent response can create multiple alert rows but can cause only one sound playback.
- Tag persistence does not depend on an active flow machine or a successful WorkTool reply send.
- Existing bounded request limits, legacy history behavior, normal replies, flows, tag activations, proactive tasks, and conversation persistence must keep passing their regression tests.
- Execute inline in the current repository; do not dispatch multi-agent implementation workers.

---

### Task 1: Extend Tag Configuration And Evidence Contracts

**Files:**
- Modify: `src/tags.js`
- Modify: `src/agent-response-gateway.js`
- Modify: `tests/tags.test.js`
- Modify: `tests/agent-response-gateway.test.js`

**Interfaces:**
- Produces: `normalizeTagSchema(raw)` with `tag.voiceAlertEnabled: boolean`.
- Produces: `normalizeTagDecision(raw)` preserving `evidenceMessageId` and `evidenceText` on normalized `add` and `remove` entries.
- Preserves: `compactTagRulesForAgent({ schema, currentTags })` excludes alert-only configuration from the Agent rule payload.
- Consumes later: Tasks 2-4 use normalized evidence fields and `voiceAlertEnabled`.

- [ ] **Step 1: Add failing tag normalization tests**

Add focused assertions:

```js
test("normal tags default and preserve voice alert settings", () => {
  const schema = normalizeTagSchema({
    groups: [{
      id: "intent",
      name: "意向",
      tags: [
        { id: "a", name: "A类", condition: "明确成交", voiceAlertEnabled: true },
        { id: "b", name: "B类", condition: "询问细节" }
      ]
    }]
  });
  assert.equal(schema.groups[0].tags[0].voiceAlertEnabled, true);
  assert.equal(schema.groups[0].tags[1].voiceAlertEnabled, false);
});

test("tag decisions preserve bounded evidence fields", () => {
  const decision = normalizeTagDecision({
    add: [{
      groupId: "intent",
      tagId: "b",
      reason: "询问老师",
      evidenceMessageId: "msg-123",
      evidenceText: "你们老师水平怎么样"
    }]
  });
  assert.deepEqual(decision.add[0], {
    groupId: "intent",
    tagId: "b",
    reason: "询问老师",
    evidenceMessageId: "msg-123",
    evidenceText: "你们老师水平怎么样"
  });
});
```

Also assert `compactTagRulesForAgent` contains tag IDs, names, and conditions but does not serialize `voiceAlertEnabled`.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
node --test tests/tags.test.js tests/agent-response-gateway.test.js
```

Expected: evidence and voice-alert assertions fail because those properties are currently discarded.

- [ ] **Step 3: Implement minimal normalization**

In `src/tags.js`:

```js
function boundedDecisionText(value, maxChars) {
  return String(value || "").trim().slice(0, maxChars);
}

// In normalizeTagSchema tag output:
voiceAlertEnabled: Boolean(tag.voiceAlertEnabled),

// In normalizeAction:
evidenceMessageId: boundedDecisionText(
  item.evidenceMessageId || item.evidence_message_id,
  240
),
evidenceText: boundedDecisionText(
  item.evidenceText || item.evidence_text,
  1000
)
```

Keep `compactTagRulesForAgent` unchanged apart from tests proving alert-only fields stay local. Confirm `agent-response-gateway.js` returns the richer normalized decision without requiring evidence.

- [ ] **Step 4: Run focused tests and verify pass**

Run:

```bash
node --test tests/tags.test.js tests/agent-response-gateway.test.js
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tags.js src/agent-response-gateway.js tests/tags.test.js tests/agent-response-gateway.test.js
git commit -m "Extend tag decisions with alert evidence"
```

---

### Task 2: Add Durable Alert And Evidence Persistence

**Files:**
- Modify: `src/db.js`
- Create: `tests/db-tag-alerts.test.js`
- Modify: `tests/db-tags.test.js`

**Interfaces:**
- Produces: `applyAgentTagOutcome(options)` returning:

```js
{
  tags: [],
  accepted: [],
  rejected: [],
  tagEvents: [],
  scheduledTagActivationTasks: [],
  alerts: []
}
```

- Produces: `listUnreadTagAlerts({ botId })`.
- Produces: `markTagAlertRead({ botId, alertId })`.
- Produces: `listConversationMessagesAround({ botId, conversationKey, anchorMessageId, before, after })`.
- Produces: `getConversationMessageForEvidence({ botId, conversationKey, messageId, evidenceText, candidateIds })`.
- Preserves: existing `applyConversationTagChanges`, manual tags, date tags, and standalone tag-activation functions.
- Consumes later: Tasks 3-5 call these functions.

- [ ] **Step 1: Add failing schema and idempotency tests**

Create `tests/db-tag-alerts.test.js` covering:

```js
test("automatic tag outcome atomically stores one alert for one accepted event", () => {
  const result = db.applyAgentTagOutcome({
    botId,
    agentId,
    conversationKey,
    accepted: [{
      action: "add",
      groupId: "intent",
      groupName: "意向",
      tagId: "b",
      tagName: "B类",
      reason: "询问老师"
    }],
    rejected: [],
    nextTags: [{
      groupId: "intent",
      groupName: "意向",
      tagId: "b",
      tagName: "B类",
      reason: "询问老师"
    }],
    activationCandidates: [],
    alertCandidates: [{
      groupId: "intent",
      tagId: "b",
      customerName: "张三",
      evidenceMessageId: message.id,
      evidenceText: message.content
    }]
  });
  assert.equal(result.alerts.length, 1);
  assert.equal(db.listUnreadTagAlerts({ botId }).length, 1);
});
```

Add tests proving:

- a duplicate source tag event cannot create a second alert;
- manual/date paths create no alert;
- `markTagAlertRead` affects only the requested Bot;
- unread lists are newest first and Bot-isolated;
- an anchor window contains an older evidence message beyond the recent-message limit;
- evidence ID must belong to the same Bot and conversation;
- normalized text can resolve a selected legacy-history message;
- invalid evidence falls back only to an explicitly supplied current-batch candidate.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
node --test tests/db-tag-alerts.test.js tests/db-tags.test.js
```

Expected: new exports and table behavior are missing.

- [ ] **Step 3: Add tables and row mappers**

Add a migration-safe table:

```sql
CREATE TABLE IF NOT EXISTS tag_alert_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_tag_event_id INTEGER NOT NULL UNIQUE,
  bot_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  conversation_key TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  group_id TEXT NOT NULL,
  group_name TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  reason TEXT,
  evidence_message_id INTEGER,
  evidence_text TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tag_alert_events_unread
ON tag_alert_events (bot_id, read_at, id);
```

Add `rowToTagAlertEvent(row)` returning camel-case fields. Register the table in test reset/cleanup helpers.

- [ ] **Step 4: Add detailed transactional persistence**

Factor internal SQL helpers so `applyAgentTagOutcome` can execute in one
`BEGIN IMMEDIATE` transaction:

1. cancel pending tasks for accepted old tags and removals;
2. replace current normal tags;
3. insert accepted and rejected conversation-tag events;
4. insert activation candidates;
5. insert alert candidates with `INSERT OR IGNORE`, using the matching accepted
   tag-event ID;
6. commit and return mapped records.

Keep `applyConversationTagChanges` as a compatibility wrapper for manual/date
callers. Do not create alerts from the wrapper.

- [ ] **Step 5: Add evidence and message-window queries**

Implement strict Bot/conversation checks:

```js
export function listConversationMessagesAround({
  botId,
  conversationKey,
  anchorMessageId,
  before = 60,
  after = 60
}) { /* bounded rows before + anchor + rows after */ }
```

Implement evidence resolution in this order:

1. exact local `conversation_messages.id` from allowed candidates;
2. exact WorkTool/source message key from allowed candidates;
3. normalized exact `evidenceText` match among allowed current and selected
   legacy candidates;
4. last explicitly supplied current-batch candidate;
5. `null`.

- [ ] **Step 6: Run focused tests and verify pass**

Run:

```bash
node --test tests/db-tag-alerts.test.js tests/db-tags.test.js tests/db-activation.test.js
```

Expected: all focused tests pass and old tag persistence remains compatible.

- [ ] **Step 7: Commit**

```bash
git add src/db.js tests/db-tag-alerts.test.js tests/db-tags.test.js
git commit -m "Persist durable tag voice alerts"
```

---

### Task 3: Restore Continuous Private Tag Decisions

**Files:**
- Modify: `src/dclaw.js`
- Modify: `src/server.js`
- Modify: `tests/dclaw-tags.test.js`
- Modify: `tests/dclaw-handoff.test.js`
- Modify: `tests/server-tags-boundary.test.js`
- Modify: `tests/server-legacy-history-boundary.test.js`
- Modify: `tests/server-handoff-boundary.test.js`
- Modify: `tests/server-inbound-coalescing-boundary.test.js`

**Interfaces:**
- Consumes: richer normalized tag decisions from Task 1.
- Consumes: `applyAgentTagOutcome` and evidence helpers from Task 2.
- Produces: `buildTagEvidenceCandidates({ batch, legacyHistoryAnalysis })`.
- Produces: `applyAgentTagDecision({ ..., evidenceCandidates })` backed by the detailed transaction.
- Produces: normal and handoff DClaw requests that may include `tagRules` and `tagEvidenceCandidates`.
- Produces later: committed alert arrays passed to the SSE publisher in Task 4.

- [ ] **Step 1: Add failing normal-message contract tests**

Change the existing boundary from “only bounded legacy analysis” to:

```js
test("every eligible private Agent call builds compact tag context", () => {
  const body = functionBody("processCoalescedIncomingBatch");
  assert.match(body, /const tagContext = isPrivateMessage\(message\)/);
  assert.match(body, /buildTagContext\(\{ binding, conversationKey \}\)/);
  assert.match(body, /tagContext,/);
});

test("legacy history remains conditional while tag rules remain continuous", () => {
  const body = asyncFunctionBody("processCoalescedIncomingBatch");
  assert.match(body, /legacyHistoryAnalysis,/);
  assert.match(body, /const tagContext = isPrivateMessage\(message\)/);
  assert.doesNotMatch(body, /const tagContext = legacyHistoryAnalysis\?\.text/);
});
```

Add DClaw tests proving:

- a normal private request with `tagContext` includes `tagRules` and
  `tagDecision`;
- current evidence candidates are serialized with bounded IDs/text;
- a later legacy request includes tag rules without the historical block;
- group requests do not receive tag context.

- [ ] **Step 2: Add failing application-order tests**

Assert:

- `applyAgentTagDecision` is outside `if (flow)`;
- it occurs after strict validation and the epoch check;
- it occurs before `sendTextReplyParts`;
- a valid reply with rejected tag business changes remains sendable;
- empty-reply handling does not discard a valid state-changing tag decision.

- [ ] **Step 3: Add failing human-handoff tests**

Extend handoff request tests so:

```js
const request = buildDclawHandoffTranscriptRequest({
  binding,
  conversation,
  message,
  flow,
  tagContext,
  tagEvidenceCandidates
});
assert.match(request.message, /tagRules/);
assert.match(request.message, /tagDecision/);
```

Assert the server applies a validated handoff `tagDecision` and never calls a
WorkTool send function in that path.

- [ ] **Step 4: Run focused tests and verify failure**

Run:

```bash
node --test \
  tests/dclaw-tags.test.js \
  tests/dclaw-handoff.test.js \
  tests/server-tags-boundary.test.js \
  tests/server-legacy-history-boundary.test.js \
  tests/server-handoff-boundary.test.js \
  tests/server-inbound-coalescing-boundary.test.js
```

Expected: normal and handoff paths still omit continuous tag context or apply it
only inside the legacy/flow boundary.

- [ ] **Step 5: Preserve persisted message IDs through coalescing**

Make `insertConversationMessage` return its inserted row. Change
`persistInboundConversation` to return:

```js
{
  conversation,
  messageRecord
}
```

Pass `messageRecord.id`, the WorkTool message ID, and text into each coalescer
item. Build bounded evidence candidates from the exact current batch. Add
selected legacy message IDs/text only for the one-time legacy analysis.

- [ ] **Step 6: Send tag rules and evidence on every eligible private call**

In `processCoalescedIncomingBatch`:

```js
const tagContext = isPrivateMessage(message)
  ? buildTagContext({ binding, conversationKey })
  : null;
const tagEvidenceCandidates = tagContext
  ? buildTagEvidenceCandidates({ batch, legacyHistoryAnalysis })
  : [];
```

Pass both values to `buildDclawRequest`. Keep `legacyHistoryAnalysis`
conditional and one-time.

Extend DClaw instructions so each `tagDecision.add` may return
`evidenceMessageId` and `evidenceText`, and require the best matching supplied
candidate when possible.

- [ ] **Step 7: Apply valid tag decisions independently**

After strict response validation and current-epoch validation:

1. adjudicate the normalized decision;
2. resolve evidence only within the current conversation and supplied
   candidates;
3. build activation candidates and alert candidates from the current schema;
4. call `applyAgentTagOutcome`;
5. log accepted, rejected, scheduled, and alert counts;
6. continue normal flow and reply handling.

Do not make tag business-rule rejection a gateway-level failure. Structural JSON
errors remain gateway failures; unknown/disabled tags remain adjudicator
rejections.

- [ ] **Step 8: Extend human-handoff tagging without replying**

Pass compact tag context and current evidence candidates to
`buildDclawHandoffTranscriptRequest`. Validate and apply the returned
`tagDecision`, then finish the transcript sync without invoking WorkTool send
functions.

- [ ] **Step 9: Run focused tests and verify pass**

Run the command from Step 4 plus:

```bash
node --test tests/db-tag-alerts.test.js tests/server-reply-contract.test.js
```

Expected: all focused tests pass.

- [ ] **Step 10: Commit**

```bash
git add \
  src/dclaw.js \
  src/server.js \
  tests/dclaw-tags.test.js \
  tests/dclaw-handoff.test.js \
  tests/server-tags-boundary.test.js \
  tests/server-legacy-history-boundary.test.js \
  tests/server-handoff-boundary.test.js \
  tests/server-inbound-coalescing-boundary.test.js
git commit -m "Restore continuous Agent tag decisions"
```

---

### Task 4: Add Authenticated SSE And Alert APIs

**Files:**
- Create: `src/tag-alert-stream.js`
- Modify: `src/server.js`
- Create: `tests/tag-alert-stream.test.js`
- Create: `tests/server-tag-alerts-boundary.test.js`

**Interfaces:**
- Produces: `createTagAlertStreamHub({ heartbeatMs })`.
- Hub methods:

```js
hub.subscribe({ botId, req, res, snapshot })
hub.publishCreated({ botId, alerts })
hub.publishRead({ botId, alertId, readAt })
hub.close()
```

- Produces APIs:
  - `GET /api/tag-alerts/stream?botId=...`
  - `GET /api/tag-alerts?botId=...&status=unread`
  - `POST /api/tag-alerts/:alertId/read`
- Consumes: alert DB functions from Task 2 and committed alerts from Task 3.

- [ ] **Step 1: Add failing hub unit tests**

Use fake request/response objects to verify:

- the first event is an `alerts.snapshot`;
- `publishCreated` reaches only subscribers for the matching Bot;
- `publishRead` reaches every subscriber for that Bot;
- heartbeat comments are written;
- request close removes the subscriber;
- `hub.close()` clears heartbeat timers and connections.

Example event shape:

```js
{
  event: "alerts.created",
  data: {
    batchId: "invocation:1653",
    alerts: [{ id: 10, conversationKey: "...", tagName: "B类" }]
  }
}
```

- [ ] **Step 2: Run hub tests and verify failure**

Run:

```bash
node --test tests/tag-alert-stream.test.js
```

Expected: module does not exist.

- [ ] **Step 3: Implement the focused stream hub**

Use `Map<botId, Set<connection>>`. Format each event as:

```text
event: alerts.created
data: {"batchId":"...","alerts":[...]}

```

Set:

```http
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

Do not add polling, WebSocket dependencies, or tokens in query parameters.

- [ ] **Step 4: Add failing API boundary tests**

Assert each route:

- calls `assertBotAccess(req, botId)`;
- uses the selected Bot only;
- sends the persisted unread snapshot when opening the stream;
- marks read with both Bot ID and alert ID;
- broadcasts committed reads;
- publishes created alerts only after the tag transaction returns.

- [ ] **Step 5: Implement routes and server publication**

Initialize one hub near server startup. Add route handlers and close the hub on
server shutdown if the existing shutdown path exposes a hook.

After Task 3 returns committed alerts:

```js
if (tagResult.alerts.length) {
  tagAlertStreamHub.publishCreated({
    botId,
    batchId: `invocation:${invocationId}`,
    alerts: tagResult.alerts
  });
}
```

The read endpoint commits first, then publishes `alerts.read`.

- [ ] **Step 6: Run focused tests and verify pass**

Run:

```bash
node --test \
  tests/tag-alert-stream.test.js \
  tests/server-tag-alerts-boundary.test.js \
  tests/server-auth-boundary.test.js \
  tests/server-bot-isolation-boundary.test.js
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/tag-alert-stream.js src/server.js tests/tag-alert-stream.test.js tests/server-tag-alerts-boundary.test.js
git commit -m "Stream durable tag alerts to consoles"
```

---

### Task 5: Add The Tag Voice-Alert Switch

**Files:**
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Modify: `tests/console-tags-boundary.test.js`

**Interfaces:**
- Consumes: `voiceAlertEnabled` normalized by Task 1 and returned by existing tag-schema APIs.
- Produces: tag editor controls and import/export preservation.
- Preserves: add-date special group behavior and existing expandable condition field.

- [ ] **Step 1: Add failing console boundary tests**

Assert:

```js
assert.match(js, /voiceAlertEnabled:\s*Boolean\(tag\.voiceAlertEnabled\)/);
assert.match(js, /data-tag-field="voiceAlertEnabled"/);
assert.match(js, /语音提示/);
assert.match(js, /condition[\s\S]*voiceAlertEnabled/);
```

Also assert the date-tag editor does not render the voice switch and imported or
exported tag JSON retains the field.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
node --test tests/console-tags-boundary.test.js
```

Expected: voice alert field is absent.

- [ ] **Step 3: Implement the switch**

Add `voiceAlertEnabled: Boolean(tag.voiceAlertEnabled)` to
`normalizeTagSchemaDraft`. Render a compact labeled switch immediately after the
condition field. Handle checkbox changes through the existing delegated tag
field update path.

Keep the condition expander's row geometry and animation unchanged. Use the
existing switch visual language rather than a new control style.

- [ ] **Step 4: Run focused tests and verify pass**

Run:

```bash
node --test tests/console-tags-boundary.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add public/console/app.js public/console/styles.css tests/console-tags-boundary.test.js
git commit -m "Configure voice alerts per customer tag"
```

---

### Task 6: Add Console Alert Client, Navigation, And Highlighting

**Files:**
- Create: `public/console/tag-alert-client.js`
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Create: `tests/console-tag-alerts-boundary.test.js`
- Modify: `tests/console-auth-boundary.test.js`

**Interfaces:**
- Consumes: SSE and read APIs from Task 4.
- Produces: `window.createTagAlertClient(options)`.
- Client methods:

```js
client.connect({ botId, headers })
client.disconnect()
client.replaceSnapshot(alerts)
client.markRead(alertId)
client.unlockAudio()
```

- Integrates with: `openFlowSession(conversationKey, options)` using
  `anchorMessageId`, `tagName`, and `alertId`.

- [ ] **Step 1: Add failing HTML and JavaScript boundary tests**

Assert the console contains:

- a fixed alert button with count and accessible label;
- an adjacent list panel;
- an `<audio preload="auto">` using `assets/tag-voice-alert.mp3`;
- `tag-alert-client.js` loaded before `app.js`;
- authenticated streaming `fetch`, not `EventSource`;
- no `setInterval` or polling loop in the alert client;
- abort-on-Bot-switch and bounded reconnect backoff;
- snapshot replacement without audio;
- created-batch rendering with one `audio.play()` call;
- read events removing items;
- hover/focus pause classes.

- [ ] **Step 2: Add failing navigation tests**

Assert:

- clicking an item activates the Conversation tab;
- current type, search, node, tag, and date filters are reset;
- `openFlowSession` accepts an anchor message ID;
- the session detail request includes `anchorMessageId`;
- the rendered evidence message has a stable `data-message-id`;
- `scrollIntoView({ behavior: "smooth", block: "center" })` is called;
- the bubble renders `此消息触发「标签名」标签`;
- the highlight class is removed after approximately 3000 ms;
- missing evidence produces the nonfatal explanation.

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```bash
node --test tests/console-tag-alerts-boundary.test.js tests/console-auth-boundary.test.js
```

Expected: alert client and markup do not exist.

- [ ] **Step 4: Implement the isolated alert client**

In `tag-alert-client.js`:

- parse SSE frames from `response.body.getReader()`;
- authenticate with supplied headers;
- reconnect after 1s, 2s, 4s, then at a capped 10s;
- replace local state on `alerts.snapshot`;
- append unseen IDs on `alerts.created`;
- call one sound callback for a nonempty created batch;
- remove IDs on `alerts.read`;
- expose cleanup through `AbortController`;
- never use interval polling.

Keep DOM rendering callbacks injected by `app.js` so the transport client stays
testable and does not know workspace-tab internals.

- [ ] **Step 5: Implement fixed alert UI**

Add semantic button/list markup and CSS:

- fixed bottom-right placement that does not cover existing primary actions;
- red button and count badge;
- pulse keyframes only for `.has-unread:not(.is-paused)`;
- list max height with vertical scrolling;
- keyboard focus and pointer hover support;
- no nested cards or layout shifts.

- [ ] **Step 6: Implement Bot lifecycle and navigation**

Connect only after the selected Bot has usable console authorization. Disconnect
before Bot switches, lock actions, or context resets.

Extend `openFlowSession`:

```js
async function openFlowSession(conversationKey, {
  anchorMessageId = "",
  alertTagName = "",
  missingEvidence = false
} = {}) { /* existing load plus anchor behavior */ }
```

The server detail route accepts `anchorMessageId` and calls
`listConversationMessagesAround`; without an anchor it keeps the existing recent
message behavior.

Mark the alert read after the target conversation has opened. If the evidence
was deleted, open the latest records, show the explanation, and still mark read.

- [ ] **Step 7: Run focused tests and verify pass**

Run:

```bash
node --test \
  tests/console-tag-alerts-boundary.test.js \
  tests/console-tags-boundary.test.js \
  tests/console-auth-boundary.test.js \
  tests/server-tag-alerts-boundary.test.js
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add \
  public/console/tag-alert-client.js \
  public/console/index.html \
  public/console/app.js \
  public/console/styles.css \
  src/server.js \
  tests/console-tag-alerts-boundary.test.js \
  tests/console-auth-boundary.test.js \
  tests/server-tag-alerts-boundary.test.js
git commit -m "Navigate tag voice alerts to evidence"
```

---

### Task 7: Create And Verify The MP3 Template

**Files:**
- Create: `public/console/assets/tag-voice-alert.mp3`
- Modify: `tests/console-tag-alerts-boundary.test.js`

**Interfaces:**
- Produces: a committed MPEG Layer 3 asset speaking `您有新的客户标签提醒`.
- Consumes: the `<audio>` element and client behavior from Task 6.

- [ ] **Step 1: Add a failing asset test**

Add assertions:

```js
const audioPath = new URL("../public/console/assets/tag-voice-alert.mp3", import.meta.url);
assert.equal(fs.existsSync(audioPath), true);
assert.ok(fs.statSync(audioPath).size > 1000);
assert.equal(fs.readFileSync(audioPath).subarray(0, 3).toString("latin1"), "ID3");
```

Permit a valid MPEG frame header if `afconvert` omits ID3 metadata.

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
node --test tests/console-tag-alerts-boundary.test.js
```

Expected: MP3 file is missing.

- [ ] **Step 3: Generate the speech asset**

Run:

```bash
say -v Tingting "您有新的客户标签提醒" -o /tmp/tag-voice-alert.aiff
afconvert -f MPG3 -d .mp3 -q 127 \
  /tmp/tag-voice-alert.aiff \
  public/console/assets/tag-voice-alert.mp3
file public/console/assets/tag-voice-alert.mp3
```

Expected: `file` identifies MPEG audio and the output is nonempty. Do not keep
the temporary AIFF in the repository.

- [ ] **Step 4: Run the focused test and verify pass**

Run:

```bash
node --test tests/console-tag-alerts-boundary.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add public/console/assets/tag-voice-alert.mp3 tests/console-tag-alerts-boundary.test.js
git commit -m "Add customer tag voice alert audio"
```

---

### Task 8: Full Regression, Browser Verification, And Push

**Files:**
- Modify only if verification exposes a defect in files already covered by Tasks 1-7.

**Interfaces:**
- Verifies every interface from previous tasks.
- Produces: pushed `origin/main` containing the existing bounded-history commits, design, plan, implementation, and test commits.

- [ ] **Step 1: Run syntax checks**

Run:

```bash
node --check src/tags.js
node --check src/db.js
node --check src/dclaw.js
node --check src/tag-alert-stream.js
node --check src/server.js
node --check public/console/tag-alert-client.js
node --check public/console/app.js
```

Expected: every command exits 0.

- [ ] **Step 2: Run the complete test suite**

Run:

```bash
npm test
```

Expected: zero failures.

- [ ] **Step 3: Run repository integrity checks**

Run:

```bash
git diff --check
git status --short
git log --oneline --decorate -15
```

Expected: no uncommitted implementation changes and no whitespace errors.

- [ ] **Step 4: Start the local console**

Run:

```bash
npm run dev
```

Use an available local port from `.env`; if occupied, start with:

```bash
PORT=18767 npm run dev
```

Expected: `/health` returns `ok: true`.

- [ ] **Step 5: Verify the browser UI**

Using the in-app browser:

1. open the console at desktop width;
2. confirm the tag voice switch follows the condition field without overlap;
3. confirm the alert button is fixed bottom-right and does not cover save/send
   actions;
4. inject or create two unread alert fixtures for the selected Bot;
5. confirm count, flashing, hover pause, list text, and scrolling;
6. click one alert and confirm the Conversation tab opens, evidence centers,
   annotation appears, and highlight fades;
7. confirm the clicked item disappears while the other remains;
8. switch Bots and confirm the stream and alert list are isolated;
9. repeat at a mobile viewport and confirm no overlap or clipped text.

- [ ] **Step 6: Inspect the SSE connection**

Confirm the browser holds one authenticated stream for the selected Bot, receives
heartbeat traffic, closes the old stream on Bot switch, and creates no repeating
poll requests.

- [ ] **Step 7: Commit any verification-only corrections**

If corrections were required:

```bash
git add \
  src/tags.js \
  src/db.js \
  src/dclaw.js \
  src/tag-alert-stream.js \
  src/server.js \
  public/console/tag-alert-client.js \
  public/console/index.html \
  public/console/app.js \
  public/console/styles.css \
  public/console/assets/tag-voice-alert.mp3 \
  tests/tags.test.js \
  tests/db-tag-alerts.test.js \
  tests/dclaw-tags.test.js \
  tests/dclaw-handoff.test.js \
  tests/tag-alert-stream.test.js \
  tests/server-tag-alerts-boundary.test.js \
  tests/server-tags-boundary.test.js \
  tests/server-legacy-history-boundary.test.js \
  tests/server-handoff-boundary.test.js \
  tests/console-tags-boundary.test.js \
  tests/console-tag-alerts-boundary.test.js
git commit -m "Harden tag voice alert workflow"
```

If no corrections were required, do not create an empty commit.

- [ ] **Step 8: Push**

Run:

```bash
git push origin main
```

Expected: `origin/main` advances to the verified local `main`.
