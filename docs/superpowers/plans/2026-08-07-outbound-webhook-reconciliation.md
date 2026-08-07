# Whapi 出站 Webhook 会话补录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 幂等补录未经过本服务标准发送落库链路的 Whapi 出站消息，并恢复用户确认的三条历史漏记记录。

**Architecture:** 标准化 Whapi 事件继续由现有 mapper 产生。新增独立的出站对账模块和数据库事务函数；实时 Worker 在客户入站桥接之前对 `message.sent` 执行对账，历史 CLI 则按原始 Webhook 顺序重放三个获批消息及其状态事件。

**Tech Stack:** Node.js ESM、Node 内置 SQLite、`node:test`、现有 Whapi Channel contract

## Global Constraints

- 对账身份严格包含 Bot、provider、channel account 和消息 ID。
- 出站 Webhook 不得进入客户入站、Agent 调用或业务自动化路径。
- 已有发送记录或已有会话消息关联同一消息 ID时不得重复创建气泡。
- 普通文本、link preview 正文和媒体 caption 必须保留为可见内容。
- 历史回填只允许三个已确认消息 ID，并按原始时间落位。
- 第二次实时回调或回填必须新增零条。
- 不新增轮询、SSE 或 WebSocket。
- 不改变标准发送 API、状态推进和当前人工回复附件行为。
- 保留工作区现有未提交修改；每次只暂存本任务的明确文件或补丁块。

---

### Task 1: 出站消息对账事务

**Files:**
- Create: `src/outbound-webhook-reconciliation.js`
- Create: `tests/outbound-webhook-reconciliation.test.js`
- Modify: `src/db.js`
- Test: `tests/db-channel-delivery-status.test.js`

**Interfaces:**
- Consumes: 标准事件 `{ provider, channelAccountId, eventType, occurredAt, chat, message, rawPayload }`。
- Produces: `reconcileOutboundWebhookMessage({ botId, event, senderName })`，返回 `{ outcome, conversationMessageId, outgoingInserted }`。
- Produces: 数据库函数 `persistReconciledOutboundMessage(input)`，在一个事务内完成身份检查和必要插入。

- [ ] **Step 1: 写纯事件准入与内容测试**

在 `tests/outbound-webhook-reconciliation.test.js` 使用真实标准事件，断言：

```js
assert.deepEqual(outboundWebhookRecord({ botId: "bot-a", event: sentLinkEvent }), {
  botId: "bot-a",
  provider: "whapi",
  channelAccountId: "CHAN-A",
  conversationKey: "whapi:CHAN-A:private:16464068041@s.whatsapp.net",
  messageId: "external-1",
  content: "验证密匙是 ABC",
  occurredAt: "2026-08-07T14:12:37.000Z",
  deliveryStatus: "sent",
  rawPayload: sentLinkEvent.rawPayload
});
assert.equal(outboundWebhookRecord({ botId: "bot-a", event: receivedEvent }), null);
assert.equal(outboundWebhookRecord({ botId: "bot-a", event: statusEvent }), null);
```

另测空正文且无可读附件的事件返回 `null`；媒体无 caption 时产生现有风格的可读占位文本。

- [ ] **Step 2: 运行测试验证 RED**

Run: `node --test tests/outbound-webhook-reconciliation.test.js`

Expected: FAIL，因为模块尚不存在。

- [ ] **Step 3: 实现纯事件转换**

在 `src/outbound-webhook-reconciliation.js` 导出：

```js
export function outboundWebhookRecord({ botId, event }) {
  if (event?.eventType !== "message.sent" || event?.message?.fromMe !== true) return null;
  const content = String(event.message.text || "").trim()
    || readableAttachmentPlaceholder(event.message.attachments);
  if (!content) return null;
  return {
    botId,
    provider: event.provider,
    channelAccountId: event.channelAccountId,
    conversationKey: channelConversationKey(event),
    messageId: event.message.externalId,
    content,
    occurredAt: event.occurredAt,
    deliveryStatus: normalizedInitialStatus(event.rawPayload?.status),
    rawPayload: event.rawPayload
  };
}
```

