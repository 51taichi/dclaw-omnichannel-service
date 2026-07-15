# 新增好友节点激活 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 WorkTool 新增好友事件到达时，让入口节点可按配置启动私聊客户激活，而不重复发送欢迎语或调用 DClaw。

**Architecture:** 将 `textType=22 && type=105` 识别为新增好友事件，并从 `friendName` 构造既有私聊会话键。状态机节点激活配置增加 `trigger`，默认保持 `after_ai_reply`；入口节点可选 `friend_added`，由新增好友事件创建首个激活任务。现有普通消息和激活 Worker 不改变。

**Tech Stack:** Node.js 22、Express 5、`node:sqlite`、原生 ES Modules、Node test runner、原生控制台 JavaScript/CSS。

## Global Constraints

- `activation.trigger` 仅允许 `after_ai_reply` 或 `friend_added`；缺失时必须兼容为 `after_ai_reply`。
- `friend_added` 只允许状态机入口节点使用，群聊和普通文本回调不得触发此路径。
- 新增好友事件只创建会话与激活任务，绝不调用 DClaw、绝不向 WorkTool 发送欢迎语。
- 使用 `friendName` 复用现有 `botId:private:<name>` 会话键规则；无 `friendName` 时安全跳过。
- 所有修改遵循 TDD：先写失败测试，再写最小实现，再跑完整 `npm test`。
- 不修改 DClaw Agent 文件或 Agent 回复协议。

---

### Task 1: 定义新增好友事件与激活触发配置

**Files:**
- Modify: `src/message-rules.js`
- Modify: `src/db.js:normalizeFlowConfig`, `src/db.js:normalizeActivationConfig`
- Modify: `tests/message-rules.test.js`
- Modify: `tests/db-activation.test.js`

**Interfaces:**
- Produces `isFriendAddedEvent(message): boolean`，仅在 `textType === 22 && type === 105` 时为真。
- Produces `friendAddedName(message): string`，返回去空格后的 `friendName`。
- Extends `normalizeActivationConfig(raw)` return value with `trigger: "after_ai_reply" | "friend_added"`。
- `upsertFlowMachine` rejects a non-entry node whose normalized activation trigger is `friend_added`.

- [ ] **Step 1: 写失败的事件识别与配置规范化测试**

在 `tests/message-rules.test.js` 增加：

```js
import { friendAddedName, isFriendAddedEvent, shouldProcessInboundForAgent } from "../src/message-rules.js";

test("recognizes WorkTool friend-added callbacks without treating them as text", () => {
  const event = { textType: 22, type: 105, friendName: "  新客户  " };
  assert.equal(isFriendAddedEvent(event), true);
  assert.equal(friendAddedName(event), "新客户");
  assert.equal(shouldProcessInboundForAgent(event), false);
});

test("does not confuse other empty WorkTool callbacks with friend additions", () => {
  assert.equal(isFriendAddedEvent({ textType: 22, type: 999, friendName: "客户" }), false);
  assert.equal(friendAddedName({ textType: 22, type: 105, friendName: "   " }), "");
});
```

在 `tests/db-activation.test.js` 修改首个测试中两个既有 `assert.deepEqual` 的
期望对象：默认对象与显式对象都增加 `trigger: "after_ai_reply"`。随后增加显式
新增好友触发断言：

```js
assert.equal(db.normalizeActivationConfig({}).trigger, "after_ai_reply");
assert.equal(
  db.normalizeActivationConfig({ trigger: "friend_added" }).trigger,
  "friend_added"
);
```

增加一个状态机校验测试：

```js
test("friend-added activation is restricted to the entry node", () => {
  const botId = "bot_friend_added_validation";
  const agentId = "agent_friend_added_validation";
  ensureBotAgent(botId, agentId);
  assert.throws(() => db.upsertFlowMachine({
    agentId,
    enabled: true,
    config: {
      name: "校验状态机",
      entryNodeId: "node_1",
      nodes: [
        { id: "node_1", name: "入口", activation: {} },
        { id: "node_2", name: "后续", activation: { trigger: "friend_added" } }
      ]
    }
  }), /friend_added activation must be on the entry node/);
});
```

- [ ] **Step 2: 运行测试并确认它们失败**

Run:

```bash
npm test -- tests/message-rules.test.js tests/db-activation.test.js
```

