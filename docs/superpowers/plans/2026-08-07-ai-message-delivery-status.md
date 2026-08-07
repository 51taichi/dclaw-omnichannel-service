# AI 自动回复送达状态 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AI 自动回复气泡汇总并显示全部 Whapi 文本分段与附件的送达状态。

**Architecture:** `outgoing_messages` 保持每个外部消息 ID的状态事实来源。数据库批量关联人工单消息与 AI 多消息并汇总 AI 气泡状态；前端只渲染数据库返回的汇总结果。

**Tech Stack:** Node.js ESM、Node 内置 SQLite、原生浏览器 JavaScript、`node:test`

## Global Constraints

- 任一 `failed` → `failed`；否则任一 `pending/sent` → `sent`；否则任一 `delivered` → `delivered`；否则全部 `read/played` → `read`。
- 声明多个 ID但仅找到部分记录时显示 `sent`；全部缺失时隐藏状态。
- 人工消息现有状态行为保持不变。
- `outgoing_messages` 是唯一事实来源，不写入汇总状态。
- 查询限制 Bot、conversation、provider 和 channel account。
- 不修改 Whapi Webhook、状态推进、发送 API或刷新机制。
- 不新增轮询、SSE 或 WebSocket。

---

### Task 1: 数据库 AI 多消息状态汇总

**Files:**
- Modify: `src/db.js`
- Create: `tests/db-ai-message-delivery-status.test.js`
- Test: `tests/db-manual-message-delivery-status.test.js`

**Interfaces:**
- Consumes: 会话消息的 `messageId`、`channelMessageId`、`channelMessageIds` 和发送记录的 `delivery_status`。
- Produces: `deliveryStatus`、`deliveryError`、`deliveryUpdatedAt`。

- [ ] **Step 1: 写单条 AI 状态失败测试**

插入带 `channelMessageIds: ["ai-message-1"]` 的 AI 出站消息及对应发送记录，分别断言 `pending`、`delivered`、`read`、`failed` 被装饰到会话消息。

- [ ] **Step 2: 运行测试验证 RED**

Run: `node --test tests/db-ai-message-delivery-status.test.js`

Expected: FAIL，因为当前装饰函数只接受 `source = manual_reply`。

- [ ] **Step 3: 写多段汇总失败测试**

覆盖：

```js
[
  { statuses: ["read", "failed"], expected: "failed" },
  { statuses: ["read", "pending"], expected: "sent" },
  { statuses: ["read", "sent"], expected: "sent" },
  { statuses: ["read", "delivered"], expected: "delivered" },
  { statuses: ["read", "played"], expected: "read" }
]
```

另测：两个 ID只找到一个 `read` → `sent`；全部缺失 → 隐藏；旧单值 `channelMessageId` → 正常；文本与附件 ID共同汇总。

- [ ] **Step 4: 实现身份提取与汇总**

在 `src/db.js` 将人工专用装饰函数改为通用出站装饰函数：

```js
function deliveryIdentityForConversationMessage(message, channelIdentity) {
  // 人工：messageId；AI：channelMessageIds，空时回退 channelMessageId
}

function aggregateAiDeliveryStatus({ declaredIds, rows }) {
  // 0 rows => null；部分缺失 => sent；否则按失败、已发送、已送达、全已读汇总
}

function attachOutgoingMessageDeliveryStatuses(messages, { botId, conversationKey }) {
  // 一次批量查询、完整身份隔离、最新记录选择、消息装饰
}
```

人工消息保留原始 `played`；AI 全部 `read/played` 规范化为 `read`。

- [ ] **Step 5: 增加隔离与元数据测试**

验证不同 Bot、conversation、provider、account 的相同 ID不会参与汇总，并验证：

```js
deliveryUpdatedAt === 参与记录中最晚的非空更新时间
deliveryError === failed 记录中第一条非空错误
```

- [ ] **Step 6: 运行数据库回归**

Run: `node --test tests/db-ai-message-delivery-status.test.js tests/db-manual-message-delivery-status.test.js tests/db-channel-delivery-status.test.js`

