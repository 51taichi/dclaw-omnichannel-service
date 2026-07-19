# Flow Invite-To-Group Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable action chips to flow nodes and activation messages so the console can invite the current private contact into a configured WorkTool group.

**Architecture:** State-machine config stays JSON-backed, but users edit actions through structured chips rather than text macros. The server executes actions after a successful node transition or after a successful activation message send, records idempotent execution state in SQLite, and calls WorkTool `sendRawMessage` type `207`.

**Tech Stack:** Node.js 22 ESM, Express, SQLite `node:sqlite`, browser JavaScript, CSS, `node --test`.

## Global Constraints

- First version supports only `invite_to_group`.
- First version supports only private conversations and `target: "current_contact"`.
- Do not implement rich text editors or text macros.
- Do not change Agent packages; this is a control-plane and WorkTool integration feature.
- Do not alter existing text, media, proactive, tag, handoff, or activation semantics except where this feature explicitly hooks after successful sends/transitions.
- Preserve existing dirty working-tree files not created by this task.

---

## File Structure

- `src/worktool.js`: WorkTool type `207` command builder and sender.
- `src/db.js`: normalized flow actions, `flow_action_executions` schema, and idempotent execution helpers.
- `src/server.js`: action execution helper, node-completion hook, activation-send hook, structured logs.
- `public/console/app.js`: action draft normalization, action chip UI, import/export preservation.
- `public/console/styles.css`: compact chip/action editor layout.
- `tests/worktool-group-invite.test.js`: WorkTool command payload tests.
- `tests/db-flow-action-executions.test.js`: SQLite idempotency tests.
- `tests/server-flow-actions-boundary.test.js`: server hook boundary tests.
- `tests/console-flow-actions-boundary.test.js`: console preservation/rendering boundary tests.

## Interfaces

### Flow Action Shape

```js
{
  id: "action_1",
  type: "invite_to_group",
  groupName: "直播课学习群",
  target: "current_contact",
  showMessageHistory: true,
  runOnce: true
}
```

### WorkTool API

```js
buildGroupInviteCommand({
  groupName: "直播课学习群",
  targets: ["张三"],
  showMessageHistory: true
});

// returns
{
  type: 207,
  groupName: "直播课学习群",
  selectList: ["张三"],
  removeList: [],
  showMessageHistory: true
}
```

### DB Helpers

```js
normalizeFlowActions(rawActions);
reserveFlowActionExecution({ botId, agentId, conversationKey, nodeId, activationTaskId, action });
markFlowActionExecutionSucceeded({ id, worktoolMessageId, worktoolResponse });
markFlowActionExecutionFailed({ id, errorMessage, worktoolResponse });
```

### Server Hook

```js
await executeFlowActions({
  source: "node_complete",
  botId,
  binding,
  conversationKey,
  nodeId,
  activationTaskId: "",
  actions
});
```

---

### Task 1: WorkTool Type 207 Command Builder

**Files:**
- Modify: `src/worktool.js`
- Create: `tests/worktool-group-invite.test.js`

**Interfaces:**
- Consumes: existing `requestWorkTool(path, options)` in `src/worktool.js`.
- Produces: `buildGroupInviteCommand({ groupName, targets, showMessageHistory })` and `sendGroupInviteCommand({ robotId, groupName, targets, showMessageHistory, socketType })`.

- [ ] **Step 1: Write the failing test**

Create `tests/worktool-group-invite.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGroupInviteCommand,
  sendGroupInviteCommand
} from "../src/worktool.js";

test("buildGroupInviteCommand builds WorkTool type 207 payload", () => {
  assert.deepEqual(
    buildGroupInviteCommand({
      groupName: "直播课学习群",
      targets: ["张三"],
      showMessageHistory: true
    }),
    {
      type: 207,
      groupName: "直播课学习群",
      selectList: ["张三"],
      removeList: [],
      showMessageHistory: true
    }
  );
});

test("buildGroupInviteCommand validates group name and targets", () => {
  assert.throws(
    () => buildGroupInviteCommand({ groupName: "", targets: ["张三"] }),
    /groupName must be a non-empty string/
  );
  assert.throws(
    () => buildGroupInviteCommand({ groupName: "直播课学习群", targets: [] }),
    /targets must be a non-empty array/
  );
});

test("sendGroupInviteCommand is exported separately from titleList raw commands", () => {
  assert.equal(typeof sendGroupInviteCommand, "function");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/worktool-group-invite.test.js
```

Expected: FAIL because `buildGroupInviteCommand` and `sendGroupInviteCommand` are not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `src/worktool.js` after `buildRawMediaCommand`:

```js
export function buildGroupInviteCommand({
  groupName,
  targets,
  showMessageHistory = true
}) {
  const normalizedGroupName = String(groupName || "").trim();
  if (!normalizedGroupName) {
    throw new Error("groupName must be a non-empty string");
  }
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("targets must be a non-empty array");
  }
  const selectList = targets.map((target) => String(target || "").trim()).filter(Boolean);
  if (selectList.length === 0) {
    throw new Error("targets must be a non-empty array");
  }
  return {
    type: 207,
    groupName: normalizedGroupName,
    selectList,
    removeList: [],
    showMessageHistory: Boolean(showMessageHistory)
  };
}

export async function sendGroupInviteCommand({
  robotId,
  groupName,
  targets,
  showMessageHistory = true,
  socketType = 2
}) {
  const command = buildGroupInviteCommand({ groupName, targets, showMessageHistory });
  return requestWorkTool("/wework/sendRawMessage", {
    robotId,
    method: "POST",
    body: JSON.stringify({
      socketType,
      list: [command]
    })
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/worktool-group-invite.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worktool.js tests/worktool-group-invite.test.js
git commit -m "Add WorkTool group invite command"
```

---

### Task 2: Flow Action Normalization And Idempotent Execution Log

**Files:**
- Modify: `src/db.js`
- Create: `tests/db-flow-action-executions.test.js`

**Interfaces:**
- Consumes: `json(value)`, `parseJson(value)`, `now()` helpers in `src/db.js`.
- Produces: `normalizeFlowActions`, `reserveFlowActionExecution`, `markFlowActionExecutionSucceeded`, `markFlowActionExecutionFailed`.

- [ ] **Step 1: Write the failing test**

Create `tests/db-flow-action-executions.test.js`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-flow-actions-test-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");

test("normalizeFlowActions keeps valid invite actions only", () => {
  assert.deepEqual(db.normalizeFlowActions([
    {
      id: "action_1",
      type: "invite_to_group",
      groupName: "直播课学习群",
      target: "current_contact",
      showMessageHistory: true
    },
    { id: "bad", type: "unknown", groupName: "忽略" },
    { id: "missing_group", type: "invite_to_group", groupName: "" }
  ]), [
    {
      id: "action_1",
      type: "invite_to_group",
      groupName: "直播课学习群",
      target: "current_contact",
      showMessageHistory: true,
      runOnce: true
    }
  ]);
});

test("reserveFlowActionExecution is idempotent for one conversation action", () => {
  const action = {
    id: "action_1",
    type: "invite_to_group",
    groupName: "直播课学习群",
    target: "current_contact",
    showMessageHistory: true,
    runOnce: true
  };
  const first = db.reserveFlowActionExecution({
    botId: "bot_a",
    agentId: "agent_a",
    conversationKey: "bot_a:private:张三",
    nodeId: "node_1",
    activationTaskId: "",
    action
  });
  const second = db.reserveFlowActionExecution({
    botId: "bot_a",
    agentId: "agent_a",
    conversationKey: "bot_a:private:张三",
    nodeId: "node_1",
    activationTaskId: "",
    action
  });
  assert.equal(first.reserved, true);
  assert.equal(second.reserved, false);
  assert.equal(second.execution.status, "processing");
});

