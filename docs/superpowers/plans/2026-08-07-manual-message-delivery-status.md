# 人工消息送达状态 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在控制台会话中，于用户点击现有刷新按钮后，为人工发送的 WhatsApp 消息显示 Whapi 最新送达状态。

**Architecture:** `outgoing_messages` 保持为状态唯一事实来源；读取 `conversation_messages` 时，根据人工消息保存的外部消息 ID，在同一 Bot 和会话范围内关联最新发送记录。会话 API 返回状态字段，前端使用固定白名单映射渲染状态，不新增轮询或实时连接。

**Tech Stack:** Node.js ESM、SQLite、Express、原生浏览器 JavaScript/CSS、`node:test`

## Global Constraints

- 状态语义以 Whapi 发送响应和 `statuses` Webhook 为准。
- 本次只显示 `source = manual_reply` 的人工文本消息状态。
- 页面不得新增轮询、SSE 或 WebSocket；仅随现有刷新动作更新。
- `outgoing_messages` 是状态唯一事实来源，不向 `conversation_messages` 重复写回执。
- 未知或缺失状态不显示。
- 没有 `read` 回执不得解释为对方未读。
- 保留工作区内与本功能无关的未提交修改；编辑 `src/db.js`、`src/server.js` 和测试文件前先核对现有 diff，并仅做局部补丁。

---

## File Structure

- `src/db.js`：为会话消息补充人工发送状态关联，并继续负责状态单调推进。
- `src/server.js`：沿用会话详情 API 和人工发送链路，确保返回及保存关联所需字段。
- `public/console/app.js`：把白名单状态映射为安全的气泡状态标记。
- `public/console/styles.css`：定义普通、已读和失败状态的视觉样式。
- `tests/db-manual-message-delivery-status.test.js`：验证消息关联、隔离和未知状态行为。
- `tests/console-manual-message-delivery-status.test.js`：验证前端映射、渲染和无轮询约束。
- `tests/server-manual-message-delivery-status-boundary.test.js`：验证人工发送记录与会话 API 的数据边界。

### Task 1: 数据库会话消息状态关联

**Files:**
- Modify: `src/db.js`（`rowToConversationMessage`、会话消息读取路径附近）
- Create: `tests/db-manual-message-delivery-status.test.js`

**Interfaces:**
- Consumes: `conversation_messages.raw_payload_json.source`、`raw_payload_json.messageId`、`outgoing_messages` 的 `bot_id`、`conversation_key`、`message_id`、`delivery_*` 字段。
- Produces: `listConversationMessages(...)` 返回的人工消息对象可包含 `deliveryStatus: string`、`deliveryError: string`、`deliveryUpdatedAt: string`。

- [ ] **Step 1: 写人工消息关联状态的失败测试**

创建隔离数据库，插入同一 Bot、会话、消息 ID 的 `manual_reply` 会话消息和 `outgoing_messages` 记录，然后断言：

```js
const [message] = listConversationMessages({
  botId: "bot-a",
  conversationKey: "whapi:channel-a:private:customer-a",
  limit: 10
});
assert.equal(message.deliveryStatus, "delivered");
assert.equal(message.deliveryError, "");
assert.ok(message.deliveryUpdatedAt);
```

