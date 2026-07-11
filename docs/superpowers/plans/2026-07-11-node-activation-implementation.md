# Node Activation Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add node-level activation follow-ups so private flow sessions can automatically re-engage silent customers after configured intervals.

**Architecture:** Store activation settings on flow node JSON, schedule durable SQLite activation tasks after successful node replies, and process due tasks with a non-overlapping background worker. The worker either asks DClaw to polish activation copy or sends configured messages exactly, then records WorkTool sends and conversation history.

**Tech Stack:** Node.js ESM, Express 5, `node:sqlite`, browser JavaScript console, WorkTool API helpers, DClaw OpenAPI helpers, `node:test`.

## Global Constraints

- First version applies only to private flow sessions.
- Group conversations must not schedule activation tasks.
- Human handoff conversations must not receive activation messages.
- Activation timing starts only after a successful server-side WorkTool reply for the current node.
- Activation tasks must be SQLite-backed, not in-memory timers.
- Worker must be non-overlapping with a process-level busy flag.
- Default worker config: `ACTIVATION_WORKER_ENABLED=true`, `ACTIVATION_WORKER_INTERVAL_MS=10000`, `ACTIVATION_WORKER_BATCH_SIZE=20`, `ACTIVATION_WORKER_STALE_PROCESSING_MS=300000`, `ACTIVATION_SEND_DELAY_MS=500`, `ACTIVATION_MAX_CONCURRENT_AGENT_CALLS=2`.
- `polishByAgent` defaults to `true`.
- Multi-message raw activation must be stored as an array and sent as separate messages; do not split messages by spaces.
- Do not require a DClaw agent source update.

---

## File Structure

- Modify `src/db.js`: schema migration, row mapping, activation task create/claim/cancel/complete helpers, flow session `activation_generation`.
- Modify `src/dclaw.js`: request builder for `flow_activation_due` when `polishByAgent=true`.
- Modify `src/server.js`: schedule/cancel activation tasks in message processing, add activation worker, send activation through WorkTool, sync records.
- Modify `public/console/app.js`: flow node activation editor serialization/deserialization.
- Modify `public/console/styles.css`: activation editor styling inside node cards.
- Modify `README.md` and `.env.example`: document worker config.
- Add tests:
  - `tests/db-activation.test.js`
  - `tests/dclaw-activation.test.js`
  - `tests/server-activation-boundary.test.js`
  - extend `tests/console-flow-boundary.test.js` or create `tests/console-activation-boundary.test.js`

---

### Task 1: Persist Activation Tasks and Generation

**Files:**
- Modify: `src/db.js`
- Test: `tests/db-activation.test.js`

**Interfaces:**
- Produces: `normalizeActivationConfig(raw)` returning `{ enabled, intervalMinutes, maxTimes, polishByAgent, messages }`.
- Produces: `scheduleFlowActivationTask({ botId, agentId, conversationKey, nodeId, generation, activation, dueAt })`.
- Produces: `claimDueFlowActivationTasks({ limit, nowIso, staleBeforeIso })`.
- Produces: `cancelFlowActivationTasks({ conversationKey, reason })`.
- Produces: `markFlowActivationTaskSent({ id, worktoolMessageIds })`.
- Produces: `markFlowActivationTaskFailed({ id, error })`.
- Produces: `incrementFlowActivationGeneration({ conversationKey, reason })`.
- Extends: `rowToFlowSession(row)` with `activationGeneration`.

- [ ] **Step 1: Write failing DB tests**

Create `tests/db-activation.test.js`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-activation-test-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");

test("normalizeActivationConfig defaults and filters messages", () => {
  assert.deepEqual(db.normalizeActivationConfig({}), {
    enabled: false,
    intervalMinutes: 30,
    maxTimes: 1,
    polishByAgent: true,
    messages: []
  });

  assert.deepEqual(db.normalizeActivationConfig({
    enabled: true,
    intervalMinutes: "15",
    maxTimes: "2",
    polishByAgent: false,
    messages: ["  第一条  ", "", "第二条"]
  }), {
    enabled: true,
    intervalMinutes: 15,
    maxTimes: 2,
    polishByAgent: false,
    messages: ["第一条", "第二条"]
  });
});

