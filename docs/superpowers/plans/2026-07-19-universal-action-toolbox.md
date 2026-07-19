# Universal Action Toolbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable right-side action toolbox that inserts action chips for task nodes and activation scripts, while ensuring customers only receive cleaned text and actions execute after the visible message.

**Architecture:** Keep the existing `flow_action` executor and WorkTool type 207 sender. Add a shared action-chip parser for textual chips, teach flow/activation normalization to split chip text into structured actions, and add a floating console toolbox that can append actions to node completion actions or insert chips into activation textareas.

**Tech Stack:** Node.js ESM, Express, `node:test`, SQLite through `node:sqlite`, browser-side vanilla JavaScript and CSS.

## Global Constraints

- First version supports only the `invite_to_group` action.
- Customers must never receive `[动作：...]` chip text.
- Execution order is: send cleaned text first, then execute actions in chip order.
- If a message contains only action chips and no visible text, do not send an empty text message; execute the actions only.
- `invite_to_group` actions are private-conversation only and target `current_contact`.
- The right-side toolbox is the only creation entry for new actions. Existing local action chips remain visible for review/removal, but local "add action" buttons are removed.
- Activation messages store actions as `actionsAfterSend` in JSON, but render them as text chips inside the textarea so users can place the action in natural-language scripts.
- Agent packages are not modified.
- Existing unrelated dirty files must not be staged or changed.

---

## File Structure

- Create `src/action-chips.js`: shared server-side chip serialization, parsing, stripping, and action merge helpers.
- Modify `src/db.js`: normalize activation message content by extracting textual chips into `actionsAfterSend`.
- Modify `src/server.js`: when sending activation messages, strip any remaining chip text defensively and execute merged actions after text delivery.
- Modify `public/console/app.js`: add browser-side action chip helpers, focus tracking, toolbox state, node action insertion, activation textarea chip insertion, and save/load transforms.
- Modify `public/console/styles.css`: style the fixed right-side toolbox and focused action targets.
- Test `tests/action-chips.test.js`: shared parsing and stripping behavior.
- Test `tests/db-flow-action-chips.test.js`: DB normalization converts activation text chips into structured actions.
- Test `tests/server-flow-action-chips-boundary.test.js`: server strips chip text, executes action-only messages, and preserves execution ordering.
- Test `tests/console-action-toolbox-boundary.test.js`: console renders toolbox, inserts action chips, and builds clean structured JSON.

---

## Task 1: Shared Action Chip Parser

**Files:**
- Create: `src/action-chips.js`
- Test: `tests/action-chips.test.js`

**Interfaces:**
- Produces: `serializeActionChip(action: object): string`
- Produces: `extractActionChips(text: string): Array<object>`
- Produces: `stripActionChips(text: string): string`
- Produces: `mergeInlineActions({ content: string, actions: Array<object> }): { content: string, actions: Array<object> }`

- [ ] **Step 1: Write the failing test**

Create `tests/action-chips.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  extractActionChips,
  mergeInlineActions,
  serializeActionChip,
  stripActionChips
} from "../src/action-chips.js";

test("serializes and extracts invite-to-group chips", () => {
  const chip = serializeActionChip({
    id: "action_9",
    type: "invite_to_group",
    groupName: "直播课学习群",
    target: "current_contact",
    showMessageHistory: true
  });

  assert.equal(chip, "[动作：拉入 直播课学习群]");
  assert.deepEqual(extractActionChips(`我先拉你进群 ${chip}`), [
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

test("strips chips from customer-visible text", () => {
  assert.equal(
    stripActionChips("我先拉你进群。[动作：拉入 直播课学习群] 进去后看群公告。"),
    "我先拉你进群。进去后看群公告。"
  );
  assert.equal(stripActionChips("[动作：拉入 直播课学习群]"), "");
});

test("mergeInlineActions appends textual chips after existing structured actions", () => {
  assert.deepEqual(
    mergeInlineActions({
      content: "收到。[动作：拉入 直播课学习群]",
      actions: [{ id: "manual_1", type: "invite_to_group", groupName: "老群", target: "current_contact" }]
    }),
    {
      content: "收到。",
      actions: [
        {
          id: "manual_1",
          type: "invite_to_group",
          groupName: "老群",
          target: "current_contact",
          showMessageHistory: true,
          runOnce: true
        },
        {
          id: "action_2",
          type: "invite_to_group",
          groupName: "直播课学习群",
          target: "current_contact",
          showMessageHistory: true,
          runOnce: true
        }
      ]
    }
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/action-chips.test.js
```