Expected: 0 fail。

- [ ] **Step 7: 提交**

```bash
git add src/db.js tests/db-ai-message-delivery-status.test.js tests/db-manual-message-delivery-status.test.js
git commit -m "feat: aggregate AI message delivery status"
```

### Task 2: 前端显示 AI 出站状态

**Files:**
- Modify: `public/console/app.js`
- Modify: `tests/console-manual-message-delivery-status.test.js`
- Test: `tests/console-chat-media-rendering.test.js`

**Interfaces:**
- Consumes: AI 出站消息的 `deliveryStatus` 和通道消息 ID。
- Produces: 与人工消息相同的固定安全状态 HTML。

- [ ] **Step 1: 写 AI 准入失败测试**

断言 outbound 且 `rawPayload.channelMessageIds` 非空的 AI 消息显示 `delivered`；断言 inbound、有状态但无通道 ID、未知状态均隐藏。

- [ ] **Step 2: 运行测试验证 RED**

Run: `node --test tests/console-manual-message-delivery-status.test.js`

Expected: FAIL，因为当前 renderer 只允许 `manual_reply`。

- [ ] **Step 3: 实现最小准入逻辑**

```js
function hasChannelMessageIdentity(message) {
  const raw = message?.rawPayload || {};
  return Boolean(
    String(raw.messageId || raw.channelMessageId || "").trim()
    || (Array.isArray(raw.channelMessageIds)
      && raw.channelMessageIds.some((id) => String(id || "").trim()))
  );
}
```

状态 renderer 仅允许 outbound 且人工消息或带通道身份的 AI 消息。

- [ ] **Step 4: 运行前端回归**

Run: `node --test tests/console-manual-message-delivery-status.test.js tests/console-chat-media-rendering.test.js`

Expected: 0 fail。

- [ ] **Step 5: 提交**

```bash
git add public/console/app.js tests/console-manual-message-delivery-status.test.js
git commit -m "feat: render AI delivery status"
```

### Task 3: AI 发送链路边界与全量验证

**Files:**
- Create: `tests/server-ai-message-delivery-status-boundary.test.js`
- Modify: `src/server.js`（仅在行为测试证明缺少关联字段时）

**Interfaces:**
- Consumes: 每个文本分段与附件的 Whapi 发送结果。
- Produces: AI 气泡保存全部 `channelMessageIds`，每个 ID有对应发送记录。

- [ ] **Step 1: 写发送链路行为或紧约束测试**

验证正常 AI 回复保存文本与附件全部外部 ID，并为每个 ID调用 `insertOutgoingMessage`；发送结果必须保留顶层 `channelResult`，使 provider、account 和初始状态可落库。

- [ ] **Step 2: 运行边界测试**

Run: `node --test tests/server-ai-message-delivery-status-boundary.test.js`

Expected: 若现有路径完整则 PASS；若 FAIL，只修复失败证明的字段。

- [ ] **Step 3: 运行定向与完整验证**

Run: `node --test tests/db-ai-message-delivery-status.test.js tests/db-manual-message-delivery-status.test.js tests/db-channel-delivery-status.test.js tests/console-manual-message-delivery-status.test.js tests/console-chat-media-rendering.test.js tests/server-ai-message-delivery-status-boundary.test.js`

Run: `npm test`

Run: `git diff --check`

Expected: 所有测试 0 fail，且无空白错误。

- [ ] **Step 4: 检查范围和无实时更新约束**

Run: `git diff -- src/db.js src/server.js public/console/app.js tests/`

Run: `rg -n "setInterval|EventSource|WebSocket" public/console/app.js`

Expected: 没有新增状态轮询或实时连接；人工消息、Webhook 和发送 API语义不变。

- [ ] **Step 5: 最终提交**

```bash
git add tests/server-ai-message-delivery-status-boundary.test.js src/server.js
git commit -m "test: verify AI delivery status linkage"
```

若 `src/server.js` 无需修改，只提交测试文件。