test("activation tasks can be scheduled, claimed, sent, failed, and canceled", () => {
  const botId = "bot_activation";
  const conversationKey = `${botId}:private:张三`;
  const machine = db.upsertFlowMachine({
    botId,
    enabled: true,
    config: {
      name: "激活状态机",
      version: "1.0.0",
      entryNodeId: "node_1",
      nodes: [{ id: "node_1", name: "邀约", goal: "", completionCriteria: "", collectFields: [], conversationTips: [], nextNodeId: "" }]
    }
  });
  const session = db.getOrCreateFlowSession({ botId, conversationKey, machine });
  assert.equal(session.activationGeneration, 0);

  const task = db.scheduleFlowActivationTask({
    botId,
    agentId: "agent_activation",
    conversationKey,
    nodeId: "node_1",
    generation: session.activationGeneration,
    activation: {
      enabled: true,
      intervalMinutes: 30,
      maxTimes: 2,
      polishByAgent: false,
      messages: ["提醒一", "提醒二"]
    },
    dueAt: "2026-07-11T10:00:00.000Z"
  });
  assert.equal(task.status, "pending");
  assert.equal(task.attemptNumber, 1);

  const claimed = db.claimDueFlowActivationTasks({
    limit: 20,
    nowIso: "2026-07-11T10:00:01.000Z",
    staleBeforeIso: "2026-07-11T09:50:00.000Z"
  });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].status, "processing");
  assert.deepEqual(claimed[0].messages, ["提醒一", "提醒二"]);

  const sent = db.markFlowActivationTaskSent({
    id: claimed[0].id,
    worktoolMessageIds: ["wt_1", "wt_2"]
  });
  assert.equal(sent.status, "sent");
  assert.deepEqual(sent.worktoolMessageIds, ["wt_1", "wt_2"]);

  db.scheduleFlowActivationTask({
    botId,
    agentId: "agent_activation",
    conversationKey,
    nodeId: "node_1",
    generation: session.activationGeneration,
    activation: { enabled: true, intervalMinutes: 30, maxTimes: 2, polishByAgent: true, messages: ["继续提醒"] },
    dueAt: "2026-07-11T10:30:00.000Z",
    attemptNumber: 2
  });
  const canceled = db.cancelFlowActivationTasks({ conversationKey, reason: "customer_replied" });
  assert.equal(canceled >= 1, true);
  assert.equal(db.listFlowActivationTasks({ conversationKey }).at(-1).status, "canceled");
});

test("incrementFlowActivationGeneration invalidates old generations", () => {
  const botId = "bot_generation";
  const conversationKey = `${botId}:private:李四`;
  const machine = db.upsertFlowMachine({
    botId,
    enabled: true,
    config: {
      name: "代际状态机",
      version: "1.0.0",
      entryNodeId: "node_1",
      nodes: [{ id: "node_1", name: "节点", goal: "", completionCriteria: "", collectFields: [], conversationTips: [], nextNodeId: "" }]
    }
  });
  db.getOrCreateFlowSession({ botId, conversationKey, machine });
  const next = db.incrementFlowActivationGeneration({ conversationKey, reason: "customer_replied" });
  assert.equal(next.activationGeneration, 1);
});
```

- [ ] **Step 2: Run DB test and verify failure**

Run:

```bash
npm test -- tests/db-activation.test.js
```

Expected: FAIL because activation helpers are not exported.

- [ ] **Step 3: Add schema and helpers in `src/db.js`**

Add to schema:

```sql
CREATE TABLE IF NOT EXISTS flow_activation_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  conversation_key TEXT NOT NULL,
  node_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  attempt_number INTEGER NOT NULL,
  max_times INTEGER NOT NULL,
  interval_minutes INTEGER NOT NULL,
  polish_by_agent INTEGER NOT NULL DEFAULT 1,
  messages_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  due_at TEXT NOT NULL,
  processing_started_at TEXT,
  sent_at TEXT,
  canceled_at TEXT,
  cancel_reason TEXT,
  error_message TEXT,
  worktool_message_ids_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flow_activation_due
