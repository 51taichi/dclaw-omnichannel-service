# 人工消息 Pending 显示为已发送 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将人工消息的 Whapi `pending` 状态显示为“✓ 已发送”。

**Architecture:** 只修改控制台固定状态映射，不改数据库中的 Whapi 原始状态或回执处理。现有消息气泡渲染继续读取 `deliveryStatus`，`pending` 与 `sent` 使用相同文案、勾号和普通已发送色调。

**Tech Stack:** 原生浏览器 JavaScript、Node.js `node:test`

## Global Constraints

- `pending` 显示为 `✓ 已发送`。
- `sent` 继续显示为 `✓ 已发送`。
- `delivered`、`read`、`played` 和 `failed` 的现有语义保持不变。
- 数据库继续保存 Whapi 原始 `pending` 状态。
- 不修改发送接口、Webhook、刷新机制或状态推进逻辑。
- 不新增轮询、SSE 或 WebSocket。

---

### Task 1: 修改人工消息状态映射

**Files:**
- Modify: `tests/console-manual-message-delivery-status.test.js`
- Modify: `public/console/app.js`

**Interfaces:**
- Consumes: `renderManualMessageDeliveryStatus(message)` 接收 `message.deliveryStatus = "pending"`。
- Produces: HTML 包含勾号 `✓`、文案 `已发送` 和 `is-sent` 状态类。

- [ ] **Step 1: 写失败测试**

修改映射期望值，使 `pending` 与 `sent` 均要求：

```js
pending: { label: "已发送", mark: "✓", tone: "sent" },
sent: { label: "已发送", mark: "✓", tone: "sent" }
```

保留其余四个状态和未知状态隐藏断言。

- [ ] **Step 2: 验证 RED**

Run: `node --test tests/console-manual-message-delivery-status.test.js`

Expected: FAIL，当前 `pending` 实际输出“发送中”、空标记或 `is-pending`。

- [ ] **Step 3: 最小实现**

在 `public/console/app.js` 的 `manualMessageDeliveryStates` 中仅替换：

```js
pending: { label: "已发送", mark: "✓", tone: "sent" }
```

- [ ] **Step 4: 验证 GREEN 和回归**

Run:

```bash
node --test \
  tests/console-manual-message-delivery-status.test.js \
  tests/console-chat-media-rendering.test.js
npm test
git diff --check
```

Expected: 定向测试和完整测试均为 0 fail，且无空白错误。

- [ ] **Step 5: 提交**

```bash
git add public/console/app.js tests/console-manual-message-delivery-status.test.js
git commit -m "fix: show accepted manual messages as sent"
```