Expected: FAIL，因为 `isFriendAddedEvent`、`friendAddedName` 和 `trigger` 尚不存在，且非入口节点未被拒绝。

- [ ] **Step 3: 实现最小的事件规则与配置约束**

在 `src/message-rules.js` 添加：

```js
export function isFriendAddedEvent(message) {
  return Number(message?.textType) === 22 && Number(message?.type) === 105;
}

export function friendAddedName(message) {
  return String(message?.friendName || "").trim();
}
```

在 `src/db.js` 的 `normalizeActivationConfig` 中加入：

```js
const rawTrigger = String(source.trigger || "after_ai_reply").trim();
const trigger = rawTrigger === "friend_added" ? "friend_added" : "after_ai_reply";
```

并在返回对象中加入 `trigger`。在 `normalizeFlowConfig` 算出并校验
`entryNodeId` 后加入：

```js
if (normalizedNodes.some((node) =>
  node.id !== entryNodeId && node.activation.trigger === "friend_added"
)) {
  throw new Error("friend_added activation must be on the entry node");
}
```

- [ ] **Step 4: 运行目标测试并确认通过**

Run:

```bash
npm test -- tests/message-rules.test.js tests/db-activation.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交配置模型变更**

```bash
git add src/message-rules.js src/db.js tests/message-rules.test.js tests/db-activation.test.js
git commit -m "feat: add new friend activation trigger"
```

### Task 2: 在新增好友回调中创建入口节点激活任务

**Files:**
- Modify: `src/server.js:imports`, `src/server.js:processIncomingMessage`, `src/server.js:scheduleActivationAfterFlowReply`
- Create: `tests/server-friend-added-activation-boundary.test.js`

**Interfaces:**
- Consumes `isFriendAddedEvent`、`friendAddedName`、`getFlowMachineForBot`、`getOrCreateFlowSession`、`scheduleFlowActivationTask`。
- Produces `handleFriendAddedEvent({ botId, binding, message, logContext }): "scheduled" | "skipped"`。
- Keeps `scheduleActivationAfterFlowReply` limited to `activation.trigger === "after_ai_reply"`.

- [ ] **Step 1: 写失败的回调边界测试**

创建 `tests/server-friend-added-activation-boundary.test.js`：

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("friend-added callback is handled before empty inbound messages are skipped", () => {
  assert.equal(source.includes("handleFriendAddedEvent"), true);
  assert.equal(source.includes("isFriendAddedEvent(message)"), true);
  assert.equal(
    source.indexOf("isFriendAddedEvent(message)") < source.indexOf("shouldProcessInboundForAgent(message)"),
    true
  );
});

test("friend-added activation never invokes DClaw or sends a welcome message", () => {
  const start = source.indexOf("async function handleFriendAddedEvent");
  const end = source.indexOf("async function processIncomingMessage", start);
  const handler = source.slice(start, end);
  assert.equal(handler.includes("scheduleFlowActivationTask"), true);
  assert.equal(handler.includes("invokeDclaw"), false);
  assert.equal(handler.includes("sendTextMessage"), false);
});

test("normal reply activation only accepts after_ai_reply triggers", () => {
  const start = source.indexOf("function scheduleActivationAfterFlowReply");
  const end = source.indexOf("function isValidFlowNode", start);
  assert.match(source.slice(start, end), /trigger === "after_ai_reply"/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
npm test -- tests/server-friend-added-activation-boundary.test.js
```

Expected: FAIL，因为处理函数和触发模式限制尚不存在。

- [ ] **Step 3: 实现新增好友处理函数和调度分流**

在 `src/server.js` 导入：

```js
import { friendAddedName, isFriendAddedEvent, shouldProcessInboundForAgent } from "./message-rules.js";
```

在 `processIncomingMessage` 中，`insertIncomingMessage(...)` 之后、
`shouldProcessInboundForAgent(message)` 之前分流：

```js
if (isFriendAddedEvent(message)) {
  await handleFriendAddedEvent({ botId, binding, message, logContext });
  finishMessageProcessing({ messageKey, status: "processed" });
  return;
}
```

实现 `handleFriendAddedEvent`，具体要求：