ON flow_activation_tasks (status, due_at);

CREATE INDEX IF NOT EXISTS idx_flow_activation_conversation
ON flow_activation_tasks (conversation_key, status);
```

Add:

```js
ensureColumn("flow_sessions", "activation_generation", "INTEGER NOT NULL DEFAULT 0");
```

Implement helpers named in Interfaces. `claimDueFlowActivationTasks` must first recover stale processing rows:

```js
db.prepare(`
  UPDATE flow_activation_tasks
  SET status = 'pending', processing_started_at = NULL, updated_at = ?
  WHERE status = 'processing'
    AND processing_started_at IS NOT NULL
    AND processing_started_at < ?
`).run(timestamp, staleBeforeIso);
```

Then select due rows and atomically update each row from `pending` to `processing` with `WHERE id = ? AND status = 'pending'`.

- [ ] **Step 4: Run DB test and verify pass**

Run:

```bash
npm test -- tests/db-activation.test.js && node --check src/db.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/db.js tests/db-activation.test.js
git commit -m "Add flow activation task persistence"
```

---

### Task 2: Add Activation Config to Flow Node Console

**Files:**
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Test: `tests/console-activation-boundary.test.js`

**Interfaces:**
- Consumes: `activation` node property shape from Task 1.
- Produces: UI serialization/deserialization for `node.activation`.

- [ ] **Step 1: Write failing console boundary test**

Create `tests/console-activation-boundary.test.js`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("flow node editor supports activation settings", () => {
  assert.equal(app.includes("defaultActivationConfig"), true);
  assert.equal(app.includes("activationEnabled"), true);
  assert.equal(app.includes("activationIntervalMinutes"), true);
  assert.equal(app.includes("activationMaxTimes"), true);
  assert.equal(app.includes("activationPolishByAgent"), true);
  assert.equal(app.includes("activationMessages"), true);
  assert.equal(app.includes("data-add-activation-message"), true);
  assert.equal(app.includes("data-remove-activation-message"), true);
  assert.equal(css.includes(".activation-editor"), true);
});

test("flow config preserves node activation JSON", () => {
  assert.equal(app.includes("activation: normalizeActivationDraft"), true);
  assert.equal(app.includes("node.activation || defaultActivationConfig()"), true);
});
```

- [ ] **Step 2: Run console test and verify failure**

```bash
npm test -- tests/console-activation-boundary.test.js
```

Expected: FAIL because editor fields do not exist.

- [ ] **Step 3: Implement activation draft helpers in `public/console/app.js`**

Add:

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

function normalizeActivationDraft(value = {}) {
  const defaults = defaultActivationConfig();
  const messages = Array.isArray(value.messages)
    ? value.messages.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  return {
    enabled: Boolean(value.enabled),
    intervalMinutes: Math.max(1, Number(value.intervalMinutes || defaults.intervalMinutes)),
    maxTimes: Math.max(1, Number(value.maxTimes || defaults.maxTimes)),
    polishByAgent: value.polishByAgent !== false,
    messages
  };
}
```

Update `createBlankFlowNode`, `setFlowEditorFromConfig`, and `buildFlowConfigFromEditor` to carry `activation`.

- [ ] **Step 4: Render activation editor inside each node card**

In `renderFlowNodeEditor`, after existing node fields, render:

```html
<section class="activation-editor">
  <label class="toggle">
    <input data-flow-node-activation-field="enabled" type="checkbox" />
    启用客户激活
  </label>
  <label>
    <span class="field-label">激活间隔（分钟）</span>
    <input data-flow-node-activation-field="intervalMinutes" type="number" min="1" />
  </label>
  <label>
    <span class="field-label">激活次数</span>
    <input data-flow-node-activation-field="maxTimes" type="number" min="1" />
  </label>
  <label class="toggle">
    <input data-flow-node-activation-field="polishByAgent" type="checkbox" />
    交给 Agent 美化话术
  </label>
  <div class="activation-messages">
    <!-- one textarea/input per message -->
  </div>
  <button data-add-activation-message="INDEX" type="button">新增话术</button>