只接受 `pending/sent/delivered/read/played/failed`；缺失或未知状态规范化为 `sent`。

- [ ] **Step 4: 运行纯函数测试验证 GREEN**

Run: `node --test tests/outbound-webhook-reconciliation.test.js`

Expected: 0 fail。

- [ ] **Step 5: 写数据库幂等和隔离失败测试**

在同一测试文件使用隔离 `DATA_DIR` 后动态导入 `src/db.js`，覆盖：

```js
const first = persistReconciledOutboundMessage(record);
assert.equal(first.outcome, "inserted");
assert.equal(listConversationMessages({ botId, conversationKey }).length, 1);

const duplicate = persistReconciledOutboundMessage(record);
assert.equal(duplicate.outcome, "existing_outgoing");
assert.equal(listConversationMessages({ botId, conversationKey }).length, 1);
```

再验证：

- 已有标准发送记录时不新增气泡。
- 已有会话 raw payload 关联消息 ID但缺少发送记录时只补发送记录。
- 相同消息 ID在其他 Bot、provider、account 或 conversation 下不阻止插入。
- 缺少目标 `conversations` 记录返回 `missing_conversation`，不写任何表。
- 新记录使用 `occurredAt` 写入两个表，并保存 `source: "channel_outbound_webhook"`、`channelMessageId`、provider 和 account。

- [ ] **Step 6: 运行数据库测试验证 RED**

Run: `node --test tests/outbound-webhook-reconciliation.test.js`

Expected: FAIL，因为数据库事务函数尚不存在。

- [ ] **Step 7: 实现原子对账函数**

在 `src/db.js` 导出：

```js
export function persistReconciledOutboundMessage({
  botId, provider, channelAccountId, conversationKey, messageId,
  content, occurredAt, deliveryStatus, rawPayload, senderName = "机器人"
})
```

使用 `BEGIN IMMEDIATE`，按以下顺序执行并在所有出口 `COMMIT`：

1. 验证 conversation 属于同一 Bot。
2. 查询 scoped `outgoing_messages`；存在则返回 `existing_outgoing`。
3. 查询 conversation raw payload 的 `messageId/channelMessageId/channelMessageIds`；存在则不插气泡。
4. 插入缺少的 outbound conversation row，时间为 `new Date(occurredAt).toISOString()`。
5. 插入 outgoing row，provider/account/status/更新时间和创建时间均明确写入。
6. 返回 `inserted` 或 `existing_conversation`；异常时 `ROLLBACK`。

在 `src/outbound-webhook-reconciliation.js` 导出薄封装：

```js
export function reconcileOutboundWebhookMessage({ botId, event, senderName, persist }) {
  const record = outboundWebhookRecord({ botId, event });
  return record
    ? persist({ ...record, senderName })
    : { outcome: "ignored", conversationMessageId: null, outgoingInserted: false };
}
```

- [ ] **Step 8: 运行定向回归**

Run: `node --test tests/outbound-webhook-reconciliation.test.js tests/db-channel-delivery-status.test.js tests/db-ai-message-delivery-status.test.js`

Expected: 0 fail。

- [ ] **Step 9: 提交 Task 1**

只暂存本任务新增文件和 `src/db.js` 中本任务对应补丁块；若 `src/db.js` 同时含用户未提交修改，使用 `git diff` 核对后交互式或生成最小补丁暂存，绝不暂存附件功能改动。

```bash
git add src/outbound-webhook-reconciliation.js tests/outbound-webhook-reconciliation.test.js
git add -p src/db.js
git commit -m "fix: reconcile external outbound messages"
```

### Task 2: 实时 Webhook 接入

**Files:**
- Modify: `src/server.js`
- Create: `tests/server-outbound-webhook-reconciliation-boundary.test.js`
- Test: `tests/server-whapi-webhook.test.js`
- Test: `tests/channel-core-message-bridge.test.js`