test("flow action execution can be marked succeeded and failed", () => {
  const action = {
    id: "action_2",
    type: "invite_to_group",
    groupName: "直播课学习群",
    target: "current_contact",
    showMessageHistory: false,
    runOnce: true
  };
  const reserved = db.reserveFlowActionExecution({
    botId: "bot_a",
    agentId: "agent_a",
    conversationKey: "bot_a:private:李四",
    nodeId: "",
    activationTaskId: "activation:10",
    action
  });
  const done = db.markFlowActionExecutionSucceeded({
    id: reserved.execution.id,
    worktoolMessageId: "wt_msg_1",
    worktoolResponse: { code: 200, data: "wt_msg_1" }
  });
  assert.equal(done.status, "success");
  assert.equal(done.worktoolMessageId, "wt_msg_1");

  const failedAction = { ...action, id: "action_3" };
  const failedReserved = db.reserveFlowActionExecution({
    botId: "bot_a",
    agentId: "agent_a",
    conversationKey: "bot_a:private:王五",
    nodeId: "node_2",
    activationTaskId: "",
    action: failedAction
  });
  const failed = db.markFlowActionExecutionFailed({
    id: failedReserved.execution.id,
    errorMessage: "missing_contact_name",
    worktoolResponse: null
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.errorMessage, "missing_contact_name");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/db-flow-action-executions.test.js
```

Expected: FAIL because helpers do not exist.

- [ ] **Step 3: Add schema and row mapper**

In `src/db.js`, add this table inside the initial `db.exec` block after `flow_activation_tasks` indexes:

```sql
  CREATE TABLE IF NOT EXISTS flow_action_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    node_id TEXT NOT NULL DEFAULT '',
    activation_task_id TEXT NOT NULL DEFAULT '',
    action_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    action_json TEXT NOT NULL,
    status TEXT NOT NULL,
    worktool_message_id TEXT,
    worktool_response_json TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_flow_action_executions_unique
  ON flow_action_executions (
    bot_id, agent_id, conversation_key, node_id, activation_task_id, action_id
  );
```

Add after `rowToFlowActivationTask`:

```js
function rowToFlowActionExecution(row) {
  if (!row) return null;
  return {
    id: row.id,
    botId: row.bot_id,
    agentId: row.agent_id,
    conversationKey: row.conversation_key,
    nodeId: row.node_id || "",
    activationTaskId: row.activation_task_id || "",
    actionId: row.action_id,
    actionType: row.action_type,
    action: parseJson(row.action_json) || {},
    status: row.status,
    worktoolMessageId: row.worktool_message_id || "",
    worktoolResponse: parseJson(row.worktool_response_json),
    errorMessage: row.error_message || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
```

- [ ] **Step 4: Add normalization helpers**

Add near `normalizeActivationConfig` in `src/db.js`:

```js
export function normalizeFlowActions(rawActions = []) {
  if (!Array.isArray(rawActions)) return [];
  return rawActions
    .map((raw, index) => {
      const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
      const type = String(source.type || "").trim();
      const groupName = String(source.groupName || "").trim();
      if (type !== "invite_to_group" || !groupName) return null;
      const id = String(source.id || `action_${index + 1}`).trim() || `action_${index + 1}`;
      return {
        id,
        type,
        groupName,
        target: "current_contact",
        showMessageHistory: source.showMessageHistory !== false,
        runOnce: source.runOnce !== false
      };
    })
    .filter(Boolean);
}
```

Update `normalizeActivationMessage` to preserve `actionsAfterSend`:

```js
  return {
    content,
    intervalMinutes: Math.max(1, Number.parseInt(source.intervalMinutes ?? defaults.intervalMinutes, 10) || defaults.intervalMinutes),
    maxTimes: Math.max(1, Number.parseInt(source.maxTimes ?? defaults.maxTimes, 10) || defaults.maxTimes),
    actionsAfterSend: normalizeFlowActions(source.actionsAfterSend || [])
  };
```

Update flow machine node normalization where nodes are saved to include:

```js
actionsOnComplete: normalizeFlowActions(node.actionsOnComplete || []),
```

- [ ] **Step 5: Add execution reservation helpers**

Add in `src/db.js` after `insertOutgoingMessage`:

```js
export function reserveFlowActionExecution({
  botId,
  agentId,
  conversationKey,
  nodeId = "",
  activationTaskId = "",
  action
}) {
  const normalized = normalizeFlowActions([action])[0];
  if (!normalized) throw new Error("invalid flow action");
  const timestamp = now();
  db.prepare(`
    INSERT OR IGNORE INTO flow_action_executions (
      bot_id, agent_id, conversation_key, node_id, activation_task_id,
      action_id, action_type, action_json, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?)
  `).run(
    botId,
    agentId || "",
    conversationKey,
    nodeId || "",
    activationTaskId || "",
    normalized.id,
    normalized.type,
    json(normalized),
    timestamp,
    timestamp
  );
  const execution = rowToFlowActionExecution(db.prepare(`
    SELECT *
    FROM flow_action_executions
    WHERE bot_id = ?
      AND agent_id = ?
      AND conversation_key = ?
      AND node_id = ?
      AND activation_task_id = ?
      AND action_id = ?
  `).get(botId, agentId || "", conversationKey, nodeId || "", activationTaskId || "", normalized.id));
  return { reserved: execution?.createdAt === timestamp, execution };
}

export function markFlowActionExecutionSucceeded({ id, worktoolMessageId = "", worktoolResponse = null }) {
  const timestamp = now();
  db.prepare(`
    UPDATE flow_action_executions
    SET status = 'success',
        worktool_message_id = ?,
        worktool_response_json = ?,
        error_message = '',
        updated_at = ?
    WHERE id = ?
  `).run(worktoolMessageId || "", json(worktoolResponse), timestamp, id);
  return rowToFlowActionExecution(db.prepare("SELECT * FROM flow_action_executions WHERE id = ?").get(id));
}

export function markFlowActionExecutionFailed({ id, errorMessage = "", worktoolResponse = null }) {
  const timestamp = now();
  db.prepare(`
    UPDATE flow_action_executions
    SET status = 'failed',
        worktool_response_json = ?,
        error_message = ?,
        updated_at = ?
    WHERE id = ?
  `).run(json(worktoolResponse), String(errorMessage || ""), timestamp, id);
  return rowToFlowActionExecution(db.prepare("SELECT * FROM flow_action_executions WHERE id = ?").get(id));
}
```

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
node --test tests/db-flow-action-executions.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db.js tests/db-flow-action-executions.test.js
git commit -m "Add flow action execution log"
```

---

### Task 3: Server Node-Completion And Activation Action Execution

**Files:**
- Modify: `src/server.js`
- Test: `tests/server-flow-actions-boundary.test.js`

**Interfaces:**
- Consumes: `sendGroupInviteCommand` from Task 1 and DB helpers from Task 2.
- Produces: `executeFlowActions({ source, botId, binding, conversationKey, nodeId, activationTaskId, actions })`.

- [ ] **Step 1: Write the failing boundary test**

Create `tests/server-flow-actions-boundary.test.js`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const dbSource = fs.readFileSync(new URL("../src/db.js", import.meta.url), "utf8");
const worktoolSource = fs.readFileSync(new URL("../src/worktool.js", import.meta.url), "utf8");

function functionBody(name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} not found`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

test("server imports and uses group invite action infrastructure", () => {
  assert.equal(source.includes("sendGroupInviteCommand"), true);
  assert.equal(source.includes("reserveFlowActionExecution"), true);
  assert.equal(source.includes("markFlowActionExecutionSucceeded"), true);
  assert.equal(source.includes("markFlowActionExecutionFailed"), true);
  assert.equal(worktoolSource.includes("type: 207"), true);
  assert.equal(dbSource.includes("flow_action_executions"), true);
});

test("node completion executes old node actions only after a valid transition", () => {
  const body = functionBody("applyFlowDecision");
  assert.equal(body.includes("const completedNode = getFlowNode(flow.machine, flow.session.currentNodeId);"), true);
  assert.equal(body.includes("updateFlowSessionNode({"), true);
  assert.equal(body.includes("executeFlowActions({"), true);
  assert.equal(body.includes('source: "node_complete"'), true);
  assert.ok(body.indexOf("updateFlowSessionNode({") < body.indexOf("executeFlowActions({"));
});

test("activation actions run after activation delivery is finalized", () => {
  const start = source.indexOf("async function processFlowActivationTask");
  const end = source.indexOf("async function processFlowActivationBatch", start);
  const body = source.slice(start, end);
  assert.equal(body.includes("finalizeFlowActivationTaskDelivery"), true);
  assert.equal(body.includes("executeFlowActions({"), true);
  assert.equal(body.includes('source: "flow_activation"'), true);
  assert.ok(body.indexOf("finalizeFlowActivationTaskDelivery") < body.indexOf("executeFlowActions({"));
});

test("flow actions skip unsupported conversations without calling WorkTool", () => {
  const body = functionBody("executeInviteToGroupAction");
  assert.equal(body.includes("isPrivateConversationKey(conversationKey)"), true);
  assert.equal(body.includes("unsupported_conversation_type"), true);
  assert.equal(body.includes("privateTargetNameFromConversationKey(conversationKey)"), true);
  assert.equal(body.includes("missing_contact_name"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/server-flow-actions-boundary.test.js
```

Expected: FAIL because imports and functions do not exist.

- [ ] **Step 3: Add imports**

In `src/server.js`, add to the DB import list:

```js
  markFlowActionExecutionFailed,
  markFlowActionExecutionSucceeded,
  normalizeFlowActions,
  reserveFlowActionExecution,
```

Add to WorkTool import list:

```js
  sendGroupInviteCommand,
```

- [ ] **Step 4: Add executor helpers**

Add after `isValidFlowNode` in `src/server.js`:

```js
async function executeInviteToGroupAction({
  botId,
  binding,
  conversationKey,
  nodeId = "",
  activationTaskId = "",
  action
}) {
  const reservation = reserveFlowActionExecution({
    botId,
    agentId: binding.agentId,
    conversationKey,
    nodeId,
    activationTaskId,
    action
  });
  if (!reservation.reserved) {
    logInfo("flow_action.duplicate_skipped", {
      botId,
      agentId: binding.agentId,
      conversationKey,
      nodeId,
      activationTaskId,
      actionId: action.id,
      actionType: action.type
    });
    return reservation.execution;
  }

  if (!isPrivateConversationKey(conversationKey)) {
    return markFlowActionExecutionFailed({
      id: reservation.execution.id,
      errorMessage: "unsupported_conversation_type",
      worktoolResponse: null
    });
  }
  const target = privateTargetNameFromConversationKey(conversationKey);
  if (!target) {
    return markFlowActionExecutionFailed({
      id: reservation.execution.id,
      errorMessage: "missing_contact_name",
      worktoolResponse: null
    });
  }

  try {
    const result = await sendGroupInviteCommand({
      robotId: botId,
      groupName: action.groupName,
      targets: [target],
      showMessageHistory: action.showMessageHistory
    });
    insertOutgoingMessage({
      botId,
      agentId: binding.agentId,
      conversationKey,
      messageId: result?.data || "",
      targetName: action.groupName,
      content: `拉入群：${target} -> ${action.groupName}`,
      worktoolResponse: {
        ...(result || {}),
        source: "flow_action",
        action
      }
    });
    const execution = markFlowActionExecutionSucceeded({
      id: reservation.execution.id,
      worktoolMessageId: result?.data || "",
      worktoolResponse: result || null
    });
    logInfo("flow_action.sent", {
      botId,
      agentId: binding.agentId,
      conversationKey,
      nodeId,
      activationTaskId,
      actionId: action.id,
      actionType: action.type,
      groupName: action.groupName,
      targetName: target,
      worktoolMessageId: result?.data || ""
    });
    return execution;
  } catch (error) {
    const execution = markFlowActionExecutionFailed({
      id: reservation.execution.id,
      errorMessage: error.message,
      worktoolResponse: null
    });
    logWarn("flow_action.failed", {
      botId,
      agentId: binding.agentId,
      conversationKey,
      nodeId,
      activationTaskId,
      actionId: action.id,
      actionType: action.type,
      groupName: action.groupName,
      error: error.message
    });
    return execution;
  }
}

async function executeFlowActions({
  source,
  botId,
  binding,
  conversationKey,
  nodeId = "",
  activationTaskId = "",
  actions = []
}) {
  const normalizedActions = normalizeFlowActions(actions);
  for (const action of normalizedActions) {
    if (action.type === "invite_to_group") {
      await executeInviteToGroupAction({
        botId,
        binding,
        conversationKey,
        nodeId,
        activationTaskId,
        action
      });
      continue;
    }
    logWarn("flow_action.unsupported", {
      source,
      botId,
      agentId: binding.agentId,
      conversationKey,
      nodeId,
      activationTaskId,
      actionId: action.id,
      actionType: action.type
    });
  }
}
```

- [ ] **Step 5: Hook node-completion actions after successful transition**

Replace `applyFlowDecision` with:

```js
async function applyFlowDecision({ botId, binding, conversationKey, message, flow, decision }) {
  if (!flow || !decision || typeof decision !== "object") return;
  const patch = decision.collectedDataPatch || decision.collectedFields || decision.dataPatch || {};
  if (patch && typeof patch === "object" && !Array.isArray(patch)) {
    mergeFlowSessionData({ conversationKey, patch });
  }

  const nextNodeId = String(decision.nextNodeId || "").trim();
  if (
    decision.nodeCompleted === true &&
    nextNodeId &&
    nextNodeId !== flow.session.currentNodeId &&
    isValidFlowNode(flow.machine, nextNodeId)
  ) {
    const completedNode = getFlowNode(flow.machine, flow.session.currentNodeId);
    updateFlowSessionNode({
      botId,
      conversationKey,
      nextNodeId,
      reason: decision.reason || "Agent 判断节点完成",
      decision
    });
    invalidateFlowActivation({ conversationKey, reason: "node_transition" });
    await executeFlowActions({
      source: "node_complete",
      botId,
      binding,
      conversationKey,
      nodeId: completedNode?.id || flow.session.currentNodeId,
      activationTaskId: "",
      actions: completedNode?.actionsOnComplete || []
    });
  }
}
```

- [ ] **Step 6: Hook activation actions after delivery finalization**

Inside `processFlowActivationTask`, immediately after:

```js
const { task: sentTask, progress } = delivery;
```

add:

```js
const sentMessage = sentTask.messages?.[sentTask.messageIndex] || null;
if (!sentTask.wasCanceled && sentMessage?.actionsAfterSend?.length) {
  await executeFlowActions({
    source: "flow_activation",
    botId: task.botId,
    binding,
    conversationKey: task.conversationKey,
    nodeId: task.nodeId,
    activationTaskId: String(task.id),
    actions: sentMessage.actionsAfterSend
  });
}
```

- [ ] **Step 7: Run test to verify it passes**

Run:

```bash
node --test tests/server-flow-actions-boundary.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server.js tests/server-flow-actions-boundary.test.js
git commit -m "Execute flow action chips"
```

---

### Task 4: Console Flow Action Chips

**Files:**
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Create: `tests/console-flow-actions-boundary.test.js`

**Interfaces:**
- Consumes: `actionsOnComplete` and `actionsAfterSend` JSON fields.
- Produces: chip UI and draft preservation for node and activation message actions.

- [ ] **Step 1: Write the failing boundary test**

Create `tests/console-flow-actions-boundary.test.js`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("flow editor normalizes and preserves structured action chips", () => {
  assert.equal(app.includes("defaultFlowAction"), true);
  assert.equal(app.includes("normalizeFlowActionDraft"), true);
  assert.equal(app.includes("actionsOnComplete: normalizeFlowActionDrafts"), true);
  assert.equal(app.includes("actionsAfterSend: normalizeFlowActionDrafts"), true);
});

test("node and activation action chips render outside textareas", () => {
  assert.equal(app.includes("renderFlowActionChips"), true);
  assert.equal(app.includes("data-add-node-action"), true);
  assert.equal(app.includes("data-add-activation-action"), true);
  assert.equal(app.includes("data-flow-action-group-name"), true);
  assert.equal(css.includes(".flow-action-chips"), true);
  assert.equal(css.includes(".flow-action-chip"), true);
  assert.equal(css.includes(".flow-action-editor"), true);
});

test("action chip copy uses invite wording and current contact scope", () => {
  assert.equal(app.includes("拉入群"), true);
  assert.equal(app.includes("当前客户"), true);
  assert.equal(app.includes("showMessageHistory"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/console-flow-actions-boundary.test.js
```

Expected: FAIL because chip helpers do not exist.

- [ ] **Step 3: Add draft helpers**

In `public/console/app.js` after `defaultActivationMessage`, add:

```js
function defaultFlowAction(index = 1) {
  return {
    id: `action_${index}`,
    type: "invite_to_group",
    groupName: "",
    target: "current_contact",
    showMessageHistory: true,
    runOnce: true
  };
}

function normalizeFlowActionDraft(value = {}, index = 1) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    id: String(source.id || `action_${index}`).trim() || `action_${index}`,
    type: "invite_to_group",
    groupName: String(source.groupName || ""),
    target: "current_contact",
    showMessageHistory: source.showMessageHistory !== false,
    runOnce: source.runOnce !== false
  };
}

function normalizeFlowActionDrafts(value = []) {
  return Array.isArray(value)
    ? value.map((item, index) => normalizeFlowActionDraft(item, index + 1))
    : [];
}
```

Update `normalizeActivationMessageDraft` return value:

```js
    actionsAfterSend: normalizeFlowActionDrafts(source.actionsAfterSend || [])
```

Update `createBlankFlowNode`:

```js
    actionsOnComplete: [],
```

Update `setFlowEditorFromConfig` node mapping:

```js
        actionsOnComplete: normalizeFlowActionDrafts(node.actionsOnComplete || []),
```

Update `buildFlowConfigFromEditor` node mapping:

```js
    actionsOnComplete: normalizeFlowActionDrafts(node.actionsOnComplete || []),
```

- [ ] **Step 4: Add rendering helpers**

In `public/console/app.js` before `renderFlowNodeEditor`, add:

```js
function renderFlowActionChips(actions = [], { nodeIndex, messageIndex = null }) {
  const normalized = normalizeFlowActionDrafts(actions);
  const scope = messageIndex === null ? "node" : "activation";
  const addAttr = scope === "node"
    ? `data-add-node-action="${nodeIndex}"`
    : `data-add-activation-action="${nodeIndex}:${messageIndex}"`;
  const chips = normalized.map((action, actionIndex) => {
    const editAttr = scope === "node"
      ? `data-edit-node-action="${nodeIndex}:${actionIndex}"`
      : `data-edit-activation-action="${nodeIndex}:${messageIndex}:${actionIndex}"`;
    const removeAttr = scope === "node"
      ? `data-remove-node-action="${nodeIndex}:${actionIndex}"`
      : `data-remove-activation-action="${nodeIndex}:${messageIndex}:${actionIndex}"`;
    const label = action.groupName ? `拉入：${action.groupName}` : "拉入群";
    return `
      <span class="flow-action-chip" title="当前客户拉入群">
        ${icon("users")}
        <button ${editAttr} type="button">${escapeHtml(label)}</button>
        <button ${removeAttr} class="flow-action-remove" type="button" aria-label="删除动作">${icon("reset")}</button>
      </span>
    `;
  }).join("");
  return `
    <div class="flow-action-chips" data-flow-action-scope="${scope}">
      ${chips}
      <button class="secondary icon-button flow-action-add" ${addAttr} type="button" aria-label="新增拉群动作" title="新增拉群动作">${icon("plus")}</button>
    </div>
  `;
}

function renderFlowActionEditor(action, attrPrefix) {
  return `
    <div class="flow-action-editor">
      <label class="field-row">
        <span class="field-label">${icon("users")}拉入群</span>
        <input ${attrPrefix}-group-name value="${escapeHtml(action.groupName)}" placeholder="输入群名，例如：直播课学习群" />
      </label>
      <label class="toggle">
        <input ${attrPrefix}-show-history type="checkbox" ${action.showMessageHistory ? "checked" : ""} />
        <span>允许查看群历史消息</span>
      </label>
      <span class="flow-action-scope">对象：当前客户</span>
    </div>
  `;
}
```

- [ ] **Step 5: Render node actions and activation actions**

In `renderFlowNodeEditor`, after `</div>` for `.flow-node-grid`, add:

```js
          ${renderFlowActionChips(node.actionsOnComplete || [], { nodeIndex: index })}
```

Inside each `.activation-message-card`, after `</div>` for `.activation-message-actions`, add:

```js
                    ${renderFlowActionChips(activationMessage.actionsAfterSend || [], { nodeIndex: index, messageIndex })}
```

- [ ] **Step 6: Add update handlers**

Add helpers near activation message functions:

```js
function nextFlowActionId(actions = []) {
  const used = new Set(actions.map((action) => String(action.id || "")));
  let index = actions.length + 1;
  while (used.has(`action_${index}`)) index += 1;
  return `action_${index}`;
}

function addNodeAction(nodeIndex) {
  const node = flowDraftNodes[nodeIndex];
  if (!node) return;
  const actions = normalizeFlowActionDrafts(node.actionsOnComplete || []);
  actions.push({ ...defaultFlowAction(actions.length + 1), id: nextFlowActionId(actions) });
  node.actionsOnComplete = actions;
  renderFlowNodeEditor(els.flowMachineForm.entryNodeId.value);
  syncFlowJsonTextarea();
}

function addActivationAction(nodeIndex, messageIndex) {
  const node = flowDraftNodes[nodeIndex];
  if (!node) return;
  const activation = activationDraftForEditor(node.activation);
  const message = normalizeActivationMessageDraft(activation.messages[messageIndex]);
  const actions = normalizeFlowActionDrafts(message.actionsAfterSend || []);
  actions.push({ ...defaultFlowAction(actions.length + 1), id: nextFlowActionId(actions) });
  message.actionsAfterSend = actions;
  activation.messages[messageIndex] = message;
  node.activation = activation;
  renderFlowNodeEditor(els.flowMachineForm.entryNodeId.value);
  syncFlowJsonTextarea();
}
```

Bind click listeners inside `renderFlowNodeEditor`:

```js
  els.flowNodeList.querySelectorAll("[data-add-node-action]").forEach((button) => {
    button.addEventListener("click", () => addNodeAction(Number(button.dataset.addNodeAction)));
  });
  els.flowNodeList.querySelectorAll("[data-add-activation-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const [nodeIndex, messageIndex] = button.dataset.addActivationAction.split(":").map(Number);
      addActivationAction(nodeIndex, messageIndex);
    });
  });
```

Add inline editors for every rendered action. Each editor must expose group name, show-history toggle, and delete controls, and every control must update `flowDraftNodes` immediately before calling `syncFlowJsonTextarea()`.

Add node-action markup in `renderFlowActionChips(actions, { nodeIndex })`:

```js
        <div class="flow-action-editor" data-flow-action-editor="${nodeIndex}:${actionIndex}">
          <span class="flow-action-chip"><i data-lucide="user-plus"></i> 拉入群</span>
          <label class="input-group compact">
            <span>群名</span>
            <input data-node-action-group-name="${nodeIndex}:${actionIndex}" value="${escapeHtml(action.groupName || "")}" placeholder="例如 直播课学习群" />
          </label>
          <label class="checkbox-pill">
            <input type="checkbox" data-node-action-show-history="${nodeIndex}:${actionIndex}" ${action.showMessageHistory === false ? "" : "checked"} />
            <span>带聊天记录</span>
          </label>
          <button type="button" class="icon-button danger" data-remove-node-action="${nodeIndex}:${actionIndex}" title="删除动作">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
```

Add activation-action markup with `data-activation-action-group-name="${nodeIndex}:${messageIndex}:${actionIndex}"`, `data-activation-action-show-history`, and `data-remove-activation-action`.

Bind input/change/click listeners in `renderFlowNodeEditor`:

```js
  els.flowNodeList.querySelectorAll("[data-node-action-group-name]").forEach((input) => {
    input.addEventListener("input", () => {
      const [nodeIndex, actionIndex] = input.dataset.nodeActionGroupName.split(":").map(Number);
      const node = flowDraftNodes[nodeIndex];
      if (!node?.actionsOnComplete?.[actionIndex]) return;
      node.actionsOnComplete[actionIndex].groupName = input.value;
      syncFlowJsonTextarea();
    });
  });
  els.flowNodeList.querySelectorAll("[data-node-action-show-history]").forEach((input) => {
    input.addEventListener("change", () => {
      const [nodeIndex, actionIndex] = input.dataset.nodeActionShowHistory.split(":").map(Number);
      const node = flowDraftNodes[nodeIndex];
      if (!node?.actionsOnComplete?.[actionIndex]) return;
      node.actionsOnComplete[actionIndex].showMessageHistory = input.checked;
      syncFlowJsonTextarea();
    });
  });
  els.flowNodeList.querySelectorAll("[data-remove-node-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const [nodeIndex, actionIndex] = button.dataset.removeNodeAction.split(":").map(Number);
      const node = flowDraftNodes[nodeIndex];
      if (!node) return;
      node.actionsOnComplete = normalizeFlowActionDrafts(node.actionsOnComplete || []).filter((_, index) => index !== actionIndex);
      renderFlowNodeEditor(els.flowMachineForm.entryNodeId.value);
      syncFlowJsonTextarea();
    });
  });
```

Add equivalent listeners for `data-activation-action-group-name`, `data-activation-action-show-history`, and `data-remove-activation-action`.

- [ ] **Step 7: Add styles**

Add to `public/console/styles.css` near activation styles:

```css
.flow-action-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.flow-action-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 220px;
  height: 34px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--line));
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 7%, #ffffff);
  color: var(--accent);
  font-weight: 900;
}