</section>
```

Use real existing `icon()` buttons and `escapeHtml`.

- [ ] **Step 5: Add activation field event handlers**

Add listeners in `renderFlowNodeEditor`:

```js
els.flowNodeList.querySelectorAll("[data-flow-node-activation-field]").forEach((input) => {
  input.addEventListener("input", () => updateDraftNodeActivationFromInput(input));
  input.addEventListener("change", () => updateDraftNodeActivationFromInput(input));
});
```

Implement `updateDraftNodeActivationFromInput`, add/remove message handlers, and newline paste splitting into multiple messages.

- [ ] **Step 6: Add CSS**

Add `.activation-editor`, `.activation-message-row`, and compact button styling in `public/console/styles.css`.

- [ ] **Step 7: Run console test and verify pass**

```bash
npm test -- tests/console-activation-boundary.test.js && node --check public/console/app.js
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add public/console/app.js public/console/styles.css tests/console-activation-boundary.test.js
git commit -m "Add activation settings to flow node editor"
```

---

### Task 3: Build DClaw Activation Request

**Files:**
- Modify: `src/dclaw.js`
- Test: `tests/dclaw-activation.test.js`

**Interfaces:**
- Produces: `buildDclawActivationRequest({ binding, conversationKey, task, flow, recentMessages })`.
- Consumes: activation task row from Task 1.

- [ ] **Step 1: Write failing DClaw test**

Create `tests/dclaw-activation.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { buildDclawActivationRequest } from "../src/dclaw.js";