**Interfaces:**
- Consumes: Task 1 的 `reconcileOutboundWebhookMessage` 和 `persistReconciledOutboundMessage`。
- Produces: `dispatchChannelWebhookEvent` 在调用 `toCoreMessage` 前独立处理 `message.sent`。

- [ ] **Step 1: 写实时分发失败测试**

新增紧边界测试，提取 `dispatchChannelWebhookEvent` 函数体并断言：

```js
assert.match(body, /if \(event\.eventType === "message\.sent"\)/);
assert.match(body, /reconcileOutboundWebhookMessage\(\{/);
assert.ok(body.indexOf("reconcileOutboundWebhookMessage({") < body.indexOf("toCoreMessage(event)"));
```

同时断言该分支 `return`，防止外部出站消息进入 `processIncomingMessage`。

- [ ] **Step 2: 运行测试验证 RED**

Run: `node --test tests/server-outbound-webhook-reconciliation-boundary.test.js`

Expected: FAIL，因为实时分支尚不存在。

- [ ] **Step 3: 接入实时对账**

在 `src/server.js` 导入 Task 1 接口与数据库函数，并在 group/status 分支之后、`toCoreMessage` 之前加入：

```js
if (event.eventType === "message.sent") {
  const binding = getBotBinding(envelope.botId);
  reconcileOutboundWebhookMessage({
    botId: envelope.botId,
    event,
    senderName: binding?.botName || binding?.agentName || "机器人",
    persist: persistReconciledOutboundMessage
  });
  return;
}
```

不修改 `toCoreMessage` 对 `fromMe` 的防护，因为它仍负责阻止出站消息进入客户入站路径。

- [ ] **Step 4: 运行实时回归**

Run: `node --test tests/server-outbound-webhook-reconciliation-boundary.test.js tests/server-whapi-webhook.test.js tests/channel-core-message-bridge.test.js tests/channel-webhook-worker.test.js`

Expected: 0 fail。

- [ ] **Step 5: 提交 Task 2**

`src/server.js` 当前包含用户未提交的附件功能；只暂存本任务的 import 和 dispatch 分支。

```bash
git add tests/server-outbound-webhook-reconciliation-boundary.test.js
git add -p src/server.js
git commit -m "fix: capture outbound Whapi webhooks"
```

### Task 3: 三条限定历史回填 CLI

