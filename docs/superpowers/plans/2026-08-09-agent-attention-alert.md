# Agent 待处理提醒 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当 Agent 无法可靠回答客户问题时，创建可合并、可发声、可点击定位的待处理提醒，同时保持 AI 接管状态不变。

**Architecture:** 扩展 Agent 最终结构化响应，增加经过独立 `customerEvidenceCandidates` 校验的 `attentionAlert`。使用 occurrence 表提供稳定触发级幂等，再用聚合表保存每个 Bot 会话的一条未读提醒；通过先订阅后快照的独立 SSE Hub 推送事件。控制台只展示当前 Bot，并把两类提醒合并呈现但使用独立音频和视觉语义。

**Tech Stack:** Node.js ESM、Express 5、Node 内置 SQLite `DatabaseSync`、原生 SSE、浏览器原生 JavaScript/CSS/Audio、Node test runner。

## Global Constraints

- 待处理提醒只报警，不修改 `handoff_status`，不自动切换人工接手。
- 不扫描 Agent 回复文案；只接受最终通过响应网关校验的结构化 `attentionAlert`。
- Agent 回复只要承诺后续查询、确认、核实、询问他人或跟进后再答复，即使同时提供参考答案，也必须输出 `attentionAlert.required=true`；该判断覆盖所有语言，不在服务端维护关键词表。
- 所有普通会话和 handoff audit 都提供独立于标签配置的 `customerEvidenceCandidates`；`required=true` 只能引用其中的客户证据。
- `required` 类型、字段长度或证据格式错误必须触发响应修复重试，不能静默降级或截断。
- 每次触发使用 `(bot_id, conversation_key, conversation_epoch, evidence_message_id)` 幂等；任务重试不增加次数。
- 同一 `bot_id + conversation_key` 最多一条未读提醒；合并更新次数、最近原因和最近证据。
- 仅新建未读提醒播放“您有新的待处理提醒”；合并更新不重复播放。
- 内部原因和客户原话不得写入普通运行日志，也不得发送给客户。
- 标签提醒现有数据、语音、接口和行为保持不变。
- 第一版只订阅并展示当前 Bot 的提醒，不实现工作区级跨 Bot 汇总。
- 已读提醒默认保留 90 天；未读提醒不自动清理。
- 不引入新的运行时第三方依赖。

---

### Task 1: Agent 待处理提醒响应协议与证据校验

**Files:**
- Create: `src/attention-alert.js`
- Modify: `src/dclaw.js`
- Modify: `src/agent-response-gateway.js`
- Test: `tests/attention-alert.test.js`
- Test: `tests/agent-response-gateway.test.js`
- Test: `tests/dclaw-tags.test.js`
- Test: `tests/dclaw-handoff.test.js`

**Interfaces:**
- Consumes: new `customerEvidenceCandidates`; `tagEvidenceCandidates` temporarily remains compatible for tag audit.
- Produces: `normalizeAttentionAlert(value): { required, reason, evidenceMessageId, evidenceText }` and final Agent replies containing normalized `attentionAlert`.

- [ ] **Step 1: Write failing domain normalization tests**

Create `tests/attention-alert.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAttentionAlert } from "../src/attention-alert.js";

test("attention alerts normalize one required internal escalation", () => {
  assert.deepEqual(normalizeAttentionAlert({
    required: true,
    reason: "需要人工确认当地法规",
    evidenceMessageId: "41",
    evidenceText: "这个产品可以寄到德国吗？"
  }), {
    required: true,
    reason: "需要人工确认当地法规",
    evidenceMessageId: "41",
    evidenceText: "这个产品可以寄到德国吗？"
  });
});

test("attention alerts default to disabled", () => {
  assert.deepEqual(normalizeAttentionAlert(undefined), {
    required: false, reason: "", evidenceMessageId: "", evidenceText: ""
  });
});
```

- [ ] **Step 2: Run the domain test and verify RED**

Run: `node --test tests/attention-alert.test.js`

Expected: FAIL because `src/attention-alert.js` does not exist.

- [ ] **Step 3: Implement the normalizer**

Create `src/attention-alert.js`:

```js
export function normalizeAttentionAlert(value) {
  if (!value || value.required !== true) {
    return Object.freeze({ required: false, reason: "", evidenceMessageId: "", evidenceText: "" });
  }
  return Object.freeze({
    required: true,
    reason: value.reason.trim(),
    evidenceMessageId: value.evidenceMessageId.trim(),
    evidenceText: value.evidenceText.trim()
  });
}
```

- [ ] **Step 4: Add failing gateway tests for required fields and exact evidence**

Extend `tests/agent-response-gateway.test.js` with cases asserting:

```js
const evidence = [{ id: "41", text: "这个产品可以寄到德国吗？" }];

// accepted
assert.equal(validated.attentionAlert.required, true);
assert.equal(validated.attentionAlert.evidenceMessageId, "41");

// rejected by validation errors
// required=true with blank reason
// evidenceMessageId not in evidence candidates
// evidenceText differs from the canonical candidate text
```

Also assert `required=false` does not require evidence and normalizes empty fields. Assert `required: "true"`, missing required fields, and overlong reason/evidence are schema failures that request a retry rather than being truncated or disabled.

- [ ] **Step 5: Run gateway tests and verify RED**

Run: `node --test tests/agent-response-gateway.test.js tests/dclaw-tags.test.js tests/dclaw-handoff.test.js`

Expected: FAIL because the response schema and validation do not recognize `attentionAlert`.

- [ ] **Step 6: Extend request instructions, schema parsing, and gateway validation**

In `src/dclaw.js`, add the following instruction only to customer-conversation and handoff-audit requests:

```js
"如果当前客户问题无法依据现有规则或知识可靠回答、必须人工查询或确认，请设置 attentionAlert.required=true，并引用本次 customerEvidenceCandidates 中对应客户消息的 id 和原文；不要根据你自己准备发送的回复报警。"
```

Build and include `customerEvidenceCandidates` for every ordinary conversation and handoff audit request, regardless of tag configuration. Extend both final JSON schema examples with:

```json
"attentionAlert":{"required":false,"reason":"","evidenceMessageId":"","evidenceText":""}
```

In `src/agent-response-gateway.js`, validate the raw field before normalization:

```js
parsed.attentionAlert = normalizeAttentionAlert(parsed.attentionAlert);
```

Missing `attentionAlert` is valid. When present, `required` must be boolean. When true, reject blank/overlong fields unless the evidence ID/text pair exactly matches `customerEvidenceCandidates`. Do not silently truncate or convert invalid types. Handoff audit must always use this gateway while enforcing `reply=""`.

- [ ] **Step 7: Run protocol tests and verify GREEN**

Run: `node --test tests/attention-alert.test.js tests/agent-response-gateway.test.js tests/dclaw-tags.test.js tests/dclaw-handoff.test.js`

Expected: all selected tests pass.

- [ ] **Step 8: Commit the protocol unit**

```bash
git add src/attention-alert.js src/dclaw.js src/agent-response-gateway.js \
  tests/attention-alert.test.js tests/agent-response-gateway.test.js tests/dclaw-tags.test.js tests/dclaw-handoff.test.js
git commit -m "feat: add Agent attention alert protocol"
```

---

### Task 2: 未读提醒的原子创建、合并与已读状态

**Files:**
- Modify: `src/db.js`
- Test: `tests/db-attention-alerts.test.js`
- Test: `tests/db-reset.test.js`

**Interfaces:**
- Consumes: existing conversations and conversation message IDs.
- Produces:
  - `recordAttentionAlertOccurrence({ botId, agentId, conversationKey, conversationEpoch, evidenceMessageId, ... }): { alert, created, duplicate }`
  - `listUnreadAttentionAlerts({ botId, limit }): AttentionAlert[]`
  - `markAttentionAlertRead({ botId, alertId, nowIso }): AttentionAlert | null`

- [ ] **Step 1: Write failing database tests**

Create `tests/db-attention-alerts.test.js` using a temporary `DATABASE_PATH`. Seed one Bot conversation and two customer messages, then assert:

```js
const first = recordAttentionAlertOccurrence({
  botId, agentId, conversationKey, conversationEpoch: 1, customerName: "Ada",
  reason: "需要确认法规", evidenceMessageId: firstMessage.id,
  evidenceText: firstMessage.content, nowIso: "2026-08-09T01:00:00.000Z"
});
assert.equal(first.created, true);
assert.equal(first.alert.occurrenceCount, 1);

const merged = recordAttentionAlertOccurrence({
  botId, agentId, conversationKey, conversationEpoch: 1, customerName: "Ada",
  reason: "客户再次追问", evidenceMessageId: secondMessage.id,
  evidenceText: secondMessage.content, nowIso: "2026-08-09T01:01:00.000Z"
});
assert.equal(merged.created, false);
assert.equal(merged.alert.id, first.alert.id);
assert.equal(merged.alert.occurrenceCount, 2);
assert.equal(merged.alert.evidenceMessageId, secondMessage.id);
```

Also assert Bot isolation, invalid evidence rejection, mark-read behavior, a new row after read for a genuinely new trigger, and concurrent/sequential calls with the same stable trigger returning `duplicate=true` without changing count. Explicitly mark the alert read and replay the same trigger to prove it does not create another alert.

- [ ] **Step 2: Run database tests and verify RED**

Run: `node --test tests/db-attention-alerts.test.js`

Expected: FAIL because the table and functions do not exist.

- [ ] **Step 3: Add the table and partial unique index**

In `src/db.js` schema initialization:

```sql
CREATE TABLE IF NOT EXISTS attention_alert_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  conversation_key TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  evidence_message_id INTEGER NOT NULL,
  evidence_text TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  first_triggered_at TEXT NOT NULL,
  last_triggered_at TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attention_alert_events_one_unread
ON attention_alert_events (bot_id, conversation_key)
WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS attention_alert_occurrences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL,
  conversation_key TEXT NOT NULL,
  conversation_epoch TEXT NOT NULL,
  evidence_message_id INTEGER NOT NULL,
  alert_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (bot_id, conversation_key, conversation_epoch, evidence_message_id)
);
```

Add an unread lookup index on `(bot_id, read_at, last_triggered_at)`.

- [ ] **Step 4: Implement row mapping and atomic merge**

Use `BEGIN IMMEDIATE`. Resolve `evidence_message_id` against the same Bot and conversation. Inside the transaction, check/insert the stable occurrence first; a duplicate returns the existing alert without any update. Only a new occurrence may select/update the unread aggregate or insert a new one, then bind the occurrence to that alert. The trigger unique index and unread partial index are separate correctness boundaries.

Return public camelCase fields including `alertType: "attention"`, `occurrenceCount`, `firstTriggeredAt`, `lastTriggeredAt`, and `readAt`.

- [ ] **Step 5: Clear attention alerts during destructive conversation reset**

In `clearConversationForReset`, delete occurrences before alerts for that exact Bot and conversation in the existing transaction. Extend `tests/db-reset.test.js` to verify both are removed. Add a maintenance function that deletes read alerts and their occurrences after 90 days without touching unread rows.

- [ ] **Step 6: Run database/reset tests and verify GREEN**

Run: `node --test tests/db-attention-alerts.test.js tests/db-reset.test.js`

Expected: all selected tests pass.

- [ ] **Step 7: Commit persistence**

```bash
git add src/db.js tests/db-attention-alerts.test.js tests/db-reset.test.js
git commit -m "feat: persist merged attention alerts"
```

---

### Task 3: 最终 Agent 响应创建提醒但不改变接管状态

**Files:**
- Create: `src/attention-alert-service.js`
- Modify: `src/server.js`
- Test: `tests/attention-alert-service.test.js`
- Test: `tests/server-attention-alert-boundary.test.js`
- Test: `tests/server-handoff-boundary.test.js`

**Interfaces:**
- Consumes: normalized final `agentReply.attentionAlert`, current Bot/binding/conversation, and current evidence candidates.
- Produces: `applyAgentAttentionAlert({ botId, binding, conversationKey, conversationEpoch, agentReply, evidenceCandidates }): { alert, created, duplicate } | null`.

- [ ] **Step 1: Write failing service tests**

Create `tests/attention-alert-service.test.js` with injected `resolveEvidence` and `upsertAlert`. Assert:

```js
assert.equal(applyAgentAttentionAlert({
  agentReply: { attentionAlert: { required: false } }, ...context
}), null);

const result = applyAgentAttentionAlert({
  agentReply: { attentionAlert: {
    required: true, reason: "需要人工确认",
    evidenceMessageId: "41", evidenceText: "可以寄到德国吗？"
  }},
  evidenceCandidates: [{ id: "41", conversationMessageId: 41, text: "可以寄到德国吗？" }],
  ...context
});
assert.equal(result.alert.evidenceMessageId, 41);
```

Assert that an absent candidate returns null or throws a validation-class error without writing an alert.

- [ ] **Step 2: Run service tests and verify RED**

Run: `node --test tests/attention-alert-service.test.js`

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement the focused service**

Create `src/attention-alert-service.js`. It must:

- Return null unless `required === true`.
- Resolve the evidence ID only from `evidenceCandidates`.
- Derive Bot, Agent, conversation and customer name from trusted server context.
- Call `recordAttentionAlertOccurrence` with the conversation epoch, local evidence message ID and canonical evidence text.
- Never log or return the full Agent response.

- [ ] **Step 4: Add server boundary tests before integration**

Create `tests/server-attention-alert-boundary.test.js` and assert source ordering:

```js
assert.ok(finalValidationIndex < applyAttentionIndex);
assert.ok(applyAttentionIndex < channelSendIndex);
assert.doesNotMatch(applyAttentionBlock, /updateFlowSessionHandoff|handoffStatus/);
```

Assert both final response paths call the helper:

- normal/coalesced Agent response;
- human-handoff transcript audit response (which may return an empty customer reply but can still raise the alert).

- [ ] **Step 5: Integrate only after successful final response validation**

In `src/server.js`, invoke `applyAgentAttentionAlert` beside the existing final tag-decision application. Pass the stable conversation epoch and customer evidence; persist before any external Channel send. A repeated trigger must return `duplicate=true`, skip publishing and leave counts unchanged. Do not add calls to `updateFlowSessionHandoff`.

Capture the returned `{ alert, created }` for realtime publication in Task 4. Log only `alertId`, `botId`, `conversationKey`, `created`, and `occurrenceCount`.

- [ ] **Step 6: Run focused server tests and verify GREEN**

Run: `node --test tests/attention-alert-service.test.js tests/server-attention-alert-boundary.test.js tests/server-handoff-boundary.test.js tests/server-agent-response-gateway-boundary.test.js`

Expected: all selected tests pass.

- [ ] **Step 7: Commit service integration**

```bash
git add src/attention-alert-service.js src/server.js \
  tests/attention-alert-service.test.js tests/server-attention-alert-boundary.test.js \
  tests/server-handoff-boundary.test.js
git commit -m "feat: create attention alerts from Agent decisions"
```

---

### Task 4: Bot 隔离的待处理提醒 API 与实时流

**Files:**
- Create: `src/attention-alert-stream.js`
- Create: `public/console/attention-alert-client.js`
- Modify: `src/server.js`
- Modify: `public/console/index.html`
- Test: `tests/attention-alert-stream.test.js`
- Test: `tests/server-attention-alert-api-boundary.test.js`
- Test: `tests/console-attention-alert-client.test.js`

**Interfaces:**
- Consumes: Task 2 database functions and Task 3 `{ alert, created }` result.
- Produces:
  - `GET /api/attention-alerts/stream?botId=...`
  - `GET /api/attention-alerts?botId=...`
  - `POST /api/attention-alerts/:alertId/read`
  - browser `window.createAttentionAlertClient(options)`.

- [ ] **Step 1: Write failing stream tests**

Mirror the existing tag alert stream test shape, but assert events:

```js
{ type: "snapshot", alerts: [...] }
{ type: "created", alert: {...} }
{ type: "updated", alert: {...} }
{ type: "read", alert: {...} }
```

Verify events reach only subscribers for the matching Bot, closed connections stop receiving data, and heartbeat comments do not alter state.

- [ ] **Step 2: Run stream tests and verify RED**

Run: `node --test tests/attention-alert-stream.test.js`

Expected: FAIL because the stream hub does not exist.

- [ ] **Step 3: Implement the SSE hub**