Expected: FAIL with module not found for `../src/action-chips.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/action-chips.js`:

```js
const INVITE_TO_GROUP_CHIP_RE = /\[动作：拉入\s+([^\]\n\r]+?)\]/g;

export function serializeActionChip(action = {}) {
  const groupName = String(action.groupName || action.params?.groupName || "").trim();
  if (!groupName) return "";
  if (String(action.type || "") !== "invite_to_group") return "";
  return `[动作：拉入 ${groupName}]`;
}

export function extractActionChips(text = "") {
  const source = String(text || "");
  const actions = [];
  let match;
  while ((match = INVITE_TO_GROUP_CHIP_RE.exec(source))) {
    const groupName = String(match[1] || "").trim();
    if (!groupName) continue;
    actions.push({
      id: `action_${actions.length + 1}`,
      type: "invite_to_group",
      groupName,
      target: "current_contact",
      showMessageHistory: true,
      runOnce: true
    });
  }
  return actions;
}

export function stripActionChips(text = "") {
  return String(text || "")
    .replace(INVITE_TO_GROUP_CHIP_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([。！？!?，,；;：:])/g, "$1")
    .trim();
}

function normalizeInlineAction(action = {}, index = 1) {
  if (!action || typeof action !== "object" || Array.isArray(action)) return null;
  if (String(action.type || "") !== "invite_to_group") return null;
  const groupName = String(action.groupName || action.params?.groupName || "").trim();
  if (!groupName) return null;
  return {
    id: String(action.id || `action_${index}`).trim() || `action_${index}`,
    type: "invite_to_group",
    groupName,
    target: "current_contact",
    showMessageHistory: action.showMessageHistory !== false,
    runOnce: action.runOnce !== false
  };
}

export function mergeInlineActions({ content = "", actions = [] } = {}) {
  const structured = Array.isArray(actions)
    ? actions.map((action, index) => normalizeInlineAction(action, index + 1)).filter(Boolean)
    : [];
  const inline = extractActionChips(content).map((action, index) => ({
    ...action,
    id: `action_${structured.length + index + 1}`
  }));
  return {
    content: stripActionChips(content),
    actions: [...structured, ...inline]
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/action-chips.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/action-chips.js tests/action-chips.test.js
git commit -m "Add action chip parser"
```

---

## Task 2: Persist Activation Chips As Structured Actions

**Files:**
- Modify: `src/db.js`
- Test: `tests/db-flow-action-chips.test.js`

**Interfaces:**
- Consumes: `mergeInlineActions({ content, actions })` from `src/action-chips.js`
- Produces: normalized activation messages where `content` is customer-visible text and `actionsAfterSend` contains parsed chips

- [ ] **Step 1: Write the failing test**

Create `tests/db-flow-action-chips.test.js`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-action-chip-db-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");

