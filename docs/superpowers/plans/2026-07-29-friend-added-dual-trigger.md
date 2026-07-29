# 新好友双触发识别修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让企微系统欢迎语和 WorkTool `textType=22,type=105` 事件都能可靠触发同一套新好友流程，并在 30 秒内吸收重复信号。

**Architecture:** 新建纯函数模块 `src/friend-added-signals.js`，统一识别、规范化两类新增好友信号并判断持久时间窗口是否重复。技术信号时间持久化在 `conversations.last_friend_added_signal_at`，不依赖任务状态机；`src/server.js` 只负责把规范化信号接入现有 `handleFriendAddedEvent`，继续复用已有会话重入、日期标签和入口激活事务。

**Tech Stack:** Node.js ESM、Express、SQLite `DatabaseSync`、Node 内置测试运行器 `node:test`

## Global Constraints

- 系统欢迎语和 `textType=22,type=105` 任一信号都必须能触发新好友流程。
- 默认信号去重窗口为 30 秒，并与 `FRIEND_ADDED_REENTRY_COOLDOWN_MINUTES` 分离。
- 新增好友信号不调用 Agent，不即时发送欢迎语。
- WorkTool 事件必须使用 `friendName` 建立 `roomType=2` 的私聊会话。
- 原始回调必须继续写入 `incoming_messages`。
- 普通私聊首次消息和老客户识别行为不得改变。
- 不覆盖或回退工作区中与本修复无关的并发改动。

---

### Task 1: 新好友信号归一化与去重纯函数

**Files:**
- Create: `src/friend-added-signals.js`
- Create: `tests/friend-added-signals.test.js`
- Modify: `src/message-rules.js`
- Modify: `tests/message-rules.test.js`

**Interfaces:**
- Produces: `resolveFriendAddedSignal(message) -> null | { trigger, friendName, message }`
- Produces: `isFriendAddedSignalDuplicate({ lastFriendAddedAt, occurredAt, dedupeMs }) -> boolean`
- Produces: `DEFAULT_FRIEND_ADDED_SIGNAL_DEDUPE_MS = 30000`
- Keeps: `isSystemFriendGreeting(message) -> boolean`

- [ ] **Step 1: Write failing signal recognition tests**

Create `tests/friend-added-signals.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FRIEND_ADDED_SIGNAL_DEDUPE_MS,
  isFriendAddedSignalDuplicate,
  resolveFriendAddedSignal
} from "../src/friend-added-signals.js";

test("normalizes a WorkTool type 105 friend event into a private contact signal", () => {
  assert.deepEqual(
    resolveFriendAddedSignal({
      textType: 22,
      type: 105,
      friendName: "  知行合一  ",
      friendRemark: "",
      messageId: "friend-1"
    }),
    {
      trigger: "worktool_friend_event",
      friendName: "知行合一",
      message: {
        textType: 22,
        type: 105,
        friendName: "  知行合一  ",
        friendRemark: "",
        messageId: "friend-1",
        roomType: 2,
        receivedName: "知行合一",
        groupName: ""
      }
    }
  );
});

test("keeps the canonical system greeting as the primary private signal", () => {
  const message = {
    roomType: 2,
    textType: 1,
    receivedName: "易天缘",
    spoken: "我已经添加了你，现在我们可以开始聊天了。"
  };
  assert.deepEqual(resolveFriendAddedSignal(message), {
    trigger: "system_greeting",
    friendName: "易天缘",
    message
  });
});

test("rejects invalid friend events and missing friend names", () => {
  assert.equal(resolveFriendAddedSignal({ textType: 22, type: 999, friendName: "客户" }), null);
  assert.equal(resolveFriendAddedSignal({ textType: 22, type: 105, friendName: "  " }), null);
});

test("deduplicates signals inside the persisted 30 second window", () => {
  assert.equal(DEFAULT_FRIEND_ADDED_SIGNAL_DEDUPE_MS, 30_000);
  assert.equal(isFriendAddedSignalDuplicate({
    lastFriendAddedAt: "2026-07-29T09:45:00.000Z",
    occurredAt: "2026-07-29T09:45:29.999Z",
    dedupeMs: DEFAULT_FRIEND_ADDED_SIGNAL_DEDUPE_MS
  }), true);
  assert.equal(isFriendAddedSignalDuplicate({
    lastFriendAddedAt: "2026-07-29T09:45:00.000Z",
    occurredAt: "2026-07-29T09:45:30.000Z",
    dedupeMs: DEFAULT_FRIEND_ADDED_SIGNAL_DEDUPE_MS
  }), false);
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
node --test tests/friend-added-signals.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/friend-added-signals.js`.

- [ ] **Step 3: Implement the minimal pure module**

Create `src/friend-added-signals.js`:

```js
import { isSystemFriendGreeting } from "./message-rules.js";

export const DEFAULT_FRIEND_ADDED_SIGNAL_DEDUPE_MS = 30_000;

export function resolveFriendAddedSignal(message = {}) {
  if (isSystemFriendGreeting(message)) {
    const friendName = String(message.receivedName || message.groupName || "").trim();
    return friendName
      ? { trigger: "system_greeting", friendName, message }
      : null;
  }
  if (Number(message.textType) !== 22 || Number(message.type) !== 105) return null;
  const friendName = String(message.friendName || "").trim();
  if (!friendName) return null;
  return {
    trigger: "worktool_friend_event",
    friendName,
    message: {
      ...message,
      roomType: 2,
      receivedName: friendName,
      groupName: ""
    }
  };
}

export function isFriendAddedSignalDuplicate({
  lastFriendAddedAt,
  occurredAt,
  dedupeMs = DEFAULT_FRIEND_ADDED_SIGNAL_DEDUPE_MS
}) {
  const previous = Date.parse(String(lastFriendAddedAt || ""));
  const current = Date.parse(String(occurredAt || ""));
  const windowMs = Math.max(1, Number(dedupeMs) || DEFAULT_FRIEND_ADDED_SIGNAL_DEDUPE_MS);
  return Number.isFinite(previous)
    && Number.isFinite(current)
    && current >= previous
    && current - previous < windowMs;
}
```

Keep `isSystemFriendGreeting` in `src/message-rules.js`. Replace the test that says WorkTool friend events are intentionally ignored with a neutral assertion that these non-text events are not ordinary Agent messages; signal recognition now belongs to the new module.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
node --test tests/friend-added-signals.test.js tests/message-rules.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit the pure signal layer**

```bash
git add src/friend-added-signals.js src/message-rules.js tests/friend-added-signals.test.js tests/message-rules.test.js
git commit -m "fix: recognize both new friend signals"
```

---

### Task 2: 接入回调入口并持久去重

**Files:**
- Modify: `src/server.js`
- Modify: `tests/server-friend-added-activation-boundary.test.js`
- Modify: `tests/server-inbound-coalescing-boundary.test.js`
- Test: `tests/db-friend-added-reentry.test.js`

**Interfaces:**
- Consumes: `resolveFriendAddedSignal(message)`
- Consumes: `isFriendAddedSignalDuplicate({ lastFriendAddedAt, occurredAt, dedupeMs })`
- Consumes: existing `getFlowSessionForBot({ botId, conversationKey })`
- Keeps: existing `handleFriendAddedEvent` as the single business entry

- [ ] **Step 1: Write failing server boundary tests**

Update `tests/server-friend-added-activation-boundary.test.js` to require:

```js
test("both normalized friend signals enter the same handler before ordinary message filtering", () => {
  assert.equal(source.includes("resolveFriendAddedSignal(message)"), true);
  assert.equal(source.includes("friendAddedSignal.message"), true);
  assert.equal(source.includes("friendAddedSignal.trigger"), true);
  assert.equal(
    source.indexOf("resolveFriendAddedSignal(message)")
      < source.indexOf("shouldProcessInboundForAgent(message)"),
    true
  );
});

test("friend-added signal dedupe is independent from business reentry cooldown", () => {
  assert.match(source, /FRIEND_ADDED_SIGNAL_DEDUPE_SECONDS \|\| 30/);
  assert.equal(source.includes("isFriendAddedSignalDuplicate"), true);
  assert.match(source, /reason: "friend_added_signal_duplicate"/);
  assert.match(source, /reason: "friend_added_cooldown"/);
});
```

Update `tests/server-inbound-coalescing-boundary.test.js` so it asserts normalized friend signals finish before `inboundCoalescer.push(...)` and never invoke the Agent.

- [ ] **Step 2: Run server boundary tests and verify RED**

Run:

```bash
node --test tests/server-friend-added-activation-boundary.test.js tests/server-inbound-coalescing-boundary.test.js
```

Expected: FAIL because `resolveFriendAddedSignal` and `friend_added_signal_duplicate` are not wired into `src/server.js`.

- [ ] **Step 3: Wire normalized signals into intake and processing**

In `src/server.js`:

1. Import the three exports from `src/friend-added-signals.js`.
2. Add:

```js
const configuredFriendAddedSignalDedupeSeconds = Number(
  process.env.FRIEND_ADDED_SIGNAL_DEDUPE_SECONDS || 30
);
const friendAddedSignalDedupeMs = Number.isFinite(configuredFriendAddedSignalDedupeSeconds)
  && configuredFriendAddedSignalDedupeSeconds > 0
  ? Math.max(1_000, configuredFriendAddedSignalDedupeSeconds * 1000)
  : DEFAULT_FRIEND_ADDED_SIGNAL_DEDUPE_MS;
```

3. In `ingestIncomingMessage`, resolve the signal before the conversation:

```js
const friendAddedSignal = resolveFriendAddedSignal(message);
const routingMessage = friendAddedSignal?.message || message;
const { conversationKey, group } = resolveInboundConversation({
  botId,
  message: routingMessage
});
```

Continue inserting the original `message` into `incoming_messages`, and return `friendAddedSignal` with the intake result.

4. At the start of `processIncomingMessage`, use `received.friendAddedSignal` and call:

```js
await handleFriendAddedEvent({
  botId,
  binding,
  message: friendAddedSignal.message,
  trigger: friendAddedSignal.trigger,
  logContext,
  conversationKey
});
finishMessageProcessing({ messageKey, status: "friend_added" });
return;
```

This branch must remain before reset preparation, ordinary persistence, `shouldProcessInboundForAgent`, coalescing and Agent invocation.

- [ ] **Step 4: Add persisted signal dedupe to the shared handler**

Change the handler signature to include `trigger`.

Before the existing business cooldown and before resetting an existing conversation:

```js
const existingSession = getFlowSessionForBot({ botId, conversationKey });
if (isFriendAddedSignalDuplicate({
  lastFriendAddedAt: existingSession?.lastFriendAddedAt,
  occurredAt: entryAnchorAt,
  dedupeMs: friendAddedSignalDedupeMs
})) {
  logInfo("friend_added.skipped", {
    ...logContext,
    friendName,
    conversationKey,
    trigger,
    reason: "friend_added_signal_duplicate",
    elapsedMs: Date.parse(entryAnchorAt) - Date.parse(existingSession.lastFriendAddedAt)
  });
  return "skipped";
}
```

Include `trigger` in `friend_added.received`, `friend_added.activation.scheduled` and all skip logs.

For `system_greeting`, keep `recordSystemFriendGreeting`. For `worktool_friend_event`, call `upsertConversation` without inserting an empty chat bubble:

```js
const conversation = trigger === "system_greeting"
  ? recordSystemFriendGreeting({ botId, binding, conversationKey, message })
  : upsertConversation({
      botId,
      agentId: binding?.agentId || "",
      conversationKey,
      message
    });
```

- [ ] **Step 5: Run focused server and database tests**

Run:

```bash
node --test \
  tests/friend-added-signals.test.js \
  tests/message-rules.test.js \
  tests/server-friend-added-activation-boundary.test.js \
  tests/server-inbound-coalescing-boundary.test.js \
  tests/db-friend-added-reentry.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit the callback integration**

```bash
git add src/server.js tests/server-friend-added-activation-boundary.test.js tests/server-inbound-coalescing-boundary.test.js tests/db-friend-added-reentry.test.js
git commit -m "fix: route WorkTool friend events into entry flow"
```

---

### Task 3: 配置说明、回归验证与发布

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `tests/docs-activation-boundary.test.js`

**Interfaces:**
- Documents: `FRIEND_ADDED_SIGNAL_DEDUPE_SECONDS=30`
- Preserves: `FRIEND_ADDED_REENTRY_COOLDOWN_MINUTES`

- [ ] **Step 1: Write failing documentation assertions**

Extend `tests/docs-activation-boundary.test.js`:

```js
test("documents dual new-friend signals and their independent dedupe window", () => {
  assert.equal(readme.includes("系统欢迎语"), true);
  assert.equal(readme.includes("textType=22"), true);
  assert.equal(readme.includes("type=105"), true);
  assert.equal(readme.includes("FRIEND_ADDED_SIGNAL_DEDUPE_SECONDS"), true);
  assert.equal(envExample.includes("FRIEND_ADDED_SIGNAL_DEDUPE_SECONDS=30"), true);
});
```

Read `.env.example` in the test alongside `README.md`.

- [ ] **Step 2: Run the documentation test and verify RED**

Run:

```bash
node --test tests/docs-activation-boundary.test.js
```

Expected: FAIL because the independent signal dedupe setting is not documented.

- [ ] **Step 3: Update configuration and README**

Add to `.env.example`:

```dotenv
FRIEND_ADDED_SIGNAL_DEDUPE_SECONDS=30
```

Update the README activation section to state:

- either the canonical system greeting or `textType=22,type=105` triggers entry;
- both signals share the same new-friend business handler;
- duplicate signals inside 30 seconds are absorbed;
- `FRIEND_ADDED_SIGNAL_DEDUPE_SECONDS` is independent from business reentry cooldown.

- [ ] **Step 4: Run the full verification suite**

Run:

```bash
npm test
```

Expected: all tests PASS with no failures.

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Commit documentation**

```bash
git add .env.example README.md tests/docs-activation-boundary.test.js
git commit -m "docs: explain new friend signal dedupe"
```

- [ ] **Step 6: Review the final diff without disturbing concurrent work**

Run:

```bash
git status --short
git log --oneline --max-count=6
```

Confirm only this plan's commits are selected for push. Leave unrelated modified and untracked files untouched.

- [ ] **Step 7: Push the verified main branch**

```bash
git push origin main
```

Expected: `main` fast-forwards successfully.

- [ ] **Step 8: Production smoke test**

After deployment, add one test customer and confirm:

```bash
docker logs --since 5m worktool-bot-service 2>&1 \
  | grep -E "friend_added|system_friend_greeting|worktool_friend_event"
```

Expected:

- one `friend_added.received`;
- one `friend_added.activation.scheduled`, or one explicit `entry_activation_not_configured`;
- if both signals arrive, the second signal logs `friend_added_signal_duplicate`;
- the control console shows the customer at the entry node without the “老客户” badge.