Create `src/attention-alert-stream.js` following the transport shape of `src/tag-alert-stream.js`, with `subscribe`, `publishCreated`, `publishUpdated`, `publishRead`, and `close`. `subscribe` must register the connection before awaiting/invoking its snapshot loader. Keep Bot-scoped subscriber maps and a bounded heartbeat timer.

- [ ] **Step 4: Write failing API and browser-client boundary tests**

Assert all three endpoints call `assertBotAccess`, list only unread rows for the selected Bot, commit mark-read before publishing, and return 404 for a missing/mismatched alert. Add a race test that publishes after subscription registration but before snapshot delivery and proves the client retains the alert exactly once. Assert the browser client uses authenticated streaming, applies snapshot/create/update/read idempotently by alert ID, and stops reconnecting on 401.

- [ ] **Step 5: Add routes and publish service results**

In `src/server.js`:

- Create one attention-alert hub.
- On Task 3 result, publish `created` only when `created=true`; otherwise publish `updated`.
- Implement list, SSE, and read routes with the same session and Bot-access middleware as tag alerts. The SSE route subscribes first and loads/sends its database snapshot through the registered connection afterward.
- Publish `read` only after `markAttentionAlertRead` commits.
- Close the hub during server shutdown.

- [ ] **Step 6: Implement the browser state client**

Create `public/console/attention-alert-client.js`, keyed by numeric alert ID. Expose `start(botId)`, `stop()`, `snapshot()`, and callbacks `onState`, `onCreated`, `onUpdated`, `onUnauthorized`. Load it before `app.js` in `public/console/index.html`.

- [ ] **Step 7: Run API/stream/client tests and verify GREEN**

Run: `node --test tests/attention-alert-stream.test.js tests/server-attention-alert-api-boundary.test.js tests/console-attention-alert-client.test.js`

Expected: all selected tests pass.

- [ ] **Step 8: Commit realtime infrastructure**

```bash
git add src/attention-alert-stream.js src/server.js public/console/attention-alert-client.js \
  public/console/index.html tests/attention-alert-stream.test.js \
  tests/server-attention-alert-api-boundary.test.js tests/console-attention-alert-client.test.js
git commit -m "feat: stream Bot attention alerts"
```

---

### Task 5: 统一提醒中心、独立语音和消息定位

**Files:**
- Create: `public/console/assets/attention-alert.mp3`
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Test: `tests/console-attention-alerts-boundary.test.js`
- Test: `tests/console-tag-alerts-boundary.test.js`

**Interfaces:**
- Consumes: Task 4 browser client and existing conversation evidence navigation.
- Produces: one combined reminder center showing `tag` and `attention` items, plus distinct audio playback.

- [ ] **Step 1: Write failing UI/audio boundary tests**

Create `tests/console-attention-alerts-boundary.test.js` asserting:

```js
assert.match(html, /<audio[^>]*id="attentionAlertAudio"[^>]*preload="auto"[^>]*attention-alert\.mp3/);
assert.match(app, /createAttentionAlertClient/);
assert.match(app, /alertType\s*===\s*"attention"/);
assert.match(app, /attentionAlertAudio\.play/);
assert.match(app, /anchorMessageId:\s*alert\.evidenceMessageId/);
assert.match(app, /occurrenceCount/);
```

Assert `updated` does not call the audio function, `created` does, clicking uses the existing anchored conversation loader, and the tag alert audio path remains unchanged.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `node --test tests/console-attention-alerts-boundary.test.js tests/console-tag-alerts-boundary.test.js`

Expected: the new test fails while existing tag tests stay green.

- [ ] **Step 3: Add and verify the dedicated spoken asset**

Create a Chinese MP3 saying exactly “您有新的待处理提醒” and save it as `public/console/assets/attention-alert.mp3`. Do not overwrite `tag-voice-alert.mp3`.

Generate the asset with the macOS Mandarin voice and FFmpeg available in this workspace:

```bash
audio_tmp_dir="$(mktemp -d)"
say -v Tingting -o "$audio_tmp_dir/attention-alert.aiff" "您有新的待处理提醒"
ffmpeg -y -i "$audio_tmp_dir/attention-alert.aiff" \
  -codec:a libmp3lame -q:a 4 public/console/assets/attention-alert.mp3
```