test("buildDclawActivationRequest creates a flow activation event", () => {
  const request = buildDclawActivationRequest({
    binding: { botId: "bot_1", agentId: "agent_1" },
    conversationKey: "bot_1:private:张三",
    task: {
      id: 7,
      nodeId: "node_1",
      attemptNumber: 1,
      maxTimes: 2,
      messages: ["再提醒您一下", "看到后回我一句"],
      intervalMinutes: 30
    },
    flow: {
      currentNode: { id: "node_1", name: "邀约", goal: "邀约客户" },
      session: { currentNodeId: "node_1" }
    },
    recentMessages: [
      { direction: "outbound", senderName: "客服", content: "刚才给您发了邀请" }
    ]
  });

  assert.equal(request.metadata.eventType, "flow_activation_due");
  assert.equal(request.metadata.worktool.eventType, "flow_activation_due");
  assert.equal(request.external_session_id, "bot_1:private:张三");
  assert.match(request.message, /请结合当前会话上下文/);
  assert.match(request.message, /只输出最终要发送给客户的激活话术/);
  assert.match(request.message, /再提醒您一下/);
});
```

- [ ] **Step 2: Run DClaw test and verify failure**

```bash
npm test -- tests/dclaw-activation.test.js
```

Expected: FAIL because function is missing.

- [ ] **Step 3: Implement `buildDclawActivationRequest`**

Add to `src/dclaw.js`:

```js
export function buildDclawActivationRequest({ binding, conversationKey, task, flow, recentMessages = [] }) {
  const worktoolMessage = {
    channel: "wecom-worktool",
    eventType: "flow_activation_due",
    botId: binding.botId,
    agentId: binding.agentId,
    conversationId: conversationKey,
    sessionId: conversationKey,
    messageId: `activation:${task.id}`,
    message: "",
    rawMessage: "",
    roomType: 2,
    groupName: "",
    userId: conversationKey.split(":private:")[1] || "",
    metadata: {
      activationTaskId: task.id,
      nodeId: task.nodeId,
      attemptNumber: task.attemptNumber,
      maxTimes: task.maxTimes,
      intervalMinutes: task.intervalMinutes,
      referenceMessages: task.messages
    }
  };

  return {
    external_user_id: worktoolMessage.userId || "unknown",
    external_session_id: conversationKey,
    message: [
      "你收到的是 WorkTool 回调服务器生成的节点激活任务。",
      "eventType=flow_activation_due 表示客户在当前节点长时间未回复，需要发送一次自然的激活提醒。",
      "请结合当前会话上下文、当前节点目标和参考话术，组织成真人客服会发送的一条激活消息。",
      "只输出最终要发送给客户的激活话术，不要输出分析过程、JSON 或 Markdown。",
      "",
      JSON.stringify({ worktoolMessage, flow, recentMessages }, null, 2)
    ].join("\n"),
    stream: true,
    metadata: {
      source: "worktool",
      eventType: "flow_activation_due",
      botId: binding.botId,
      agentId: binding.agentId,
      conversationId: conversationKey,
      worktool: worktoolMessage,
      flow
    }
  };
}
```

- [ ] **Step 4: Run DClaw test and verify pass**

```bash
npm test -- tests/dclaw-activation.test.js && node --check src/dclaw.js
```

- [ ] **Step 5: Commit Task 3**

```bash
git add src/dclaw.js tests/dclaw-activation.test.js
git commit -m "Add DClaw activation request builder"
```

---

### Task 4: Schedule and Cancel Activation Tasks from Message Flow

**Files:**
- Modify: `src/server.js`
- Modify: `src/db.js`
- Test: `tests/server-activation-boundary.test.js`

**Interfaces:**
- Consumes: Task 1 DB helpers.
- Produces: `scheduleActivationAfterFlowReply({ botId, binding, conversationKey, flow, sentAt })` in `src/server.js`.
- Produces: cancellation calls on inbound private message, handoff, reset, and node transitions.

- [ ] **Step 1: Write failing server boundary test**

Create `tests/server-activation-boundary.test.js`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const dbSource = fs.readFileSync(new URL("../src/db.js", import.meta.url), "utf8");

test("server schedules activation after successful private flow replies", () => {
  assert.equal(source.includes("scheduleActivationAfterFlowReply"), true);
  assert.equal(source.includes("scheduleFlowActivationTask"), true);
  assert.equal(source.indexOf("worktool.send.success") < source.indexOf("scheduleActivationAfterFlowReply"), true);
});

test("server cancels activation on inbound messages, handoff, reset, and node transition", () => {
  assert.equal(source.includes('reason: "customer_replied"'), true);
  assert.equal(source.includes('reason: "human_handoff"'), true);
  assert.equal(source.includes('reason: "conversation_reset"'), true);
  assert.equal(dbSource.includes("incrementFlowActivationGeneration"), true);
});
```

- [ ] **Step 2: Run server boundary test and verify failure**

```bash
npm test -- tests/server-activation-boundary.test.js
```

Expected: FAIL because scheduling/cancel markers are missing.

- [ ] **Step 3: Add scheduling helper to `src/server.js`**

Import DB helpers:

```js
cancelFlowActivationTasks,
incrementFlowActivationGeneration,
normalizeActivationConfig,
scheduleFlowActivationTask
```

Implement:

```js
function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000).toISOString();
}

function scheduleActivationAfterFlowReply({ botId, binding, conversationKey, flow, sentAt = new Date() }) {
  if (!flow || !isPrivateConversationKey(conversationKey)) return null;
  const activation = normalizeActivationConfig(flow.currentNode?.activation || {});
  cancelFlowActivationTasks({ conversationKey, reason: "new_flow_reply" });
  if (!activation.enabled || !activation.messages.length) return null;
  const session = incrementFlowActivationGeneration({ conversationKey, reason: "flow_reply_sent" });
  return scheduleFlowActivationTask({
    botId,
    agentId: binding.agentId,
    conversationKey,
    nodeId: session.currentNodeId,
    generation: session.activationGeneration,
    activation,
    dueAt: addMinutes(sentAt, activation.intervalMinutes),
    attemptNumber: 1
  });
}
```

