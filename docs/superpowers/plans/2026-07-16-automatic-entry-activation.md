# 入口节点自动激活 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除触发时机配置，让入口节点在新增好友和 AI 回复后均可激活，其他节点只在 AI 回复后激活。

**Architecture:** 服务端不再读取 `activation.trigger`。新增好友回调只依据入口节点的激活开关和话术创建任务；私聊 AI 成功回复只依据当前节点的激活开关和话术创建任务。控制台不显示或保存 `trigger`，历史 JSON 中该字段在规范化时被丢弃。

**Tech Stack:** Node.js 22、Express 5、`node:sqlite`、原生 ES Modules、Node test runner、原生控制台 JavaScript/CSS。

## Global Constraints

- 入口节点的新增好友激活仅识别 `textType=22`、`type=105` 回调。
- 所有启用激活且有话术的私聊节点在 AI 成功回复后创建任务。
- 新增好友不调用 DClaw，也不补发企业微信欢迎语。
- 客户回复、人工接手、清空会话、节点切换和新的 AI 回复继续取消旧任务。
- 不修改 DClaw Agent 文件或协议。
- 每项行为先写失败测试，再实现最小代码。

---

### Task 1: 清理触发时机配置和控制台字段

**Files:**
- Modify: `src/db.js:normalizeActivationConfig`, `src/db.js:normalizeFlowConfig`
- Modify: `public/console/app.js:defaultActivationConfig`, `normalizeActivationDraft`, `updateDraftNodeActivationFromInput`, `renderFlowNodeEditor`
- Modify: `public/console/styles.css:.activation-toolbar`
- Modify: `tests/db-activation.test.js`
- Modify: `tests/console-activation-boundary.test.js`

**Interfaces:**
- `normalizeActivationConfig(raw)` 只返回 `enabled`、`intervalMinutes`、`maxTimes`、`polishByAgent`、`messages`。
- 控制台节点激活表单不包含 `data-flow-node-activation-field="trigger"`。

- [ ] **Step 1: 写失败测试**

在 `tests/db-activation.test.js` 添加：

```js
test("activation normalization ignores legacy trigger values", () => {
  const normalized = db.normalizeActivationConfig({
    enabled: true,
    trigger: "friend_added",
    messages: ["提醒"]
  });
  assert.equal("trigger" in normalized, false);
});
```

删除现有“非入口节点拒绝 `friend_added`”测试。将 `tests/console-activation-boundary.test.js` 的最后一个测试替换为：