Verify it is a nonempty MP3:

```bash
node --input-type=module --eval '
import fs from "node:fs";
const audio = fs.readFileSync("public/console/assets/attention-alert.mp3");
if (audio.length < 1000) process.exit(1);
const id3 = audio.subarray(0, 3).toString("latin1") === "ID3";
const frame = audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0;
if (!id3 && !frame) process.exit(1);
'
```

- [ ] **Step 4: Add the second preloaded audio element and shared unlock behavior**

Add:

```html
<audio id="attentionAlertAudio" preload="auto" src="./assets/attention-alert.mp3"></audio>
```

Extend the existing user-gesture audio unlock so both alert audio elements are primed without audible playback.

- [ ] **Step 5: Merge attention alerts into the existing reminder presentation**

Keep separate state maps, then produce one view model sorted by latest event time. Attention cards display:

- distinct pending-attention icon and CSS class;
- customer name;
- `reason`;
- evidence text preview;
- `occurrenceCount > 1` as `已合并 N 次`;
- last-triggered time.

Do not label these cards as customer tags. Keep unread count as the combined number of unread rows, not occurrence totals.

- [ ] **Step 6: Implement created/update sound behavior and click navigation**

On an attention `created` event, call the dedicated audio playback once. On `updated`, refresh the card without sound. Connect only for `state.selectedBotId`; switching Bot replaces the subscription and snapshot. Clicking:

```js
await openAlertConversation({
  botId: alert.botId,
  conversationKey: alert.conversationKey,
  anchorMessageId: alert.evidenceMessageId,
  alertType: "attention"
});
await request(`/api/attention-alerts/${alert.id}/read`, { method: "POST" });
```

Reuse the existing evidence window and highlight classes, but render the note “此消息触发待处理提醒”. Preserve the current missing-evidence fallback.

- [ ] **Step 7: Run UI regression tests and verify GREEN**

Run: `node --test tests/console-attention-alerts-boundary.test.js tests/console-tag-alerts-boundary.test.js tests/console-handoff-boundary.test.js tests/console-chat-media-rendering.test.js`

Expected: all selected tests pass.

- [ ] **Step 8: Commit the UI and audio**

```bash
git add public/console/assets/attention-alert.mp3 public/console/index.html \
  public/console/app.js public/console/styles.css \
  tests/console-attention-alerts-boundary.test.js tests/console-tag-alerts-boundary.test.js
git commit -m "feat: show and announce attention alerts"
```

---

### Task 6: End-to-end verification, documentation, review, and handoff

**Files:**
- Modify: `README.md`
- Modify: `docs/whapi-cloud-channel-adapter-migration-plan.md`
- Test: all relevant files under `tests/`

**Interfaces:**
- Consumes: Tasks 1–5 complete feature.
- Produces: documented, reviewed, committed and deployable feature in the current `main` worktree.

- [ ] **Step 1: Add one HTTP-level integration test**

Create or extend a server integration test that uses a fake Agent response containing a valid `attentionAlert`. Verify:

- the customer reply still sends normally;
- one unread attention reminder is persisted;
- a second trigger for the same conversation updates the same ID and increments count;
- the flow session remains `handoff_status != "human"`;
- marking read permits a later trigger to create a new ID;
- replaying the same stable trigger before or after read does not increment, recreate, publish or play again;
- an alert committed before a simulated channel-send failure remains idempotent when the same inbound job is retried;
- the evidence endpoint returns a window containing the latest anchored customer message.

- [ ] **Step 2: Document exact operator behavior**

In `README.md` and the migration plan document:

- explain that the Agent emits a structured internal alert rather than matching reply phrases;
- distinguish customer tag reminders from attention reminders;
- state that attention reminders do not switch handoff mode;
- document unread merge and click-to-evidence behavior;
- state that only new reminder rows play “您有新的待处理提醒”.

- [ ] **Step 3: Run security-focused searches**

Run:

```bash
rg -n "attention.*(token|secret)|log(?:Info|Warn|Error).*?(reason|evidenceText)|console\.log.*attention" src public
rg -n "attentionAlert.*updateFlowSessionHandoff|attentionAlert.*handoff_status" src
```