同时插入非 `manual_reply` 消息并断言其 `deliveryStatus` 为 `undefined`。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node --test tests/db-manual-message-delivery-status.test.js`

Expected: FAIL，人工消息没有 `deliveryStatus`。

- [ ] **Step 3: 实现最小关联逻辑**

在 `src/db.js` 增加批量装饰函数，避免每条消息单独查询：

```js
function attachManualMessageDeliveryStatuses(messages, { botId, conversationKey }) {
  // 只收集 rawPayload.source === "manual_reply" 且 messageId 非空的消息；
  // 一次查询同一 bot_id、conversation_key 和 message_id 集合；
  // 每个 message_id 选择 id 最大的发送记录；
  // 只复制白名单 delivery_status 及对应错误、更新时间。
}
```

让 `listConversationMessages` 和 `listConversationMessagesAround` 在去重、裁剪完成后调用该函数。白名单为：

```js
new Set(["pending", "sent", "delivered", "read", "played", "failed"])
```

- [ ] **Step 4: 补充隔离与最新记录测试**

测试以下情况：

```js
// 相同 messageId 但不同 botId 不关联
// 相同 messageId 但不同 conversationKey 不关联
// 同一 messageId 多条 outgoing 记录时选择 id 最大者
// outgoing 状态为空或未知时不暴露 deliveryStatus
```

- [ ] **Step 5: 运行数据库相关测试**

Run: `node --test tests/db-manual-message-delivery-status.test.js tests/db-channel-delivery-status.test.js`

Expected: PASS，且状态单调推进既有测试继续通过。

- [ ] **Step 6: 提交数据库关联改动**

```bash
git add src/db.js tests/db-manual-message-delivery-status.test.js
git commit -m "feat: expose manual message delivery status"
```

### Task 2: 服务端人工消息与会话响应边界

**Files:**
- Modify: `src/server.js:6690-6765`（仅在测试揭示缺口时）
- Create: `tests/server-manual-message-delivery-status-boundary.test.js`

**Interfaces:**
- Consumes: Whapi 发送结果 `{ data, status, channelResult }` 和 `insertOutgoingMessage(...)`。
- Produces: 人工消息保存相同 `messageId`；`GET /api/flow-sessions/:conversationKey` 通过 `listConversationMessages` 返回装饰后的状态。

- [ ] **Step 1: 写服务端边界失败测试**

使用源码边界测试验证人工发送链路同时执行：

```js
assert.match(serverSource, /const messageId = result\.data \|\| ""/);
assert.match(serverSource, /source: "manual_reply"[\s\S]*?messageId/);
assert.match(serverSource, /insertOutgoingMessage\(\{[\s\S]*?conversationKey[\s\S]*?messageId/);
assert.match(serverSource, /listConversationMessages\(\{[\s\S]*?botId[\s\S]*?conversationKey/);
```

增加断言确保人工回复响应仍返回 `channelResponse`，前端可以立即获得初始状态而不把它误称为送达。

- [ ] **Step 2: 运行测试，判断现有实现是否已满足边界**

Run: `node --test tests/server-manual-message-delivery-status-boundary.test.js`

Expected: 若现有链路完整则 PASS；若缺少精确关联字段则 FAIL，并以失败项作为唯一修改范围。

- [ ] **Step 3: 仅在失败时补齐最小服务端字段**

保留现有响应形状：

```js
{
  ok: true,
  message: { direction, senderName, content, rawPayload, createdAt },
  channelResponse: result
}
```

确保 `rawPayload.messageId` 与传入 `insertOutgoingMessage.messageId` 完全相同。不要新增状态查询端点。

- [ ] **Step 4: 运行服务端边界和 Webhook 测试**

Run: `node --test tests/server-manual-message-delivery-status-boundary.test.js tests/server-bot-isolation-boundary.test.js tests/channel-webhook-worker.test.js tests/whapi-mapper.test.js`

Expected: PASS。

- [ ] **Step 5: 提交服务端边界改动**

```bash
git add src/server.js tests/server-manual-message-delivery-status-boundary.test.js
git commit -m "test: secure manual delivery status boundary"
```

若 `src/server.js` 无需修改，只提交新增测试。

### Task 3: 控制台消息气泡状态渲染

**Files:**
- Modify: `public/console/app.js:5050-5080`
- Modify: `public/console/styles.css:4999-5105`
- Create: `tests/console-manual-message-delivery-status.test.js`

**Interfaces:**
- Consumes: 会话消息的 `deliveryStatus`、`deliveryError`、`deliveryUpdatedAt`。
- Produces: `renderManualMessageDeliveryStatus(message): string`，返回安全 HTML 或空字符串。

- [ ] **Step 1: 写前端状态映射失败测试**

源码测试要求定义固定映射和渲染函数，并覆盖：

```js
const expectedLabels = {
  pending: "发送中",
  sent: "已发送",
  delivered: "已送达",
  read: "已读",
  played: "已播放",
  failed: "发送失败"
};
```

断言气泡只在 `outbound && rawPayload.source === "manual_reply"` 时调用状态渲染；未知状态返回空内容。断言代码中未增加 `setInterval` 或新的状态轮询请求。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node --test tests/console-manual-message-delivery-status.test.js`

Expected: FAIL，状态映射或渲染函数不存在。

- [ ] **Step 3: 实现状态白名单和标记**

在 `public/console/app.js` 增加：

```js
const manualMessageDeliveryStates = Object.freeze({
  pending: { label: "发送中", mark: "", tone: "pending" },
  sent: { label: "已发送", mark: "✓", tone: "sent" },
  delivered: { label: "已送达", mark: "✓✓", tone: "delivered" },
  read: { label: "已读", mark: "✓✓", tone: "read" },
  played: { label: "已播放", mark: "", tone: "read" },
  failed: { label: "发送失败", mark: "!", tone: "failed" }
});

function renderManualMessageDeliveryStatus(message) {
  if (message?.direction !== "outbound" || message?.rawPayload?.source !== "manual_reply") return "";
  const state = manualMessageDeliveryStates[String(message.deliveryStatus || "").toLowerCase()];
  if (!state) return "";
  return `<span class="manual-message-delivery-status is-${state.tone}"><span aria-hidden="true">${state.mark}</span>${state.label}</span>`;
}
```

将返回内容插入人工消息气泡的 meta 区域或内容下方。固定映射值不接受服务端 HTML。

- [ ] **Step 4: 添加紧凑状态样式**

在 `public/console/styles.css` 增加：

```css
.manual-message-delivery-status { /* 小字号、右对齐、与时间协调 */ }
.manual-message-delivery-status.is-read { /* WhatsApp 风格蓝色 */ }
.manual-message-delivery-status.is-failed { /* 明确但不过度抢眼的红色 */ }
```

保持气泡宽度和移动端布局稳定。

- [ ] **Step 5: 运行前端测试**

Run: `node --test tests/console-manual-message-delivery-status.test.js tests/console-chat-media-rendering.test.js`

Expected: PASS。

- [ ] **Step 6: 提交前端渲染改动**

```bash
git add public/console/app.js public/console/styles.css tests/console-manual-message-delivery-status.test.js
git commit -m "feat: render WhatsApp delivery status"
```

### Task 4: 全量验证与人工检查

**Files:**
- Verify only; do not modify unrelated files.

**Interfaces:**
- Consumes: Tasks 1-3 的完整行为。
- Produces: 可复现的测试与界面验收证据。

- [ ] **Step 1: 运行定向测试**

Run:

```bash
node --test \
  tests/db-manual-message-delivery-status.test.js \
  tests/db-channel-delivery-status.test.js \
  tests/server-manual-message-delivery-status-boundary.test.js \
  tests/console-manual-message-delivery-status.test.js
```

Expected: 所有测试 PASS，0 fail。

- [ ] **Step 2: 运行完整测试套件**

Run: `npm test`

Expected: exit 0，0 fail。

- [ ] **Step 3: 检查差异和无轮询约束**

Run:

```bash
git diff --check
git diff -- src/db.js src/server.js public/console/app.js public/console/styles.css tests/
rg -n "setInterval|delivery-status|deliveryStatus" public/console/app.js
```

Expected: 无空白错误；状态代码没有新增计时器或后台请求；无关工作区改动未被覆盖。

- [ ] **Step 4: 浏览器人工验收**

使用已配置 Whapi Webhook 的账号：

1. 切换人工接手并发送文本。
2. 确认初始状态显示“发送中”或“已发送”，不显示“已送达”。
3. 等 Whapi `delivered` 回调进入服务端后点击现有“刷新”。
4. 确认同一气泡变为“✓✓ 已送达”。
5. 若 Whapi 实际提供 `read` 回调，再点击刷新并确认蓝色“✓✓ 已读”。
6. 确认未出现 `read` 时页面没有“未读”判断。

- [ ] **Step 5: 最终提交（仅当仍有本功能未提交文件）**

```bash
git add <仅本功能文件>
git commit -m "feat: show manual message delivery receipts"
```
