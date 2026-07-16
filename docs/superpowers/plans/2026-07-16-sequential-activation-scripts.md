# 顺序激活话术 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将私聊节点激活改为每条话术独立配置间隔和次数，并为每位客户顺序推进且永不重发已完成话术。

**Architecture:** `normalizeActivationConfig` 将旧字符串话术迁移为对象话术。 `flow_sessions` 保存当前节点的话术索引和已发送次数，任务表保存当前话术快照；服务端仅调度当前未完成话术，并在 Worker 成功发送后原子推进进度。

**Tech Stack:** Node.js 22、Express、SQLite (`node:sqlite`)、原生浏览器 JavaScript、Node test runner。

## Global Constraints

- 仅私聊状态机处理客户激活；群聊不创建激活进度或任务。
- 节点统一保留 `polishByAgent`；每条话术使用 `content`、`intervalMinutes`、`maxTimes`。
- 客户任意私聊互动取消当前计时；AI 回复后仅重启当前未完成话术的当前次数。
- 节点切换、人工接手、清空会话和重新绑定 Agent 作废旧节点任务；新节点从话术 1 开始。
- 旧配置的字符串话术必须可读可写，并继承旧节点级间隔和次数。

## Files

- `src/db.js`：迁移、规范化、会话进度和任务推进。
- `src/server.js`：入口、AI 回复、Worker 发送和取消边界。
- `public/console/app.js`、`public/console/styles.css`：按话术编辑器。
- `tests/db-activation.test.js`、`tests/server-activation-boundary.test.js`、`tests/server-friend-added-activation-boundary.test.js`、`tests/console-activation-boundary.test.js`：回归测试。
- `README.md`、`tests/docs-activation-boundary.test.js`：运维说明与文档测试。

## Data Contracts

```js
{
  enabled: true,
  polishByAgent: true,
  messages: [
    { content: "资料看过了吗？", intervalMinutes: 2, maxTimes: 1 },
    { content: "今晚有直播课。", intervalMinutes: 30, maxTimes: 2 }
  ]
}

// flow_sessions.activation_state_json
{ nodeId: "node_1", messageIndex: 1, sentCount: 1 }

// task snapshot
{ messageIndex: 1, messageContent: "今晚有直播课。", attemptNumber: 2 }
```

### Task 1: Normalize, persist, and reset per-message progress

**Files:**
- Modify: `src/db.js: ensureColumn, rowToFlowSession, rowToFlowActivationTask, normalizeActivationConfig, scheduleFlowActivationTask, updateFlowSessionNode, clearConversationForReset`
- Test: `tests/db-activation.test.js`

**Consumes:** Existing activation values such as `{ intervalMinutes: 30, maxTimes: 2, messages: ["第一条"] }`.

**Produces:** Canonical object messages, session progress `{ nodeId, messageIndex, sentCount }`, and an atomic advance result.

- [ ] **Step 1: Write failing database tests**

```js
assert.deepEqual(db.normalizeActivationConfig({
  intervalMinutes: 30,
  maxTimes: 2,
  messages: ["第一条"]
}).messages, [{ content: "第一条", intervalMinutes: 30, maxTimes: 2 }]);

assert.deepEqual(db.getFlowActivationProgress({ conversationKey, nodeId: "node_1" }), {
  nodeId: "node_1", messageIndex: 0, sentCount: 0
});
```

Also prove: one-send message advances to index 1; a two-send message changes from `sentCount: 0` to `sentCount: 1`; stale generation returns `null`; node change and conversation reset clear progress.

- [ ] **Step 2: Run focused test to verify failure**

Run: `node --test tests/db-activation.test.js`

Expected: FAIL because messages are strings and progress APIs do not exist.

- [ ] **Step 3: Add canonical message and schema support**

```js
ensureColumn("flow_sessions", "activation_state_json", "TEXT");
ensureColumn("flow_activation_tasks", "message_index", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("flow_activation_tasks", "message_content", "TEXT");

function normalizeActivationMessage(raw, defaults) {
  const source = typeof raw === "string" ? { content: raw } : raw || {};
  const content = String(source.content || "").trim();
  if (!content) return null;
  return {
    content,
    intervalMinutes: Math.max(1, Number.parseInt(source.intervalMinutes ?? defaults.intervalMinutes, 10) || defaults.intervalMinutes),
    maxTimes: Math.max(1, Number.parseInt(source.maxTimes ?? defaults.maxTimes, 10) || defaults.maxTimes)
  };
}
```