test("activation text chips are stored as actions and removed from message content", () => {
  db.ensureAgent("agent_action_chip");
  db.saveAgentFlowMachine({
    agentId: "agent_action_chip",
    name: "动作测试",
    enabled: true,
    config: {
      name: "动作测试",
      entryNodeId: "node_1",
      nodes: [
        {
          id: "node_1",
          name: "发资料",
          activation: {
            enabled: true,
            polishByAgent: false,
            messages: [
              {
                content: "我先拉你进直播课学习群。[动作：拉入 直播课学习群]",
                intervalMinutes: 5,
                maxTimes: 1
              }
            ]
          }
        }
      ]
    }
  });

  const machine = db.getAgentFlowMachine("agent_action_chip");
  const message = machine.config.nodes[0].activation.messages[0];
  assert.equal(message.content, "我先拉你进直播课学习群。");
  assert.deepEqual(message.actionsAfterSend, [
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

test("action-only activation messages are preserved", () => {
  const normalized = db.normalizeActivationConfig({
    enabled: true,
    messages: [{ content: "[动作：拉入 直播课学习群]", intervalMinutes: 1, maxTimes: 1 }]
  });

  assert.equal(normalized.messages[0].content, "");
  assert.equal(normalized.messages[0].actionsAfterSend[0].groupName, "直播课学习群");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/db-flow-action-chips.test.js
```

Expected: FAIL because `normalizeActivationConfig` currently keeps chip text or drops action-only messages.

- [ ] **Step 3: Write minimal implementation**

In `src/db.js`, import the helper:

```js
import { mergeInlineActions } from "./action-chips.js";
```

Update `normalizeActivationMessage(raw, defaults)` so it parses chip content before the blank-content check:

```js
function normalizeActivationMessage(raw, defaults) {
  const source = typeof raw === "string" ? { content: raw } : raw || {};
  const merged = mergeInlineActions({
    content: String(source.content || "").trim(),
    actions: source.actionsAfterSend
  });
  const content = merged.content;
  const actionsAfterSend = normalizeFlowActions(merged.actions);
  if (!content && actionsAfterSend.length === 0) return null;
  return {
    content,
    intervalMinutes: Math.max(1, Number.parseInt(source.intervalMinutes ?? defaults.intervalMinutes, 10) || defaults.intervalMinutes),
    maxTimes: Math.max(1, Number.parseInt(source.maxTimes ?? defaults.maxTimes, 10) || defaults.maxTimes),
    ...(actionsAfterSend.length ? { actionsAfterSend } : {})
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/db-flow-action-chips.test.js tests/db-flow-action-executions.test.js tests/db-activation.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db.js tests/db-flow-action-chips.test.js
git commit -m "Persist activation action chips"
```

---

## Task 3: Server Sends Clean Text Before Actions

**Files:**
- Modify: `src/server.js`
- Test: `tests/server-flow-action-chips-boundary.test.js`

**Interfaces:**
- Consumes: `mergeInlineActions({ content, actions })`
- Consumes: existing `executeFlowActions({ source, botId, binding, conversationKey, nodeId, activationTaskId, actions })`
- Produces: activation delivery path that never sends chip text to WorkTool

- [ ] **Step 1: Write the failing test**

Create `tests/server-flow-action-chips-boundary.test.js`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("activation delivery strips action chips before sending visible text", () => {
  assert.equal(source.includes("mergeInlineActions({"), true);
  assert.equal(source.includes("visibleActivationContent"), true);
  assert.equal(source.includes("if (visibleActivationContent)"), true);
});

test("activation delivery executes actions even when the message has no visible text", () => {
  assert.equal(source.includes("mergedActivationActions"), true);
  assert.equal(source.includes("actions: mergedActivationActions"), true);
  assert.equal(source.includes('source: "activation_sent"'), true);
});

test("server never forwards raw action chip text to the auto reply sender", () => {
  const chipSendPattern = /sendAutoReply[\s\S]{0,220}messageContent/;
  assert.equal(chipSendPattern.test(source), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/server-flow-action-chips-boundary.test.js
```

Expected: FAIL because the server does not yet reference `visibleActivationContent`.

- [ ] **Step 3: Write minimal implementation**

In `src/server.js`, import:

```js
import { mergeInlineActions } from "./action-chips.js";
```

In `processFlowActivationTask`, before sending the activation text, compute:

```js
const activationMessage = task.messages?.[task.messageIndex] || {};
const mergedActivation = mergeInlineActions({
  content: activationMessage.content || task.messageContent || "",
  actions: activationMessage.actionsAfterSend || []
});
const visibleActivationContent = mergedActivation.content;
const mergedActivationActions = mergedActivation.actions;
```

Replace the text send call so it only runs when there is visible content:

```js
let worktoolMessageIds = [];
if (visibleActivationContent) {
  const sendResult = await sendAutoReply({
    botId: task.botId,
    binding,
    conversationKey: task.conversationKey,
    content: visibleActivationContent,
    source: "flow_activation"
  });
  worktoolMessageIds = sendResult.worktoolMessageIds || [];
}
```

After `finalizeFlowActivationTaskDelivery`, execute:

```js
if (!sentTask.wasCanceled) {
  await executeFlowActions({
    source: "activation_sent",
    botId: task.botId,
    binding,
    conversationKey: task.conversationKey,
    nodeId: task.nodeId,
    activationTaskId: String(task.id),
    actions: mergedActivationActions
  });
}
```

Keep existing next-activation scheduling unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/server-flow-action-chips-boundary.test.js tests/server-flow-actions-boundary.test.js tests/server-activation-worker-boundary.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server.js tests/server-flow-action-chips-boundary.test.js
git commit -m "Strip action chips before activation sends"
```

---

## Task 4: Console Right-Side Action Toolbox

**Files:**
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Test: `tests/console-action-toolbox-boundary.test.js`

**Interfaces:**
- Produces browser helpers: `serializeActionChipForEditor(action)`, `insertActionIntoFocusedTarget(action)`, `openActionToolbox()`, `closeActionToolbox()`
- Consumes existing `addNodeAction(nodeIndex)` and activation textarea update path

- [ ] **Step 1: Write the failing test**

Create `tests/console-action-toolbox-boundary.test.js`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("console exposes a fixed universal action toolbox", () => {
  assert.equal(app.includes("actionToolbox"), true);
  assert.equal(app.includes("openActionToolbox"), true);
  assert.equal(app.includes("insertActionIntoFocusedTarget"), true);
  assert.equal(app.includes("邀请进群"), true);
  assert.equal(css.includes(".action-toolbox"), true);
  assert.equal(css.includes("position: fixed"), true);
});

test("toolbox can target node completion or activation textareas", () => {
  assert.equal(app.includes("focusedActionTarget"), true);
  assert.equal(app.includes('kind: "node_complete"'), true);
  assert.equal(app.includes('kind: "activation_message"'), true);
  assert.equal(app.includes("data-action-target-node"), true);
  assert.equal(app.includes("data-action-target-activation"), true);
});

test("activation toolbox insertion uses a textual action chip", () => {
  assert.equal(app.includes("serializeActionChipForEditor"), true);
  assert.equal(app.includes("[动作：拉入 "), true);
  assert.equal(app.includes("setRangeText"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/console-action-toolbox-boundary.test.js
```

Expected: FAIL because toolbox helpers and CSS do not exist yet.

- [ ] **Step 3: Write minimal implementation**

In `public/console/app.js`, add state:

```js
let focusedActionTarget = null;
let actionToolboxOpen = false;
```

Add browser helper:

```js
function serializeActionChipForEditor(action = {}) {
  const groupName = String(action.groupName || "").trim();
  if (!groupName || action.type !== "invite_to_group") return "";
  return `[动作：拉入 ${groupName}]`;
}
```

Render toolbox HTML once in the console shell:

```js
function renderActionToolbox() {
  return `
    <aside class="action-toolbox ${actionToolboxOpen ? "is-open" : ""}" aria-label="动作工具箱">
      <button class="action-toolbox-toggle" data-action-toolbox-toggle type="button" title="动作工具箱" aria-label="动作工具箱">
        ${icon("wrench")}
      </button>
      <div class="action-toolbox-panel">
        <strong>动作工具箱</strong>
        <button class="secondary action-toolbox-item" data-action-tool="invite_to_group" type="button">
          ${icon("user-plus")}邀请进群
        </button>
        <label class="action-toolbox-field">
          <span>群名</span>
          <input data-action-toolbox-group-name placeholder="例如 直播课学习群" />
        </label>
        <label class="toggle action-toolbox-history">
          <input data-action-toolbox-show-history type="checkbox" checked />
          <span>带聊天记录</span>
        </label>
        <button class="primary" data-action-toolbox-insert type="button">${icon("plus")}插入动作</button>
      </div>
    </aside>
  `;
}
```

Add insertion:

```js
function insertActionIntoFocusedTarget(action) {
  if (!focusedActionTarget) {
    toast("请先点击一个任务动作区域或激活话术输入框");
    return;
  }
  if (focusedActionTarget.kind === "node_complete") {
    const node = flowDraftNodes[focusedActionTarget.nodeIndex];
    if (!node) return;
    const actions = normalizeFlowActionDrafts(node.actionsOnComplete || []);
    actions.push({ ...action, id: nextFlowActionId(actions) });
    node.actionsOnComplete = actions;
    renderFlowNodeEditor(els.flowMachineForm.entryNodeId.value);
    syncFlowJsonTextarea();
    return;
  }
  if (focusedActionTarget.kind === "activation_message") {
    const textarea = els.flowNodeList.querySelector(
      `[data-flow-node-index="${focusedActionTarget.nodeIndex}"] [data-activation-message-index="${focusedActionTarget.messageIndex}"][data-activation-message-content]`
    );
    if (!textarea) return;
    const chip = serializeActionChipForEditor(action);
    textarea.setRangeText(chip, textarea.selectionStart, textarea.selectionEnd, "end");
    updateDraftNodeActivationMessage(textarea);
    syncFlowJsonTextarea();
  }
}
```

Add target markers:

```html
<section class="flow-action-section" data-action-target-node="${index}" aria-label="节点完成动作">
```

and on activation textareas:

```html
<textarea data-action-target-activation="${index}:${messageIndex}" ...></textarea>
```

Add event listeners in `renderFlowNodeEditor`:

```js
els.flowNodeList.querySelectorAll("[data-action-target-node]").forEach((target) => {
  target.addEventListener("focusin", () => {
    focusedActionTarget = { kind: "node_complete", nodeIndex: Number(target.dataset.actionTargetNode) };
  });
  target.addEventListener("click", () => {
    focusedActionTarget = { kind: "node_complete", nodeIndex: Number(target.dataset.actionTargetNode) };
  });
});
els.flowNodeList.querySelectorAll("[data-action-target-activation]").forEach((input) => {
  input.addEventListener("focus", () => {
    const [nodeIndex, messageIndex] = input.dataset.actionTargetActivation.split(":").map(Number);
    focusedActionTarget = { kind: "activation_message", nodeIndex, messageIndex };
  });
});
```

Add CSS:

```css
.action-toolbox {
  position: fixed;
  right: 18px;
  top: 50%;
  z-index: 30;
  transform: translateY(-50%);
}

.action-toolbox-toggle {
  width: 46px;
  height: 46px;
  border-radius: 999px;
}

.action-toolbox-panel {
  display: none;
  width: 260px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 18px 44px rgba(30, 34, 90, 0.18);
}

.action-toolbox.is-open .action-toolbox-panel {
  display: grid;
  gap: 10px;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/console-action-toolbox-boundary.test.js tests/console-flow-actions-boundary.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/console/app.js public/console/styles.css tests/console-action-toolbox-boundary.test.js
git commit -m "Add universal action toolbox UI"
```

---

## Task 5: Console Save/Load Chip Transform

**Files:**
- Modify: `public/console/app.js`
- Test: `tests/console-action-toolbox-boundary.test.js`

**Interfaces:**
- Produces browser helpers: `extractActionChipsFromEditorText(text)`, `stripActionChipsFromEditorText(text)`, `formatActivationMessageForEditor(message)`
- Ensures `buildFlowConfigFromEditor()` strips chips from `content` and stores actions in `actionsAfterSend`
- Ensures `setFlowEditorFromConfig()` renders existing `actionsAfterSend` as visible chips in activation textareas

- [ ] **Step 1: Add failing assertions to the console toolbox test**

Append to `tests/console-action-toolbox-boundary.test.js`:

```js
test("console transforms activation chip text into structured actions on save", () => {
  assert.equal(app.includes("extractActionChipsFromEditorText"), true);
  assert.equal(app.includes("stripActionChipsFromEditorText"), true);
  assert.equal(app.includes("formatActivationMessageForEditor"), true);
  assert.equal(app.includes("actionsAfterSend: normalizeFlowActionDrafts"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/console-action-toolbox-boundary.test.js
```

Expected: FAIL because the transform helpers do not exist yet.

- [ ] **Step 3: Write minimal implementation**

In `public/console/app.js`, add:

```js
const actionChipPattern = /\[动作：拉入\s+([^\]\n\r]+?)\]/g;

function extractActionChipsFromEditorText(text = "") {
  const actions = [];
  let match;
  while ((match = actionChipPattern.exec(String(text || "")))) {
    const groupName = String(match[1] || "").trim();
    if (!groupName) continue;
    actions.push({
      id: `action_${actions.length + 1}`,
      type: "invite_to_group",
      groupName,
      target: "current_contact",
      showMessageHistory: true,
      runOnce: true
    });
  }
  return actions;
}

function stripActionChipsFromEditorText(text = "") {
  return String(text || "")
    .replace(actionChipPattern, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([。！？!?，,；;：:])/g, "$1")
    .trim();
}

function formatActivationMessageForEditor(message = {}) {
  const actions = normalizeFlowActionDrafts(message.actionsAfterSend || []);
  const chips = actions.map((action) => serializeActionChipForEditor(action)).filter(Boolean);
  return [String(message.content || ""), ...chips].filter(Boolean).join(" ");
}
```

Update `normalizeActivationMessageDraft`:

```js
function normalizeActivationMessageDraft(value = {}, defaults = defaultActivationMessage()) {
  const source = typeof value === "string" ? { content: value } : value || {};
  const inlineActions = extractActionChipsFromEditorText(source.content || "");
  const actionsAfterSend = normalizeFlowActionDrafts([...(source.actionsAfterSend || []), ...inlineActions]);
  return {
    content: stripActionChipsFromEditorText(source.content || ""),
    intervalMinutes: Math.max(1, Number(source.intervalMinutes ?? defaults.intervalMinutes)),
    maxTimes: Math.max(1, Number(source.maxTimes ?? defaults.maxTimes)),
    ...(actionsAfterSend.length ? { actionsAfterSend } : {})
  };
}
```

Update the activation textarea render value:

```js
${escapeHtml(formatActivationMessageForEditor(activationMessage))}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/console-action-toolbox-boundary.test.js tests/console-activation-boundary.test.js tests/console-flow-actions-boundary.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/console/app.js tests/console-action-toolbox-boundary.test.js
git commit -m "Transform console action chips on save"
```

---

## Task 6: Final Verification

**Files:**
- No new files

**Interfaces:**
- Verifies all new and existing action, activation, and console behavior

- [ ] **Step 1: Run targeted tests**

Run:

```bash
node --test \
  tests/action-chips.test.js \
  tests/db-flow-action-chips.test.js \
  tests/server-flow-action-chips-boundary.test.js \
  tests/console-action-toolbox-boundary.test.js \
  tests/worktool-group-invite.test.js \
  tests/db-flow-action-executions.test.js \
  tests/server-flow-actions-boundary.test.js \
  tests/console-flow-actions-boundary.test.js \
  tests/console-activation-boundary.test.js \
  tests/server-activation-worker-boundary.test.js
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Check git diff excludes unrelated dirty files**

Run:

```bash
git status --short
```

Expected: only pre-existing unrelated dirty files remain, or no dirty files from this feature.

- [ ] **Step 4: Push**

Run:

```bash
git push origin main
```

Expected: `main -> main`.