```js
test("activation editor hides trigger choice and does not preserve legacy trigger", () => {
  assert.equal(app.includes('data-flow-node-activation-field="trigger"'), false);
  assert.equal(app.includes('value="friend_added"'), false);
  assert.equal(app.includes("触发时机"), false);
  assert.equal(app.includes('trigger: source.trigger === "friend_added"'), false);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `npm test -- tests/db-activation.test.js tests/console-activation-boundary.test.js`

Expected: FAIL，因为当前数据模型和控制台仍保留 `trigger`。

- [ ] **Step 3: 最小实现**

在 `src/db.js` 的 `normalizeActivationConfig` 删除 `rawTrigger`、`trigger` 的计算和返回字段；在 `normalizeFlowConfig` 删除以下校验：

```js
if (normalizedNodes.some((node) =>
  node.id !== entryNodeId && node.activation.trigger === "friend_added"
)) {
  throw new Error("friend_added activation must be on the entry node");
}
```

在 `public/console/app.js` 使用：

```js
function defaultActivationConfig() {
  return {
    enabled: false,
    intervalMinutes: 30,
    maxTimes: 1,
    polishByAgent: true,
    messages: []
  };
}
```

从 `normalizeActivationDraft`、`updateDraftNodeActivationFromInput` 和 `renderFlowNodeEditor` 删除 `trigger`、`activationTrigger`、`canTriggerOnFriendAdded` 与触发时机 `<select>`。帮助文字替换为：

```text
启用：客户未回复时触发提醒；入口节点在新增好友后和 AI 回复后都会计时，其他节点只在 AI 回复后计时；美化：由 Agent 结合上下文润色；间隔：第1次按间隔发送，第2次按间隔*2，第3次按间隔*4；次数：达到次数后停止；话术：第 N 次激活发送第 N 条话术，不够时复用最后一条。
```

在 `public/console/styles.css` 将 `.activation-toolbar` 改为：

```css
grid-template-columns: minmax(160px, 1fr) minmax(170px, 1fr) minmax(190px, 1.05fr) minmax(130px, 0.8fr) 34px 40px;
```

- [ ] **Step 4: 运行目标测试并提交**

Run: `npm test -- tests/db-activation.test.js tests/console-activation-boundary.test.js`

Expected: PASS。

```bash
git add src/db.js public/console/app.js public/console/styles.css tests/db-activation.test.js tests/console-activation-boundary.test.js
git commit -m "feat: simplify activation trigger settings"
```

### Task 2: 自动调度入口新增好友和 AI 回复激活

**Files:**
- Modify: `src/server.js:scheduleActivationAfterFlowReply`, `handleFriendAddedEvent`
- Modify: `tests/server-friend-added-activation-boundary.test.js`
- Modify: `tests/server-activation-boundary.test.js`

**Interfaces:**
- `scheduleActivationAfterFlowReply(...)` 不依赖 `activation.trigger`。
- `handleFriendAddedEvent(...)` 仅读取 `machine.entryNodeId` 对应节点的激活配置。

- [ ] **Step 1: 写失败测试**

将 `tests/server-friend-added-activation-boundary.test.js` 的第三个测试替换为：

```js
test("normal reply activation does not depend on a trigger field", () => {
  const start = source.indexOf("function scheduleActivationAfterFlowReply");
  const end = source.indexOf("function isValidFlowNode", start);
  const scheduler = source.slice(start, end);
  assert.equal(scheduler.includes("activation.trigger"), false);
  assert.equal(scheduler.includes("!activation.enabled"), true);
  assert.equal(scheduler.includes("!activation.messages.length"), true);
});
```

追加：

```js
test("friend-added activation reads only the flow entry node", () => {
  const start = source.indexOf("async function handleFriendAddedEvent");
  const end = source.indexOf("\nfunction commandCallbackLogFields", start);
  const handler = source.slice(start, end);
  assert.equal(handler.includes("getFlowNode(machine, machine.entryNodeId)"), true);
  assert.equal(handler.includes("activation.trigger"), false);
});
```

在 `tests/server-activation-boundary.test.js` 添加：

```js
test("entry activation schedules after both new friends and AI replies", () => {
  assert.equal(source.includes("handleFriendAddedEvent"), true);
  assert.equal(source.includes("scheduleActivationAfterFlowReply({"), true);
  assert.equal(source.includes('reason: "customer_replied"'), true);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `npm test -- tests/server-friend-added-activation-boundary.test.js tests/server-activation-boundary.test.js`

Expected: FAIL，因为两个调度路径仍检查 `activation.trigger`。

- [ ] **Step 3: 最小实现**

在 `scheduleActivationAfterFlowReply` 将判断改为：

```js
if (!activation.enabled || !activation.messages.length) return null;
```

保留 `cancelFlowActivationTasks({ conversationKey, reason: "new_flow_reply" })` 与 `incrementFlowActivationGeneration({ conversationKey, reason: "flow_reply_sent" })`，以便 AI 回复取代此前新增好友创建的任务组。

在 `handleFriendAddedEvent` 以入口节点替代当前节点：

```js
const entryNode = getFlowNode(machine, machine.entryNodeId);
const activation = normalizeActivationConfig(entryNode?.activation || {});
if (!activation.enabled || !activation.messages.length) {
  logInfo("friend_added.skipped", {
    ...logContext,
    friendName,
    conversationKey,
    reason: "entry_activation_not_configured"
  });
  return "skipped";
}
```

在 `scheduleFlowActivationTask` 中固定 `nodeId: machine.entryNodeId`。其余新增好友路径不变：只创建会话和任务，不调用 DClaw 或 WorkTool 发送接口。

- [ ] **Step 4: 运行目标测试并提交**

Run: `npm test -- tests/server-friend-added-activation-boundary.test.js tests/server-activation-boundary.test.js`

Expected: PASS。

```bash
git add src/server.js tests/server-friend-added-activation-boundary.test.js tests/server-activation-boundary.test.js
git commit -m "feat: automatically trigger entry activation"
```

### Task 3: 更新文档并完成回归验证

**Files:**
- Modify: `README.md:节点激活说明`
- Modify: `tests/docs-activation-boundary.test.js`

**Interfaces:** README 明确无需选择触发时机，入口节点新增好友和 AI 回复都会计时。

- [ ] **Step 1: 写失败测试**

将新增好友文档测试替换为：

```js
test("automatic entry activation is documented", () => {
  assert.equal(readme.includes("无需选择触发时机"), true);
  assert.equal(readme.includes("新增好友后和 AI 回复后"), true);
  assert.equal(readme.includes("textType=22"), true);
  assert.equal(readme.includes("type=105"), true);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `npm test -- tests/docs-activation-boundary.test.js`

Expected: FAIL，因为 README 仍描述入口节点可选择“新增好友后”。

- [ ] **Step 3: 更新说明**

在 `README.md` 的节点激活段落加入：

```text
无需选择触发时机：所有启用激活的节点都会在 AI 成功回复后计时；入口节点还会在 WorkTool 新增好友回调后计时。客户在等待期间回复会取消旧任务，AI 回复后按当前节点重新开始计时，因此同一会话只会保留一组有效激活任务。
```

保留 `textType=22`、`type=105`、`friendName`、不调用 Agent 与不重复欢迎语的说明。

- [ ] **Step 4: 全量验证、提交和推送**

Run: `npm test -- tests/docs-activation-boundary.test.js && git diff --check && npm test`

Expected: 两次测试均 PASS，`git diff --check` 无输出。

```bash
git add README.md tests/docs-activation-boundary.test.js
git commit -m "docs: describe automatic entry activation"
git push origin main
```