Use a helper:

```js
function isPrivateConversationKey(conversationKey) {
  return String(conversationKey || "").includes(":private:");
}
```

- [ ] **Step 4: Call scheduling after successful WorkTool reply**

In `processIncomingMessage`, after `worktool.send.success` and after conversation message/outgoing inserts have succeeded, call:

```js
if (flow) {
  scheduleActivationAfterFlowReply({
    botId,
    binding,
    conversationKey,
    flow,
    sentAt: new Date()
  });
}
```

Use `logInfo("activation.scheduled", ...)` when a task is returned.

- [ ] **Step 5: Cancel activation on inbound private message**

After inserting inbound private conversation message:

```js
if (isPrivateMessage(message)) {
  incrementFlowActivationGeneration({ conversationKey, reason: "customer_replied" });
  cancelFlowActivationTasks({ conversationKey, reason: "customer_replied" });
}
```

Ensure this runs before agent processing so pending activation cannot fire after a customer reply.

- [ ] **Step 6: Cancel activation on handoff and reset**

In handoff route:

```js
if (session.handoffStatus === "human") {
  incrementFlowActivationGeneration({ conversationKey, reason: "human_handoff" });
  cancelFlowActivationTasks({ conversationKey, reason: "human_handoff" });
}
```

In reset route, after `clearConversationForReset`:

```js
incrementFlowActivationGeneration({ conversationKey, reason: "conversation_reset" });
cancelFlowActivationTasks({ conversationKey, reason: "conversation_reset" });
```

- [ ] **Step 7: Run boundary test and verify pass**

```bash
npm test -- tests/server-activation-boundary.test.js && node --check src/server.js
```

- [ ] **Step 8: Commit Task 4**

```bash
git add src/server.js src/db.js tests/server-activation-boundary.test.js
git commit -m "Schedule and cancel flow activation tasks"
```

---

### Task 5: Implement Activation Worker and Sending

**Files:**
- Modify: `src/server.js`
- Modify: `src/dclaw.js`
- Modify: `src/db.js`
- Test: `tests/server-activation-worker-boundary.test.js`

**Interfaces:**
- Consumes: `claimDueFlowActivationTasks`, `buildDclawActivationRequest`, WorkTool `sendTextMessage`.
- Produces: `processFlowActivationBatch()` and `processFlowActivationTask(task)`.

- [ ] **Step 1: Write failing worker boundary test**

Create `tests/server-activation-worker-boundary.test.js`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("activation worker is batch limited and non-overlapping", () => {
  assert.equal(source.includes("activationWorkerBusy"), true);
  assert.equal(source.includes("activationWorkerConfig"), true);
  assert.equal(source.includes("ACTIVATION_WORKER_BATCH_SIZE"), true);
  assert.equal(source.includes("claimDueFlowActivationTasks"), true);
  assert.equal(source.includes("processFlowActivationBatch"), true);
});

test("activation worker supports agent polished and raw message sends", () => {
  assert.equal(source.includes("buildDclawActivationRequest"), true);
  assert.equal(source.includes("task.polishByAgent"), true);
  assert.equal(source.includes("sendActivationRawMessages"), true);
  assert.equal(source.includes("sendActivationPolishedMessage"), true);
});
```

- [ ] **Step 2: Run worker boundary test and verify failure**

```bash
npm test -- tests/server-activation-worker-boundary.test.js
```

- [ ] **Step 3: Add worker config to `src/server.js`**

```js
const activationWorkerConfig = {
  enabled: process.env.ACTIVATION_WORKER_ENABLED !== "false",
  intervalMs: Number(process.env.ACTIVATION_WORKER_INTERVAL_MS || 10000),
  batchSize: Number(process.env.ACTIVATION_WORKER_BATCH_SIZE || 20),
  staleProcessingMs: Number(process.env.ACTIVATION_WORKER_STALE_PROCESSING_MS || 300000),
  sendDelayMs: Number(process.env.ACTIVATION_SEND_DELAY_MS || 500),
  maxConcurrentAgentCalls: Number(process.env.ACTIVATION_MAX_CONCURRENT_AGENT_CALLS || 2)
};