```js
async function handleFriendAddedEvent({ botId, binding, message, logContext }) {
  const friendName = friendAddedName(message);
  logInfo("friend_added.received", { ...logContext, friendName, eventType: message.type });
  if (!friendName) {
    logInfo("friend_added.skipped", { ...logContext, reason: "missing_friend_name" });
    return "skipped";
  }
  if (!binding?.enabled) {
    logInfo("friend_added.skipped", { ...logContext, friendName, reason: "no_enabled_binding" });
    return "skipped";
  }

  const contactMessage = { ...message, roomType: 2, receivedName: friendName, groupName: friendName };
  const conversationKey = getConversationKey(botId, contactMessage);
  upsertConversation({ botId, agentId: binding.agentId, conversationKey, message: contactMessage });
  const machine = getFlowMachineForBot(botId);
  if (!machine?.enabled) {
    logInfo("friend_added.skipped", { ...logContext, friendName, conversationKey, reason: "no_enabled_flow_machine" });
    return "skipped";
  }
  const sessionBeforeScheduling = getOrCreateFlowSession({ botId, conversationKey, machine });
  const node = getFlowNode(machine, sessionBeforeScheduling.currentNodeId) ||
    getFlowNode(machine, machine.entryNodeId);
  const activation = normalizeActivationConfig(node?.activation || {});
  if (!activation.enabled || activation.trigger !== "friend_added" || !activation.messages.length) {
    logInfo("friend_added.skipped", { ...logContext, friendName, conversationKey, reason: "activation_not_configured" });
    return "skipped";
  }

  cancelFlowActivationTasks({ conversationKey, reason: "friend_added_restart" });
  const session = incrementFlowActivationGeneration({ conversationKey, reason: "friend_added" });
  const anchorAt = new Date().toISOString();
  const task = scheduleFlowActivationTask({
    botId,
    agentId: binding.agentId,
    conversationKey,
    nodeId: session.currentNodeId,
    generation: session.activationGeneration,
    activation,
    anchorAt,
    dueAt: activationDueAtForAttempt(anchorAt, activation.intervalMinutes, 1),
    attemptNumber: 1
  });
  logInfo("friend_added.activation.scheduled", {
    ...logContext,
    friendName,
    conversationKey,
    activationTaskId: task.id,
    nodeId: task.nodeId,
    dueAt: task.dueAt
  });
  return "scheduled";
}
```

Use the actual flow machine enabled flag from `getFlowMachineForBot(botId)` when checking
the machine; `buildFlowContext` only returns an object for an enabled machine. Do not
insert a conversation history message for this event.

In `scheduleActivationAfterFlowReply`, require `activation.trigger === "after_ai_reply"`
before calling `scheduleFlowActivationTask`. This keeps a `friend_added` node from
scheduling again when the customer later sends a normal message and AI responds.

- [ ] **Step 4: 运行目标测试并确认通过**

Run:

```bash
npm test -- tests/server-friend-added-activation-boundary.test.js tests/server-activation-boundary.test.js tests/message-rules.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交回调调度变更**

```bash
git add src/server.js tests/server-friend-added-activation-boundary.test.js
git commit -m "feat: schedule activation for new friends"
```

### Task 3: 在控制台公开入口节点的新增好友触发方式

**Files:**
- Modify: `public/console/app.js:defaultActivationConfig`, `public/console/app.js:normalizeActivationDraft`, `public/console/app.js:updateDraftNodeActivationFromInput`, `public/console/app.js:renderFlowNodeEditor`
- Modify: `public/console/styles.css`
- Modify: `tests/console-activation-boundary.test.js`

**Interfaces:**
- Consumes `activation.trigger` from API state-machine JSON.
- Produces `<select data-flow-node-activation-field="trigger">` with `after_ai_reply` and entry-only `friend_added` choices.
- Keeps `buildFlowConfigFromEditor()` serializing the selected trigger inside each node activation object.

- [ ] **Step 1: 写失败的控制台边界测试**

在 `tests/console-activation-boundary.test.js` 加入：

```js
test("activation editor supports an entry-node new-friend trigger", () => {
  assert.equal(app.includes("activationTrigger"), true);
  assert.equal(app.includes('data-flow-node-activation-field="trigger"'), true);
  assert.equal(app.includes('value="friend_added"'), true);
  assert.equal(app.includes("仅入口节点可用"), true);
  assert.equal(app.includes("trigger: source.trigger === \"friend_added\""), true);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
npm test -- tests/console-activation-boundary.test.js
```

Expected: FAIL，因为控制台还没有触发时机字段。

- [ ] **Step 3: 实现触发时机控件与草稿同步**

在 `defaultActivationConfig` 和 `normalizeActivationDraft` 中加入：

```js
trigger: source.trigger === "friend_added" ? "friend_added" : "after_ai_reply"
```

在 `updateDraftNodeActivationFromInput` 中处理：

```js
} else if (field === "trigger") {
  activation.trigger = input.value === "friend_added" ? "friend_added" : "after_ai_reply";
}
```

在 `renderFlowNodeEditor` 中计算：

```js
const activationTrigger = activation.trigger;
const canTriggerOnFriendAdded = node.id === validEntry;
```

在激活工具栏中、启用开关之后增加一个标准 `select`：

```html
<label>
  <span class="field-label">触发时机</span>
  <select data-flow-node-activation-field="trigger">
    <option value="after_ai_reply" ${activationTrigger === "after_ai_reply" ? "selected" : ""}>AI 回复后</option>
    <option value="friend_added" ${activationTrigger === "friend_added" && canTriggerOnFriendAdded ? "selected" : ""} ${canTriggerOnFriendAdded ? "" : "disabled"}>
      新增好友后${canTriggerOnFriendAdded ? "" : "（仅入口节点可用）"}
    </option>
  </select>
</label>
```

Ensure a stale imported non-entry `friend_added` value is visually shown as disabled but
is rejected on save by the server validation from Task 1. Extend the existing responsive
toolbar CSS only as needed so this select has the same fixed height and does not push the
add-message icon off the row.

- [ ] **Step 4: 运行控制台测试并确认通过**

Run:

```bash
npm test -- tests/console-activation-boundary.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交控制台配置变更**

```bash
git add public/console/app.js public/console/styles.css tests/console-activation-boundary.test.js
git commit -m "feat: configure new friend activation"
```

### Task 4: 更新运行说明并执行完整回归

**Files:**
- Modify: `README.md`
- Modify: `tests/docs-activation-boundary.test.js`

**Interfaces:**
- Documents that `type=105` creates an activation only when the entry node uses `friend_added`.
- Documents cancellation conditions and the fact that no Agent update is required.

- [ ] **Step 1: 写失败的文档边界测试**

在 `tests/docs-activation-boundary.test.js` 加入：

```js
test("new friend activation trigger is documented", () => {
  assert.equal(readme.includes("新增好友后"), true);
  assert.equal(readme.includes("textType=22"), true);
  assert.equal(readme.includes("type=105"), true);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
npm test -- tests/docs-activation-boundary.test.js
```

Expected: FAIL，因为 README 尚未描述新增好友触发。

- [ ] **Step 3: 更新 README 的状态机激活说明**

在既有“节点激活”说明中补充：

```markdown
- 触发时机可选“AI 回复后”或“新增好友后”；后者仅入口节点可用。
- WorkTool `textType=22`、`type=105` 的新增好友回调会以 `friendName` 建立私聊会话并启动激活。
- 新增好友触发不会调用 Agent，也不会重复发送企业微信欢迎语。
```

同时说明客户回复、人工接手、清空会话、节点变化会取消待执行提醒。

- [ ] **Step 4: 运行完整测试**

Run:

```bash
npm test
```

Expected: PASS，且不出现未处理的测试失败。

- [ ] **Step 5: 提交文档与回归测试**

```bash
git add README.md tests/docs-activation-boundary.test.js
git commit -m "docs: explain new friend activation"
```

- [ ] **Step 6: 生产环境手工验收**

1. 部署最新服务端；不需要上传或更新任何 DClaw Agent。
2. 在入口节点开启客户激活，选择“新增好友后”，设为 1 分钟并保存状态机。
3. 使用一个未添加过的新微信号添加该 Bot，等待企业微信欢迎语出现，但不要向 Bot 发送文字。
4. 在服务器执行：

```bash
docker logs worktool-bot-service --since 3m 2>&1 \\
  | grep -E 'friend_added\.(received|activation\.scheduled|skipped)|activation\.(worker\.claimed|sent|failed)'
```

5. 预期依次出现 `friend_added.received`、`friend_added.activation.scheduled`，到期后出现
   `activation.sent`；客户只收到一条配置的激活话术，不会收到服务端重复欢迎语。
6. 重复新好友测试后，在激活到期前发送任意消息；预期待执行任务的取消原因是
   `customer_replied`，且不再发送激活话术。