.flow-action-chip .icon {
  width: 14px;
  height: 14px;
}

.flow-action-chip button {
  min-width: 0;
  height: auto;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  color: inherit;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-action-remove {
  flex: 0 0 auto;
}

.flow-action-editor {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) max-content max-content;
  gap: 8px;
  align-items: center;
  padding: 8px;
  border: 1px dashed color-mix(in srgb, var(--accent) 32%, var(--line));
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 4%, #ffffff);
}

.flow-action-scope {
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run:

```bash
node --test tests/console-flow-actions-boundary.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add public/console/app.js public/console/styles.css tests/console-flow-actions-boundary.test.js
git commit -m "Add flow action chips to console"
```

---

### Task 5: End-To-End Regression And Docs

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: all previous task interfaces.
- Produces: operator documentation for configuring invite-to-group action chips.

- [ ] **Step 1: Add README note**

Add to `README.md` under the console/state-machine section:

```md
### 任务动作：拉人入群

任务节点和激活话术支持“动作 chips”。第一版支持把当前私聊客户拉入指定外部群：

- 节点动作：节点完成并成功进入下一节点后执行。
- 激活动作：激活话术发送成功后执行。
- 目标：当前私聊客户。
- 群名：填写 WorkTool/企微中可识别的群名称。
- 幂等：同一会话同一节点动作默认只执行一次，避免重复拉群。

动作失败不会回滚已经发送给客户的话术，但会写入日志和发送记录。
```

- [ ] **Step 2: Run targeted tests**

Run:

```bash
node --test \
  tests/worktool-group-invite.test.js \
  tests/db-flow-action-executions.test.js \
  tests/server-flow-actions-boundary.test.js \
  tests/console-flow-actions-boundary.test.js \
  tests/console-activation-boundary.test.js \
  tests/server-activation-boundary.test.js \
  tests/db-activation.test.js
```

Expected: all tests PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 4: Inspect git diff**

Run:

```bash
git diff --stat
git diff -- src/worktool.js src/db.js src/server.js public/console/app.js public/console/styles.css README.md
```

Expected: diff only contains action-chip feature changes and README documentation.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "Document flow action chips"
```

---

## Verification Checklist

- WorkTool type `207` payload is built without `titleList`.
- Existing `sendRawCommand` remains unchanged for media/file sends.
- Node actions execute only after `updateFlowSessionNode`.
- Activation actions execute only after `finalizeFlowActivationTaskDelivery`.
- Failed actions do not block normal customer reply or activation message delivery.
- Duplicate node-completion or worker retry does not repeat the same action.
- Group conversations never execute the invite-to-group action.
- Flow import/export preserves `actionsOnComplete` and `actionsAfterSend`.
- Console users configure action chips outside textareas.