let activationWorkerBusy = false;
```

- [ ] **Step 4: Implement staleness guard**

Before sending a claimed task, load current session and skip if:

```js
!session ||
session.handoffStatus === "human" ||
session.currentNodeId !== task.nodeId ||
session.activationGeneration !== task.generation
```

Mark skipped tasks as failed or canceled with reason `"stale_activation_task"` and log `activation.stale_skipped`.

- [ ] **Step 5: Implement raw send path**

```js
async function sendActivationRawMessages({ task, binding }) {
  const ids = [];
  for (const content of task.messages) {
    const result = await sendTextMessage({
      robotId: task.botId,
      targets: [privateTargetNameFromConversationKey(task.conversationKey)],
      content
    });
    ids.push(result.data || "");
    insertConversationMessage({ ... });
    insertOutgoingMessage({ ... });
    if (activationWorkerConfig.sendDelayMs > 0) {
      await sleep(activationWorkerConfig.sendDelayMs);
    }
  }
  return ids.filter(Boolean);
}
```

Use existing `sleep(ms)` if present; otherwise add:

```js
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
```

- [ ] **Step 6: Implement polished send path**

Use `buildDclawActivationRequest`, `invokeDclawAgentWithRetry`, and `parseAgentReply`. If reply is empty, mark task failed with `"empty activation reply"`. Send one WorkTool text message with returned reply.

- [ ] **Step 7: Schedule next activation attempt**

After marking current task sent:

```js
if (task.attemptNumber < task.maxTimes) {
  scheduleFlowActivationTask({
    botId: task.botId,
    agentId: task.agentId,
    conversationKey: task.conversationKey,
    nodeId: task.nodeId,
    generation: task.generation,
    activation: {
      enabled: true,
      intervalMinutes: task.intervalMinutes,
      maxTimes: task.maxTimes,
      polishByAgent: task.polishByAgent,
      messages: task.messages
    },
    dueAt: addMinutes(new Date(), task.intervalMinutes),
    attemptNumber: task.attemptNumber + 1
  });
}
```

- [ ] **Step 8: Implement non-overlapping batch**

```js
async function processFlowActivationBatch() {
  if (!activationWorkerConfig.enabled || activationWorkerBusy) return;
  activationWorkerBusy = true;
  try {
    const nowDate = new Date();
    const staleBefore = new Date(nowDate.getTime() - activationWorkerConfig.staleProcessingMs).toISOString();
    const tasks = claimDueFlowActivationTasks({
      limit: activationWorkerConfig.batchSize,
      nowIso: nowDate.toISOString(),
      staleBeforeIso: staleBefore
    });
    logInfo("activation.worker.claimed", { count: tasks.length });
    for (const task of tasks) {
      await processFlowActivationTask(task);
    }
  } finally {
    activationWorkerBusy = false;
  }
}
```

Use sequential task processing for v1. Keep `ACTIVATION_MAX_CONCURRENT_AGENT_CALLS` in configuration for compatibility, but do not create overlapping scan batches.

- [ ] **Step 9: Start interval**

```js
if (activationWorkerConfig.enabled) {
  setInterval(() => {
    void processFlowActivationBatch().catch((error) => {
      logError("activation.worker.failed", { error });
    });
  }, activationWorkerConfig.intervalMs).unref();
}
```

- [ ] **Step 10: Run worker test and verify pass**

```bash
npm test -- tests/server-activation-worker-boundary.test.js && node --check src/server.js
```

- [ ] **Step 11: Commit Task 5**

```bash
git add src/server.js src/dclaw.js src/db.js tests/server-activation-worker-boundary.test.js
git commit -m "Process due flow activation tasks"
```

---

### Task 6: Expose Activation Logs and Documentation

**Files:**
- Modify: `src/db.js`
- Modify: `public/console/index.html`
- Modify: `README.md`
- Modify: `.env.example`
- Test: `tests/server-auth-boundary.test.js` if log type route coverage changes; otherwise add `tests/docs-activation-boundary.test.js`.

**Interfaces:**
- Produces log table entry key `"flow-activation-tasks"` in `listRecords`.

- [ ] **Step 1: Write failing docs/log boundary test**

Create `tests/docs-activation-boundary.test.js`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const env = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
const db = fs.readFileSync(new URL("../src/db.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");

test("activation worker config is documented", () => {
  assert.equal(env.includes("ACTIVATION_WORKER_BATCH_SIZE=20"), true);
  assert.equal(env.includes("ACTIVATION_SEND_DELAY_MS=500"), true);
  assert.equal(readme.includes("节点激活"), true);
});

test("activation tasks are visible in logs", () => {
  assert.equal(db.includes('"flow-activation-tasks"'), true);
  assert.equal(html.includes('value="flow-activation-tasks"'), true);
});
```