Make `normalizeActivationConfig` return `{ enabled, polishByAgent, messages }`, with object messages only. Extend task row mapping with `messageIndex` and `messageContent`.

- [ ] **Step 4: Add progress APIs and lifecycle resets**

```js
export function getFlowActivationProgress({ conversationKey, nodeId }) {
  // Return matching state or { nodeId, messageIndex: 0, sentCount: 0 }.
}

export function advanceFlowActivationProgress({
  conversationKey, nodeId, generation, messageIndex, attemptNumber, messages
}) {
  // Compare current node and generation, then persist the next state atomically.
}
```

Reset `activation_state_json` in `updateFlowSessionNode`, `clearConversationForReset`, and the Agent rebind flow-session reset query.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test tests/db-activation.test.js`

Expected: PASS.

Commit: `git add src/db.js tests/db-activation.test.js && git commit -m "feat: persist sequential activation progress"`

### Task 2: Schedule exactly one current script and advance after send

**Files:**
- Modify: `src/server.js: activationDueAtForAttempt, scheduleActivationAfterFlowReply, handleFriendAddedEvent, sendActivationRawMessages, sendActivationPolishedMessage, processFlowActivationTask`
- Test: `tests/server-activation-boundary.test.js`, `tests/server-friend-added-activation-boundary.test.js`

**Consumes:** Task 1 progress APIs and message-index task snapshots.

**Produces:** One current task per private session; sequential next-task scheduling.

- [ ] **Step 1: Write failing server boundary tests**

```js
assert.equal(server.includes("getFlowActivationProgress"), true);
assert.equal(server.includes("advanceFlowActivationProgress"), true);
assert.equal(server.includes("messageIndex"), true);
assert.equal(server.includes("messageContent"), true);
```

Add boundary checks for: friend-added schedules entry script index 0; AI reply schedules current unfinished script; customer reply cancels without resetting progress; node change invalidates old task generations.

- [ ] **Step 2: Run focused test to verify failure**

Run: `node --test tests/server-activation-boundary.test.js tests/server-friend-added-activation-boundary.test.js`

Expected: FAIL because the server schedules a whole node activation object and selects strings by global attempt number.

- [ ] **Step 3: Implement current-script scheduling**

```js
function scheduleCurrentActivation({ botId, binding, conversationKey, machine, session, anchorAt }) {
  const node = getFlowNode(machine, session.currentNodeId);
  const activation = normalizeActivationConfig(node?.activation || {});
  const progress = getFlowActivationProgress({ conversationKey, nodeId: node?.id });
  const activationMessage = activation.messages[progress.messageIndex];
  if (!activation.enabled || !activationMessage) return null;
  const attemptNumber = progress.sentCount + 1;
  return scheduleFlowActivationTask({
    botId, agentId: binding.agentId, conversationKey, nodeId: node.id,
    generation: session.activationGeneration, messageIndex: progress.messageIndex,
    activationMessage, attemptNumber, anchorAt,
    dueAt: activationDueAtForAttempt(anchorAt, activationMessage.intervalMinutes, attemptNumber)
  });
}
```

`handleFriendAddedEvent` calls this helper only for a newly created entry session. `scheduleActivationAfterFlowReply` invalidates the old generation, reads current progress, then calls it. Each due time uses the most recent effective robot reply as `anchorAt`.

- [ ] **Step 4: Advance only after confirmed WorkTool send**

```js
const sentTask = markFlowActivationTaskSent({ id: task.id, worktoolMessageIds });
if (!sentTask) return;
const progress = advanceFlowActivationProgress({
  conversationKey: task.conversationKey,
  nodeId: task.nodeId,
  generation: task.generation,
  messageIndex: task.messageIndex,
  attemptNumber: task.attemptNumber,
  messages: getActivationMessagesForTask(task)
});
if (progress?.next) scheduleCurrentActivation({ ...context, anchorAt: new Date().toISOString() });
```

For raw delivery use `task.messageContent`. For Agent-polished delivery, provide DClaw only this message. Preserve existing pre-send and post-send processing-state checks.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test tests/server-activation-boundary.test.js tests/server-friend-added-activation-boundary.test.js`