Expected: no credentials, full reasons, customer evidence, or automatic handoff mutations are logged or coupled to the alert path.

- [ ] **Step 4: Run the focused feature suite**

Run:

```bash
node --test \
  tests/attention-alert.test.js \
  tests/agent-response-gateway.test.js \
  tests/db-attention-alerts.test.js \
  tests/attention-alert-service.test.js \
  tests/attention-alert-stream.test.js \
  tests/server-attention-alert-boundary.test.js \
  tests/server-attention-alert-api-boundary.test.js \
  tests/console-attention-alert-client.test.js \
  tests/console-attention-alerts-boundary.test.js
```

Expected: zero failures.

- [ ] **Step 5: Run the full regression suite**

Run: `npm test`

Expected: zero failures; existing intentional skips may remain.

- [ ] **Step 6: Request code review and fix every Critical/Important finding**

Review the complete diff against `docs/superpowers/specs/2026-08-09-agent-attention-alert-design.md`, focusing on duplicate customer replies, false alerts from retry drafts, Bot isolation, evidence forgery, unread merge races, unintended handoff, SSE recovery, sound spam, and sensitive logs. After fixes, rerun Steps 3–5.

- [ ] **Step 7: Commit documentation or review corrections**

```bash
git add README.md docs/whapi-cloud-channel-adapter-migration-plan.md src public tests
git commit -m "docs: describe Agent attention alerts"
```

If there are no remaining changes, skip the empty commit.

- [ ] **Step 8: Stop after verified commits and report deployment readiness**

```bash
git status --short
```

Expected: clean working tree. Do not push until the user explicitly requests `push`.

---

### Task 7: 修复“参考答案 + 后续确认承诺”漏报

**Files:**
- Modify: `src/dclaw.js`
- Test: `tests/dclaw-tags.test.js`
- Test: `tests/dclaw-handoff.test.js`

**Interfaces:**
- Consumes: `buildDclawRequest(...)` 和 `buildDclawHandoffTranscriptRequest(...)` 生成的 Agent 请求消息。
- Produces: 普通会话和 handoff audit 共用的明确判定规则；服务端仍只接受结构化 `attentionAlert`，不扫描最终回复文案。

- [ ] **Step 1: 写入生产漏报场景的失败测试**

在普通会话提示词测试中断言请求包含以下完整语义：如果准备发送的客户回复承诺稍后查询、确认、核实、询问他人或跟进后再答复，即使同时给出参考答案，也必须设置 `attentionAlert.required=true`。在 handoff audit 测试中断言同一规则存在，且 `reply` 仍被要求为空字符串。

- [ ] **Step 2: 运行测试并确认因规则缺失而失败**

Run:

```bash
node --test tests/dclaw-tags.test.js tests/dclaw-handoff.test.js
```

Expected: 新增断言失败，失败内容显示现有提示词没有覆盖“参考答案 + 后续确认承诺”。

- [ ] **Step 3: 最小化修改普通和 handoff 提示词**

修改 `src/dclaw.js` 中两条待处理提醒指令，加入同一条强制规则：

```text
如果你准备发送的客户回复承诺稍后查询、确认、核实、询问他人或跟进后再答复，即使回复中同时提供了参考答案，也必须设置 attentionAlert.required=true，并引用促成该后续事项的客户消息。不要因为已有部分答案而设置 required=false。
```

不得增加第二次 Agent 调用，不得新增服务端关键词匹配，不得改变提醒数据库、SSE、前端或人工接手状态。

- [ ] **Step 4: 运行专项与全量测试**

Run:

```bash
node --test tests/dclaw-tags.test.js tests/dclaw-handoff.test.js tests/agent-response-gateway.test.js
npm test
```

Expected: zero failures; existing intentional skips may remain.

- [ ] **Step 5: 提交并停止等待推送授权**

```bash
git add src/dclaw.js tests/dclaw-tags.test.js tests/dclaw-handoff.test.js \
  docs/superpowers/specs/2026-08-09-agent-attention-alert-design.md \
  docs/superpowers/plans/2026-08-09-agent-attention-alert.md
git commit -m "fix: require alerts for promised follow-up"
```

Do not push until the user explicitly requests `push`.