- [ ] **Step 2: Run docs/log test and verify failure**

```bash
npm test -- tests/docs-activation-boundary.test.js
```

- [ ] **Step 3: Add log type**

In `src/db.js` `listRecords` map, add:

```js
"flow-activation-tasks": {
  table: "flow_activation_tasks",
  orderBy: "id DESC"
}
```

In `public/console/index.html`, add option:

```html
<option value="flow-activation-tasks">节点激活任务</option>
```

- [ ] **Step 4: Document env vars**

Add to `.env.example`:

```bash
ACTIVATION_WORKER_ENABLED=true
ACTIVATION_WORKER_INTERVAL_MS=10000
ACTIVATION_WORKER_BATCH_SIZE=20
ACTIVATION_WORKER_STALE_PROCESSING_MS=300000
ACTIVATION_SEND_DELAY_MS=500
ACTIVATION_MAX_CONCURRENT_AGENT_CALLS=2
```

Add README section explaining node activation and deployment note that no agent upload is required.

- [ ] **Step 5: Run docs/log test and verify pass**

```bash
npm test -- tests/docs-activation-boundary.test.js
```

- [ ] **Step 6: Commit Task 6**

```bash
git add src/db.js public/console/index.html README.md .env.example tests/docs-activation-boundary.test.js
git commit -m "Document flow activation worker settings"
```

---

### Task 7: Final Verification

**Files:**
- No feature files unless previous tasks reveal issues.

**Interfaces:**
- Verifies all tasks together.

- [ ] **Step 1: Run full verification**

```bash
npm test
node --check src/server.js
node --check src/dclaw.js
node --check src/db.js
node --check public/console/app.js
```

Expected: all tests pass and syntax checks exit 0.

- [ ] **Step 2: Inspect git history**

```bash
git log --oneline -7
git status --short
```

Expected: task commits exist and working tree is clean.

- [ ] **Step 3: Push**

```bash
git push origin main
```

Expected: remote main accepts fast-forward push.

---

## Self-Review

- Spec coverage: node config, scheduling semantics, cancellation/staleness, worker non-overlap, raw vs agent-polished sends, persistence, logs, and docs are covered.
- Completeness scan: every task has concrete file paths, commands, and expected outcomes.
- Type consistency: activation config uses `activation.enabled`, `activation.intervalMinutes`, `activation.maxTimes`, `activation.polishByAgent`, and `activation.messages` consistently across DB, server, DClaw, and console tasks.