Expected: PASS.

Commit: `git add src/server.js tests/server-activation-boundary.test.js tests/server-friend-added-activation-boundary.test.js && git commit -m "feat: schedule activation scripts sequentially"`

### Task 3: Configure each script in the console and document behavior

**Files:**
- Modify: `public/console/app.js: defaultActivationConfig, normalizeActivationDraft, activation input handlers, flow node renderer`
- Modify: `public/console/styles.css: activation message layout`
- Modify: `README.md`
- Test: `tests/console-activation-boundary.test.js`, `tests/docs-activation-boundary.test.js`

**Consumes:** Canonical object messages from Task 1.

**Produces:** Bordered script cards with independent content, interval, and count inputs; updated operator documentation.

- [ ] **Step 1: Write failing console and documentation tests**

```js
assert.equal(app.includes("activationMessage.content"), true);
assert.equal(app.includes("data-activation-message-interval"), true);
assert.equal(app.includes("data-activation-message-max-times"), true);
assert.equal(readme.includes("每条话术独立设置间隔和次数"), true);
assert.equal(readme.includes("节点变化会作废旧节点进度"), true);
```

- [ ] **Step 2: Run focused test to verify failure**

Run: `node --test tests/console-activation-boundary.test.js tests/docs-activation-boundary.test.js`

Expected: FAIL because the editor has one node-wide interval/count pair and README lacks sequential behavior.

- [ ] **Step 3: Implement per-script editor data and controls**

```js
function defaultActivationMessage() {
  return { content: "", intervalMinutes: 30, maxTimes: 1 };
}

function normalizeActivationMessageDraft(value = {}) {
  const source = typeof value === "string" ? { content: value } : value || {};
  return {
    content: String(source.content || ""),
    intervalMinutes: Math.max(1, Number(source.intervalMinutes || 30)),
    maxTimes: Math.max(1, Number(source.maxTimes || 1))
  };
}
```

Render every script as `.activation-message-card`: textarea, `data-activation-message-interval` numeric input, `data-activation-message-max-times` numeric input, and delete icon. Keep node-level enable and Agent polish fields. `新增话术` appends `defaultActivationMessage()`.

- [ ] **Step 4: Add stable responsive CSS**

```css
.activation-message-card { display: grid; grid-template-columns: minmax(0, 1fr) 11rem 9rem auto; }
@media (max-width: 900px) { .activation-message-card { grid-template-columns: 1fr 1fr auto; } }
```

Keep labels and numeric fields inside their grid tracks.

- [ ] **Step 5: Document, verify, and commit**

Add to README: `每条话术独立设置间隔和次数；话术按顺序推进；客户回复只取消当前倒计时；AI 回复重启当前未完成话术；节点变化会作废旧节点进度。`

Run: `npm test && git diff --check`

Expected: all tests pass with no whitespace errors.

Commit: `git add public/console/app.js public/console/styles.css README.md tests/console-activation-boundary.test.js tests/docs-activation-boundary.test.js && git commit -m "feat: configure activation scripts individually"`

## Verification Scenarios

1. 新好友进入入口节点后，话术 1 在自身间隔后发送。
2. 倒计时中客户发图片，任务取消；AI 回复后仍为同一未完成话术重新计时。
3. 话术 1 完成后，话术 2 从话术 1 的发送时刻开始等待自己的间隔。
4. 话术 2 配置 2 次：第一次发出后等待 `间隔 × 2`，再发第二次；完成后进入话术 3。
5. 客户在话术 2 第一次之后回复，AI 回复后不回退话术 1，也不抹掉话术 2 已发送次数。
6. 状态机节点切换时，旧节点的排队任务不发送，新节点从话术 1 开始。
7. 旧版字符串话术保存后转为对象话术且正常运行。