**Files:**
- Create: `scripts/backfill-outbound-webhooks.js`
- Create: `tests/backfill-outbound-webhooks.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `listChannelWebhookEvents(botId)`、`normalizeWhapiWebhook`、`reconcileOutboundWebhookMessage`、`updateOutgoingMessageChannelStatus`。
- Produces: CLI `npm run backfill:outbound-webhooks -- --bot-id whatsapp-sales-01 --message-id <id>...`。

- [ ] **Step 1: 写参数白名单与顺序重放失败测试**

将脚本逻辑导出为：

```js
export async function backfillOutboundWebhooks({
  botId, messageIds, envelopes, normalize, reconcile, updateStatus
})
```

测试使用三个已确认 ID的 message/status Webhook 夹具，断言：

- 未包含在 `messageIds` 的出站消息不处理。
- envelope 按 `id` 升序，先补消息再推进 `delivered/read`。
- 三条首次运行汇总 `{ inserted: 3, existing: 0, ignored: 0 }`。
- 第二次运行汇总 `{ inserted: 0, existing: 3, ignored: 0 }`。
- 缺少 `--bot-id`、没有 `--message-id` 或传入未批准 ID时 CLI 参数解析失败且不写库。

- [ ] **Step 2: 运行测试验证 RED**

Run: `node --test tests/backfill-outbound-webhooks.test.js`

Expected: FAIL，因为脚本尚不存在。

- [ ] **Step 3: 实现限定回填脚本**

脚本内定义不可变批准集合：

```js
const APPROVED_MESSAGE_IDS = new Set([
  "Psq87jVFbilb.xs-wNID1VW9yQ",
  "PsqlbmrN6JN3Z0M-wFwD1VW9yQ",
  "PspJAVWgozw4Nyg-wOAD1VW9yQ"
]);
```

实现要求：

1. 从 `listChannelWebhookEvents(botId)` 读取 envelope，并按 `id` 升序。
2. 使用 `normalizeWhapiWebhook` 生成标准事件。
3. 仅处理获批且由参数明确传入的三个消息 ID。
4. `message.sent` 调用实时对账；`status.*` 调用现有状态推进函数。
5. 输出每个 ID的 `inserted/existing/missing` 结果和 JSON 汇总。
6. 任一请求 ID在 Webhook 历史中找不到 message 事件时退出码非零。

在 `package.json` 增加：

```json
"backfill:outbound-webhooks": "node scripts/backfill-outbound-webhooks.js"
```

- [ ] **Step 4: 运行 CLI 测试和全部定向测试**

Run: `node --test tests/backfill-outbound-webhooks.test.js tests/outbound-webhook-reconciliation.test.js tests/server-outbound-webhook-reconciliation-boundary.test.js tests/server-whapi-webhook.test.js tests/whapi-mapper.test.js tests/db-channel-delivery-status.test.js`

Expected: 0 fail。

- [ ] **Step 5: 提交 Task 3**

```bash
git add scripts/backfill-outbound-webhooks.js tests/backfill-outbound-webhooks.test.js package.json
git commit -m "feat: backfill confirmed outbound messages"
```

### Task 4: 最终验证与生产回填说明

**Files:**
- Modify: `README.md`（仅加入一次性运维命令和幂等说明）

**Interfaces:**
- Consumes: Task 3 CLI。
- Produces: 可复制的部署后回填命令和验收查询。

- [ ] **Step 1: 添加精确运维命令**

在 README 运维段落记录：

```bash
npm run backfill:outbound-webhooks -- \
  --bot-id whatsapp-sales-01 \
  --message-id 'Psq87jVFbilb.xs-wNID1VW9yQ' \
  --message-id 'PsqlbmrN6JN3Z0M-wFwD1VW9yQ' \
  --message-id 'PspJAVWgozw4Nyg-wOAD1VW9yQ'
```

说明首次应 `inserted: 3`，再次应 `existing: 3`，然后点击后台会话“刷新”查看原始时间位置。

- [ ] **Step 2: 完整验证**

Run: `node --test tests/backfill-outbound-webhooks.test.js tests/outbound-webhook-reconciliation.test.js tests/server-outbound-webhook-reconciliation-boundary.test.js tests/server-whapi-webhook.test.js tests/whapi-mapper.test.js tests/channel-core-message-bridge.test.js tests/channel-webhook-worker.test.js tests/db-channel-delivery-status.test.js tests/db-ai-message-delivery-status.test.js tests/db-manual-message-delivery-status.test.js`

Run: `npm test`

Run: `git diff --check HEAD~4..HEAD`

Expected: 所有测试 0 fail，空白检查无输出。

- [ ] **Step 3: 范围审计**

Run: `git diff --stat f27e362..HEAD`

Run: `git status --short`

确认仅本任务提交进入历史，工作区原有人工附件文件仍保持未提交且内容未被覆盖。

- [ ] **Step 4: 代码审查**

使用 `superpowers:requesting-code-review` 审查 `f27e362..HEAD`。Critical/Important 必须修复并重新运行相关测试；无遗留问题后才能推送。

- [ ] **Step 5: 提交文档并推送 main**

```bash
git add README.md
git commit -m "docs: document outbound webhook backfill"
git push origin main
```

- [ ] **Step 6: 部署后执行与验收**

在生产更新并重建容器后，在容器内运行 README 的限定回填命令。随后用只读 SQL 验证三个消息 ID各有一条 `outgoing_messages`、各关联一条 `conversation_messages`，状态回放为最新合法状态，并在控制台点击“刷新”确认三条内容按原始时间出现。
