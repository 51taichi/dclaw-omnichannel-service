# Group Automation Existing Conversation Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让群定时任务在执行时间复用该群现有的 DClaw 普通会话记忆，并修复同批多人发言被错误归属给最后一人的问题，同时彻底移除中台的群历史同步、账本和分段分析链路。

**Architecture:** 中台继续只把实际触发 Agent 的群消息写入该群稳定的普通 DClaw 会话；每次日常群回复请求都携带逐条、带中台消息 ID 的多人发言结构。群任务到点后在同一 `external_user_id` / `external_session_id` 中发送内部任务事件，由 Agent 一次完成条件判断或周期汇总；中台严格校验结果、核验本地证据 ID，并复用现有 occurrence 与安全发送状态机。DClaw 服务端不做任何修改，也不新增历史读取或写入接口。

**Tech Stack:** Node.js ESM、内置 `node:test`、SQLite、中台现有 HTTP/SSE DClaw 客户端、现有上游 WorkTool 回调与发送接口。

## Global Constraints

- 只修改 `/Users/moxi/Desktop/codex space/agent create/worktool-bot-service`，禁止修改 `/Users/moxi/Desktop/codex space/dclaw-server`。
- 只在 `main` 分支开发；每个任务通过聚焦测试后独立提交，并立即执行 `git push origin main`。
- 提交前使用 `git status --short` 核对范围；只暂存本计划列出的文件，不暂存当前工作区中的群置顶及其他无关改动。
- “中台”指当前仓库及其服务；“上游 WorkTool”只指企微回调和消息发送上游，不把中台称为 WorkTool。
- 私聊行为、私聊任务状态机、私聊资产和私聊标签逻辑保持不变。
- 群任务不上传未触发 Agent 的群消息，不建设完整群历史备份，不使用 Agent Space，不使用账本或模板变量表。
- 日常群回复与群任务必须使用同一个 Bot、`conversationKey`、`conversationEpoch` 和 `purpose="conversation"`。
- Agent 每次 occurrence 最多三次总调用：首次调用加两次重试；禁止在外层格式重试中再次调用自带多次网络重试的包装器。
- 上游明确拒绝时使用相同冻结载荷最多发送三次；结果不明确时进入“发送待确认”，禁止自动重发。
- 所有调度和展示时间继续使用 `Asia/Shanghai`。

---

## File Structure

- `src/group-agent-turns.js`：把中台已持久化的单条或多人群消息转换为有界、可审计的逐条 Agent 发言结构与紧凑文本。
- `src/dclaw.js`：把逐条群发言放入日常请求；构建与日常群回复同会话身份的内部群任务请求。
- `src/group-automation-agent.js`：一次 occurrence 共用三次总调用预算，严格解析条件推送或周期汇总结果。
- `src/group-automation-worker.js`：到点才调用 Agent，核验证据，冻结内容与 `@` 名单，并驱动安全发送状态机。
- `src/db.js`：简化 occurrence 阶段、恢复旧的未完成 occurrence、验证证据消息归属、幂等删除废弃同步与 chunk 表。
- `src/server.js`：组装逐条群发言、接入新执行器、移除群历史同步 Worker 与能力探测。
- `README.md`、`.env.example`：只描述现有普通会话记忆方案，删除群历史接口、回填和同步配置。
- 删除 `src/dclaw-group-history.js`、`src/group-history-sync-worker.js`、`src/group-history-transcript.js` 及其专用测试。

---

### Task 1: Preserve Per-Message Speaker Identity in Normal Group Agent Calls

**Files:**
- Create: `src/group-agent-turns.js`
- Create: `tests/group-agent-turns.test.js`
- Modify: `src/server.js`
- Modify: `src/dclaw.js`
- Modify: `tests/dclaw-request-sanitization.test.js`
- Test: `tests/server-group-agent-context-boundary.test.js`

**Interfaces:**
- Consumes: coalescer item `{ conversationMessageId, conversationMessageCreatedAt, acceptedAt, message, groupReplyDecision }` and managed role `{ id, currentName, aliases, identityType, description, replyPolicy }`.
- Produces: `buildGroupAgentTurns({ items, roles }): GroupAgentTurn[]` and `formatGroupAgentTurns(turns): string`.
- `GroupAgentTurn` is `{ messageId: number, occurredAt: string, speakerName: string, roleId: string, identityType: string, roleDescription: string, content: string, realAtMe: boolean, effectiveReplyPolicy: string, triggerReason: string }`.
- Extends `buildDclawRequest({...})` with optional `groupTurns: GroupAgentTurn[]`; private requests ignore this argument.

- [ ] **Step 1: Write focused failing tests for single-message, multi-speaker and alias attribution**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildGroupAgentTurns, formatGroupAgentTurns } from "../src/group-agent-turns.js";

test("group turns preserve each speaker, persisted id, time and role", () => {
  const turns = buildGroupAgentTurns({
    roles: [
      { id: "r-a", currentName: "张三", aliases: ["张老师"], identityType: "客户", description: "客户负责人" },
      { id: "r-b", currentName: "李四", aliases: [], identityType: "同事", description: "交付老师" }
    ],
    items: [
      {
        conversationMessageId: 101,
        conversationMessageCreatedAt: "2026-08-05T14:30:01.000+08:00",
        message: { receivedName: "张老师", spoken: "第一句话" },
        groupReplyDecision: { originalAtMe: false, effectivePolicy: "always", reason: "role_always" }
      },
      {
        conversationMessageId: 102,
        conversationMessageCreatedAt: "2026-08-05T14:30:04.000+08:00",
        message: { receivedName: "李四", spoken: "第二句话" },
        groupReplyDecision: { originalAtMe: true, effectivePolicy: "mention_only", reason: "mentioned" }
      }
    ]
  });

  assert.deepEqual(turns.map(({ messageId, speakerName, roleId }) => ({ messageId, speakerName, roleId })), [
    { messageId: 101, speakerName: "张老师", roleId: "r-a" },
    { messageId: 102, speakerName: "李四", roleId: "r-b" }
  ]);
  assert.match(formatGroupAgentTurns(turns), /\[M101｜2026-08-05 14:30:01｜张老师｜客户负责人\]/u);
  assert.match(formatGroupAgentTurns(turns), /\[M102｜2026-08-05 14:30:04｜李四｜交付老师\]/u);
});
```

Add a second test asserting one group message uses the same array shape, and a third asserting invalid or missing local message IDs are rejected instead of silently replaced by an upstream ID.

- [ ] **Step 2: Run the new test and verify the module is missing**

Run: `node --test tests/group-agent-turns.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/group-agent-turns.js`.

- [ ] **Step 3: Implement bounded per-message turn construction**

```js
const MAX_GROUP_TURNS = 24;
const MAX_CONTENT_CHARS = 1200;

function roleForSpeaker(roles, speakerName) {
  return roles.find((role) =>
    role.currentName === speakerName || (Array.isArray(role.aliases) && role.aliases.includes(speakerName))
  ) || null;
}

export function buildGroupAgentTurns({ items = [], roles = [] } = {}) {
  return items.slice(-MAX_GROUP_TURNS).map((item) => {
    const messageId = Number(item.conversationMessageId);
    if (!Number.isSafeInteger(messageId) || messageId <= 0) {
      throw new Error("persisted group conversationMessageId is required");
    }
    const speakerName = String(item.message?.receivedName || "").trim();
    const role = roleForSpeaker(roles, speakerName);
    return {
      messageId,
      occurredAt: String(item.conversationMessageCreatedAt || item.acceptedAt || "").trim(),
      speakerName,
      roleId: String(role?.id || ""),
      identityType: String(role?.identityType || ""),
      roleDescription: String(role?.description || ""),
      content: String(item.message?.spoken || item.message?.rawSpoken || "").trim().slice(0, MAX_CONTENT_CHARS),
      realAtMe: item.groupReplyDecision?.originalAtMe === true,
      effectiveReplyPolicy: String(item.groupReplyDecision?.effectivePolicy || ""),
      triggerReason: String(item.groupReplyDecision?.reason || "")
    };
  });
}
```

`formatGroupAgentTurns()` must format `occurredAt` in `Asia/Shanghai`, use `M${messageId}` as the stable evidence token, and use `identityType` when `roleDescription` is empty. It must never invent a batch-level speaker.

- [ ] **Step 4: Verify the direct turn tests pass**

Run: `node --test tests/group-agent-turns.test.js`

Expected: PASS for single, multiple and alias cases.

- [ ] **Step 5: Add failing DClaw request tests for bounded structured turns**

Add to `tests/dclaw-request-sanitization.test.js`:

```js
test("normal group request keeps structured per-message attribution", () => {
  const binding = { botId: "bot_1", agentId: "agent_1" };
  const groupConversation = {
    conversationKey: "bot_1:group-id:group-1",
    conversationEpoch: "epoch-1"
  };
  const groupMessage = {
    messageId: "upstream-102",
    spoken: "路由文本",
    rawSpoken: "路由文本",
    roomType: 1,
    groupName: "学习群",
    receivedName: "B",
    atMe: "true"
  };
  const groupContext = {
    groupId: "group-1",
    background: "学习服务群",
    roles: [],
    replyDecision: { authorized: true, effectivePolicy: "always" }
  };
  const request = buildDclawRequest({
    binding,
    conversation: groupConversation,
    message: groupMessage,
    groupContext,
    groupTurns: [
      { messageId: 101, occurredAt: "2026-08-05T06:30:01.000Z", speakerName: "A", roleId: "r1", identityType: "客户", roleDescription: "负责人", content: "甲", realAtMe: false, effectiveReplyPolicy: "always", triggerReason: "role_always" },
      { messageId: 102, occurredAt: "2026-08-05T06:30:04.000Z", speakerName: "B", roleId: "r2", identityType: "同事", roleDescription: "老师", content: "乙", realAtMe: true, effectiveReplyPolicy: "mention_only", triggerReason: "mentioned" }
    ]
  });
  assert.match(request.message, /"groupTurns"/u);
  assert.match(request.message, /"messageId": 101/u);
  assert.match(request.message, /逐条消息.*唯一归属/u);
  assert.equal(request.metadata.groupTurns[0].speakerName, "A");
  assert.equal(request.metadata.groupTurns[1].speakerName, "B");
});
```

Also assert that private requests contain no `groupTurns`, and that oversized strings are truncated without dropping earlier speakers in the current batch.

- [ ] **Step 6: Run request tests and verify they fail before wiring**

Run: `node --test tests/dclaw-request-sanitization.test.js`

Expected: FAIL because `buildDclawRequest` does not yet serialize `groupTurns`.

- [ ] **Step 7: Wire group turns into normal requests without changing private behavior**

In `src/server.js`:

```js
const groupTurns = managedGroup
  ? buildGroupAgentTurns({ items: batch.items, roles: groupRoles })
  : [];
const coalescedMessage = managedGroup
  ? { ...buildCoalescedAgentMessage(messages), spoken: formatGroupAgentTurns(groupTurns) }
  : buildCoalescedAgentMessage(messages);

const request = buildDclawRequest({
  binding,
  conversation,
  message: normalizeMessageForAgent(coalescedMessage, binding, groupReplyDecision),
  groupContext,
  groupTurns,
  tagContext,
  tagEvidenceCandidates,
  conversationReset,
  generalRule
});
```

When pushing into the coalescer, add `conversationMessageCreatedAt: persisted.messageRecord?.createdAt || acceptedAt`. Keep each item’s existing `groupReplyDecision`; do not recompute all messages from the last speaker.

In `src/dclaw.js`, add a bounded `compactGroupTurns()` and include it in the full and reduced request payloads and metadata. Add explicit instructions that `groupTurns` owns author/time attribution, while top-level `userId` is routing only; messages with `eventType="group_automation"` are internal events and must never be treated as member statements.

- [ ] **Step 8: Add a server boundary test preventing regression to last-speaker-only batching**

In `tests/server-group-agent-context-boundary.test.js`, read `src/server.js` and assert it imports and calls both `buildGroupAgentTurns` and `formatGroupAgentTurns`, passes `groupTurns` to `buildDclawRequest`, and no longer builds group batch text solely as `` `${index + 1}. ${spoken}` ``.

- [ ] **Step 9: Run all attribution tests**

Run: `node --test tests/group-agent-turns.test.js tests/dclaw-request-sanitization.test.js tests/server-group-agent-context-boundary.test.js`

Expected: PASS.

- [ ] **Step 10: Commit and push only attribution files**

```bash
git status --short
git add src/group-agent-turns.js src/server.js src/dclaw.js tests/group-agent-turns.test.js tests/dclaw-request-sanitization.test.js tests/server-group-agent-context-boundary.test.js
git commit -m "fix: preserve group speaker attribution"
git push origin main
```

---

### Task 2: Build a Same-Session Group Automation Agent Contract

**Files:**
- Modify: `src/dclaw.js`
- Rewrite: `src/group-automation-agent.js`
- Rewrite: `tests/group-automation-agent.test.js`
- Create: `tests/dclaw-group-automation-session.test.js`

**Interfaces:**
- Consumes: `binding`, normal `conversation`, managed `group`, `roles`, frozen `task`, and `occurrence`.
- Produces: `buildDclawGroupAutomationRequest({ binding, conversation, group, roles, task, occurrence, repairError }): DclawRequest`.
- Produces: `executeGroupAutomationAgentTask({ binding, conversation, group, roles, task, occurrence, invokeAgent?, signal? }): Promise<ConditionalResult | SummaryResult>`.
- `ConditionalResult` is `{ taskType: "conditional_push", achieved: boolean, decisionNote: string, evidenceMessageIds: number[] }`.
- `SummaryResult` is `{ taskType: "periodic_summary", content: string, decisionNote: string, evidenceMessageIds: number[] }`.

- [ ] **Step 1: Write a failing same-session identity test**

```js
test("group automation reuses the normal group conversation identity", () => {
  const binding = { botId: "bot-1", agentId: "agent-1" };
  const conversation = {
    conversationKey: "bot-1:group-id:group-1",
    conversationEpoch: "epoch-1"
  };
  const group = { id: "group-1", currentName: "学习群", background: "课程服务群" };
  const roles = [];
  const message = {
    messageId: "upstream-101",
    spoken: "作业完成了",
    rawSpoken: "作业完成了",
    roomType: 1,
    groupName: "学习群",
    receivedName: "家长",
    atMe: "true"
  };
  const groupTurns = [{ messageId: 101, occurredAt: "2026-08-05T09:00:00.000+08:00", speakerName: "家长", roleId: "", identityType: "客户", roleDescription: "", content: "作业完成了", realAtMe: true, effectiveReplyPolicy: "always", triggerReason: "role_always" }];
  const groupContext = { groupId: "group-1", background: "课程服务群", roles: [], replyDecision: { authorized: true, effectivePolicy: "always" } };
  const conditionalTask = { id: "task-1", taskType: "conditional_push", conditionText: "今天已完成作业", content: "作业已完成" };
  const occurrence = { id: "occ-1", scheduledFor: "2026-08-05T10:00:00.000+08:00", cycleStartAt: "2026-08-05T00:00:00.000+08:00", cycleEndAt: "2026-08-06T00:00:00.000+08:00" };
  const live = buildDclawRequest({ binding, conversation, message, groupContext, groupTurns });
  const taskRequest = buildDclawGroupAutomationRequest({
    binding,
    conversation,
    group,
    roles,
    task: conditionalTask,
    occurrence
  });
  assert.equal(taskRequest.external_user_id, live.external_user_id);
  assert.equal(taskRequest.external_session_id, live.external_session_id);
  assert.equal(taskRequest.metadata.conversationId, live.metadata.conversationId);
  assert.match(taskRequest.message, /"eventType": "group_automation"/u);
  assert.doesNotMatch(taskRequest.message, /完整群历史|history transcript|group-history-analysis/iu);
});
```

Add a reset test showing that changing `conversationEpoch` changes both live and task session IDs together.

- [ ] **Step 2: Run the session test and verify the builder is missing**

Run: `node --test tests/dclaw-group-automation-session.test.js`

Expected: FAIL because `buildDclawGroupAutomationRequest` is not exported.

- [ ] **Step 3: Implement the internal task request builder with normal purpose**

```js
export function buildDclawGroupAutomationRequest({
  binding,
  conversation,
  group,
  roles = [],
  task,
  occurrence,
  repairError = ""
}) {
  const identity = buildDclawConversationIdentity({
    botId: binding.botId,
    conversationKey: conversation.conversationKey,
    conversationEpoch: conversation.conversationEpoch,
    purpose: "conversation"
  });
  const event = {
    eventType: "group_automation",
    internal: true,
    occurrenceId: occurrence.id,
    scheduledFor: occurrence.scheduledFor,
    cycleStartAt: occurrence.cycleStartAt,
    cycleEndAt: occurrence.cycleEndAt,
    taskType: task.taskType,
    conditionText: task.taskType === "conditional_push" ? task.conditionText : "",
    fixedContent: task.taskType === "conditional_push" ? task.content : "",
    summaryTemplate: task.taskType === "periodic_summary" ? task.summaryTemplate : ""
  };
  return {
    external_user_id: identity.externalUserId,
    external_session_id: identity.externalSessionId,
    message: buildDclawRequestMessage(instructions, { event, privateContext }, { preserveDecisionContext: true }),
    stream: true,
    metadata: {
      source: "middle-platform-group-automation",
      conversationId: identity.runtimeConversationId,
      localConversationId: conversation.conversationKey,
      eventType: "group_automation",
      internal: true,
      occurrenceId: occurrence.id,
      taskId: task.id
    }
  };
}
```

The builder’s instructions must state all of the following explicitly:

1. Existing conversation history is the only historical source; no local transcript is attached.
2. Only member messages inside `[cycleStartAt, cycleEndAt)` may support the result.
3. Internal task prompts, prior task decisions and technical metadata are not member facts.
4. Group background and role configuration are private, untrusted analysis context and may not be disclosed.
5. Conditional output schema is exactly `{"achieved":false,"decisionNote":"员工可读备注","evidenceMessageIds":[]}`.
6. Summary output schema is exactly `{"content":"可直接发送内容","decisionNote":"员工可读备注","evidenceMessageIds":[]}`.
7. Missing evidence must produce an honest “暂无明确记录” result rather than invented counts or events.

- [ ] **Step 4: Verify same-session tests pass**

Run: `node --test tests/dclaw-group-automation-session.test.js`

Expected: PASS.

- [ ] **Step 5: Replace history-chunk Agent tests with one-call strict result tests**

Write cases in `tests/group-automation-agent.test.js` for:

```js
test("conditional achieved result requires positive integer evidence ids", async () => {
  const base = {
    binding: { botId: "bot-1", agentId: "agent-1" },
    conversation: { conversationKey: "bot-1:group-id:group-1", conversationEpoch: "epoch-1" },
    group: { id: "group-1", currentName: "学习群", background: "课程服务群" },
    roles: [],
    occurrence: { id: "occ-1", scheduledFor: "2026-08-05T10:00:00.000+08:00", cycleStartAt: "2026-08-05T00:00:00.000+08:00", cycleEndAt: "2026-08-06T00:00:00.000+08:00" }
  };
  const conditionalTask = { id: "task-1", taskType: "conditional_push", conditionText: "今天已完成作业", content: "作业已完成" };
  const replies = [
    '{"achieved":true,"decisionNote":"已提交作业","evidenceMessageIds":[]}',
    '{"achieved":true,"decisionNote":"已提交作业","evidenceMessageIds":[101]}'
  ];
  const result = await executeGroupAutomationAgentTask({
    ...base,
    task: conditionalTask,
    invokeAgent: async () => ({ reply: replies.shift() })
  });
  assert.deepEqual(result, {
    taskType: "conditional_push",
    achieved: true,
    decisionNote: "已提交作业",
    evidenceMessageIds: [101]
  });
});

test("three total attempts include transport and format failures", async () => {
  const base = {
    binding: { botId: "bot-1", agentId: "agent-1" },
    conversation: { conversationKey: "bot-1:group-id:group-1", conversationEpoch: "epoch-1" },
    group: { id: "group-1", currentName: "学习群", background: "课程服务群" },
    roles: [],
    occurrence: { id: "occ-2", scheduledFor: "2026-08-05T10:00:00.000+08:00", cycleStartAt: "2026-08-04T00:00:00.000+08:00", cycleEndAt: "2026-08-11T00:00:00.000+08:00" }
  };
  const summaryTask = { id: "task-2", taskType: "periodic_summary", summaryTemplate: "本周完成情况" };
  let calls = 0;
  await assert.rejects(() => executeGroupAutomationAgentTask({
    ...base,
    task: summaryTask,
    invokeAgent: async () => {
      calls += 1;
      if (calls === 1) throw new Error("timeout");
      return { reply: "not-json" };
    }
  }));
  assert.equal(calls, 3);
});
```

Also test conditional false with no evidence, summary non-empty content, exact-key rejection, invalid evidence IDs, forbidden customer-visible disclosure, and repair requests retaining the same external session ID and occurrence ID.

- [ ] **Step 6: Run strict Agent tests and verify old chunk implementation fails**

Run: `node --test tests/group-automation-agent.test.js`

Expected: FAIL because the existing module exports chunk analysis and recursive merge functions rather than `executeGroupAutomationAgentTask`.

- [ ] **Step 7: Rewrite the Agent executor with one shared three-attempt budget**

```js
const MAX_AGENT_ATTEMPTS = 3;

export async function executeGroupAutomationAgentTask({
  binding,
  conversation,
  group,
  roles = [],
  task,
  occurrence,
  invokeAgent = ({ request }) => invokeDclawAgent({ binding, request }),
  signal
}) {
  let repairError = "";
  let lastError;
  for (let attempt = 1; attempt <= MAX_AGENT_ATTEMPTS; attempt += 1) {
    const request = buildDclawGroupAutomationRequest({
      binding, conversation, group, roles, task, occurrence, repairError
    });
    try {
      const response = await invokeAgent({ binding, request, signal, attempt });
      return parseGroupAutomationReply(replyText(response), task.taskType);
    } catch (error) {
      lastError = error;
      repairError = String(error?.message || "Agent 调用失败").slice(0, 500);
    }
  }
  throw lastError;
}
```

Import raw `invokeDclawAgent`, not `invokeDclawAgentWithRetry`, so transport failure and format repair share exactly three total calls. Parsers must enforce exact keys, booleans, bounded text, unique positive safe-integer evidence IDs, non-empty summary content, and the existing customer-visible confidentiality validator.

- [ ] **Step 8: Run Agent contract tests**

Run: `node --test tests/dclaw-group-automation-session.test.js tests/group-automation-agent.test.js`

Expected: PASS.

- [ ] **Step 9: Commit and push the Agent contract**

```bash
git status --short
git add src/dclaw.js src/group-automation-agent.js tests/dclaw-group-automation-session.test.js tests/group-automation-agent.test.js
git commit -m "refactor: run group tasks in existing agent session"
git push origin main
```

---

### Task 3: Simplify Occurrence Persistence and Validate Evidence Locally

**Files:**
- Modify: `src/db.js`
- Rewrite: `tests/db-group-automation.test.js`
- Create: `tests/db-group-automation-evidence.test.js`

**Interfaces:**
- Produces: `prepareGroupAutomationOccurrences({ now, horizonMs, limit }): Occurrence[]`, which creates/fixes occurrences in `waiting_target` without claiming an Agent lease.
- Produces: `claimDueGroupAutomationOccurrences({ now, leaseMs, limit }): Occurrence[]`, which atomically transitions due work to `evaluating`.
- Produces: `validateGroupAutomationEvidenceMessageIds({ botId, groupId, messageIds }): { validIds: number[], invalidIds: number[] }`.
- Produces: `finalizeObsoleteGroupHistoryRemoval(): void`, an idempotent middle-platform-only migration.

- [ ] **Step 1: Write failing occurrence lifecycle tests**

```js
test("preparing an occurrence does not run analysis before target time", () => {
  const [occurrence] = prepareGroupAutomationOccurrences({
    now: "2026-08-05T08:50:00.000Z",
    horizonMs: 10 * 60 * 1000,
    limit: 10
  });
  assert.equal(occurrence.stage, "waiting_target");
  assert.equal(occurrence.leaseOwner, "");
  assert.deepEqual(claimDueGroupAutomationOccurrences({
    now: "2026-08-05T08:59:59.000Z",
    leaseMs: 60_000,
    limit: 10
  }), []);
});

test("target claim moves one unique occurrence to evaluating", () => {
  const first = claimDueGroupAutomationOccurrences({ now: targetTime, leaseMs: 60_000, limit: 10 });
  const second = claimDueGroupAutomationOccurrences({ now: targetTime, leaseMs: 60_000, limit: 10 });
  assert.equal(first.length, 1);
  assert.equal(first[0].stage, "evaluating");
  assert.equal(second.length, 0);
});
```

Add recovery cases that map unfinished legacy `preanalysis`, `delta_analysis` and `finalizing` occurrences back to `waiting_target` while preserving `sending` and `awaiting_confirmation` rows.

- [ ] **Step 2: Run the lifecycle tests and verify current phased stages fail**

Run: `node --test tests/db-group-automation.test.js`

Expected: FAIL because the current database API claims `preanalysis` and `delta_analysis` work.

- [ ] **Step 3: Implement the minimal stage model and idempotent legacy recovery**

Use these nonterminal stages only:

```js
const GROUP_AUTOMATION_STAGE_TRANSITIONS = {
  waiting_target: new Set(["evaluating", "canceled"]),
  evaluating: new Set(["retry_wait", "send_pending", "skipped", "failed"]),
  retry_wait: new Set(["evaluating", "send_pending", "failed"]),
  send_pending: new Set(["sending", "failed"]),
  sending: new Set(["send_pending", "sent", "awaiting_confirmation", "failed"]),
  awaiting_confirmation: new Set(["send_pending", "sent", "failed"])
};
```

At database startup, unfinished legacy analysis stages must be reset in one transaction:

```sql
UPDATE managed_group_automation_occurrences
SET stage = 'waiting_target',
    lease_owner = '',
    lease_until = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE stage IN ('preanalysis_pending', 'preanalysis', 'delta_analysis', 'finalizing');
```

Do not rebuild the occurrence table solely to remove harmless legacy columns; stop reading and writing them instead. Preserve the existing unique `(task_id, scheduled_for)` constraint.

- [ ] **Step 4: Verify lifecycle tests pass**

Run: `node --test tests/db-group-automation.test.js`

Expected: PASS.

- [ ] **Step 5: Write failing evidence ownership tests**

```js
test("evidence validator accepts only messages from the task group", () => {
  const result = validateGroupAutomationEvidenceMessageIds({
    botId: "bot-1",
    groupId: groupA.id,
    messageIds: [messageA.id, messageB.id, 999999]
  });
  assert.deepEqual(result.validIds, [messageA.id]);
  assert.deepEqual(result.invalidIds, [messageB.id, 999999]);
});
```

Add cases for duplicate IDs, non-integers, messages from another Bot, and an empty array.

- [ ] **Step 6: Run evidence tests and verify the helper is missing**

Run: `node --test tests/db-group-automation-evidence.test.js`

Expected: FAIL because `validateGroupAutomationEvidenceMessageIds` is not exported.

- [ ] **Step 7: Implement evidence validation through the group conversation key**

```js
export function validateGroupAutomationEvidenceMessageIds({ botId, groupId, messageIds }) {
  const requested = [...new Set(messageIds.map(Number).filter(
    (id) => Number.isSafeInteger(id) && id > 0
  ))];
  const group = getManagedGroup({ botId, groupId });
  const rows = requested.length && group
    ? db.prepare(`
        SELECT id FROM conversation_messages
        WHERE bot_id = ? AND conversation_key = ?
          AND id IN (${requested.map(() => "?").join(",")})
      `).all(botId, group.conversationKey, ...requested)
    : [];
  const validSet = new Set(rows.map((row) => Number(row.id)));
  return {
    validIds: requested.filter((id) => validSet.has(id)),
    invalidIds: requested.filter((id) => !validSet.has(id))
  };
}
```

Use the repository’s actual prepared-statement wrapper and managed-group lookup names when integrating, while preserving the exact exported signature and return shape above.

- [ ] **Step 8: Add and test the obsolete-table cleanup migration**

`finalizeObsoleteGroupHistoryRemoval()` must execute:

```sql
DROP TABLE IF EXISTS managed_group_history_sync_states;
DROP TABLE IF EXISTS managed_group_automation_chunks;
```

Call it twice in the test and assert both calls succeed while `managed_group_automation_tasks`, `managed_group_automation_occurrences`, `managed_group_automation_attempts` and `conversation_messages` remain queryable.

In the same change, delete the `managed_group_history_sync_states` and `managed_group_automation_chunks` schema creation blocks and all exported helpers that read, lease, write, clean or finalize those tables. The removed APIs include `saveGroupAutomationChunkCheckpoint`, `getGroupAutomationChunkCheckpoint`, `cleanupGroupAutomationChunkCheckpoints`, `getGroupHistorySyncState` and every `claim/renew/complete/fail/enqueue` group-history-sync function. No replacement API is created because the new executor never reads or uploads a full transcript.

Run: `node --test tests/db-group-automation.test.js tests/db-group-automation-evidence.test.js`

Expected: PASS.

- [ ] **Step 9: Commit and push persistence changes**

```bash
git status --short
git add src/db.js tests/db-group-automation.test.js tests/db-group-automation-evidence.test.js
git commit -m "refactor: simplify group automation occurrences"
git push origin main
```

---

### Task 4: Execute Group Tasks at Target Time and Reuse Safe Sending

**Files:**
- Rewrite: `src/group-automation-worker.js`
- Rewrite: `tests/group-automation-worker.test.js`
- Modify: `tests/group-automation-send-safety.test.js`

**Interfaces:**
- Consumes: Task 2 `executeGroupAutomationAgentTask(...)` and Task 3 occurrence/evidence database functions.
- Produces: `createGroupAutomationWorker({ db, executeAgentTask, sendGroupMessage, now?, workerId? })` with `start()`, `stop()`, `tick()` and `wake()`.
- Conditional success freezes the configured fixed `content` and resolves the snapshot’s `mentionRoleIds` against the frozen role list to produce `atList`; summary success freezes Agent `content` and the same resolved `atList`.

- [ ] **Step 1: Replace history-analysis worker tests with target-time behavior tests**

```js
test("conditional task invokes Agent only at target and sends frozen configured content", async () => {
  const calls = [];
  let sent = null;
  const task = {
    id: "task-1",
    taskType: "conditional_push",
    content: "今天的作业已完成，辛苦啦！",
    mentionRoleIds: ["role-parent", "role-teacher"],
    scheduledFor: targetTime
  };
  db.seedDueOccurrence({
    id: "occ-1",
    taskSnapshot: task,
    scheduledFor: targetTime,
    stage: "waiting_target"
  });
  const worker = createGroupAutomationWorker({
    db,
    now: () => targetTime,
    executeAgentTask: async (input) => {
      calls.push(input);
      return { taskType: "conditional_push", achieved: true, decisionNote: "已完成", evidenceMessageIds: [101] };
    },
    sendGroupMessage: async (payload) => {
      sent = { accepted: true, upstreamMessageId: "up-1", payload };
      return sent;
    }
  });
  await worker.tick();
  assert.equal(calls.length, 1);
  assert.equal(sent.payload.content, task.content);
  assert.deepEqual(sent.payload.atList, ["家长", "授课老师"]);
});

test("conditional false is a normal not-sent result", async () => {
  const sendCalls = [];
  const worker = createGroupAutomationWorker({
    db,
    now: () => targetTime,
    executeAgentTask: async () => ({ taskType: "conditional_push", achieved: false, decisionNote: "本周期没有明确提交记录", evidenceMessageIds: [] }),
    sendGroupMessage: async (payload) => { sendCalls.push(payload); return { accepted: true }; }
  });
  await worker.tick();
  assert.equal(sendCalls.length, 0);
  assert.equal(loadOccurrence().stage, "skipped");
});
```

Add cases for periodic summary content, invalid evidence, three exhausted Agent attempts, frozen role mentions, duplicate tick, restart recovery, and reset conversation epoch passed to Agent.

- [ ] **Step 2: Run worker tests and verify the old history dependencies fail**

Run: `node --test tests/group-automation-worker.test.js`

Expected: FAIL because the current worker requires history sync, transcript chunks and recursive finalizers.

- [ ] **Step 3: Rewrite worker evaluation around one due occurrence**

```js
async function evaluateOccurrence(occurrence) {
  const context = db.loadGroupAutomationExecutionContext(occurrence.id);
  const result = await executeAgentTask({
    binding: context.binding,
    conversation: context.conversation,
    group: context.group,
    roles: context.roles,
    task: context.taskSnapshot,
    occurrence
  });
  const evidence = db.validateGroupAutomationEvidenceMessageIds({
    botId: context.group.botId,
    groupId: context.group.id,
    messageIds: result.evidenceMessageIds
  });
  if (evidence.invalidIds.length || (result.achieved === true && !evidence.validIds.length)) {
    throw new Error("Agent returned evidence outside the current group conversation");
  }
  if (result.taskType === "conditional_push" && !result.achieved) {
    return db.completeGroupAutomationOccurrence({
      occurrenceId: occurrence.id,
      stage: "skipped",
      decisionNote: result.decisionNote,
      evidenceMessageIds: evidence.validIds
    });
  }
  const content = result.taskType === "conditional_push"
    ? context.taskSnapshot.content
    : result.content;
  const rolesById = new Map(context.roles.map((role) => [String(role.id), role]));
  const atList = [...new Set((context.taskSnapshot.mentionRoleIds || [])
    .map((roleId) => rolesById.get(String(roleId))?.currentName)
    .filter(Boolean))];
  return db.freezeGroupAutomationDelivery({
    occurrenceId: occurrence.id,
    content,
    atList,
    decisionNote: result.decisionNote,
    evidenceMessageIds: evidence.validIds
  });
}
```

The worker must never read `conversation_messages` into a transcript and must never call a history-sync dependency. A technical Agent failure records `failed`; conditional false records `skipped`; valid content proceeds to the existing `send_pending` delivery logic.

- [ ] **Step 4: Preserve and retest explicit/ambiguous send semantics**

Keep the existing frozen payload and idempotency key behavior. Tests must assert:

```js
assert.equal(explicitRejectSendCalls, 3);
assert.equal(loadOccurrence().stage, "failed");
assert.equal(ambiguousSendCalls, 1);
assert.equal(loadOccurrence().stage, "awaiting_confirmation");
```

Run: `node --test tests/group-automation-worker.test.js tests/group-automation-send-safety.test.js`

Expected: PASS.

- [ ] **Step 5: Run existing schedule and occurrence regressions**

Run: `node --test tests/group-automation-schedule.test.js tests/group-automation-next-run.test.js tests/db-group-automation.test.js`

Expected: PASS; daily/weekly/monthly/月底 calculations remain unchanged.

- [ ] **Step 6: Commit and push the direct executor**

```bash
git status --short
git add src/group-automation-worker.js tests/group-automation-worker.test.js tests/group-automation-send-safety.test.js
git commit -m "refactor: execute group tasks from conversation memory"
git push origin main
```

---

### Task 5: Replace Server Wiring and Remove Full-History Runtime

**Files:**
- Modify: `src/server.js`
- Modify: `tests/server-group-automation-boundary.test.js`
- Delete: `src/dclaw-group-history.js`
- Delete: `src/group-history-sync-worker.js`
- Delete: `src/group-history-transcript.js`
- Delete: `tests/dclaw-group-history.test.js`
- Delete: `tests/db-group-history-sync.test.js`
- Delete: `tests/group-history-sync-worker.test.js`
- Delete: `tests/group-history-transcript.test.js`
- Delete: `tests/group-automation-long-history.test.js`

**Interfaces:**
- Consumes: Task 2 `executeGroupAutomationAgentTask`, Task 3 cleanup migration, Task 4 simplified worker.
- Produces: server startup with one group automation worker and no group-history capability, backfill, wake or chunk-analysis lifecycle.

- [ ] **Step 1: Strengthen the server boundary test before deleting production wiring**

```js
test("server uses existing conversation memory and has no full-history runtime", () => {
  const source = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(source, /executeGroupAutomationAgentTask/u);
  assert.match(source, /finalizeObsoleteGroupHistoryRemoval/u);
  assert.doesNotMatch(source, /createGroupHistorySyncWorker|groupHistorySyncWorker|enqueueAllManagedGroupsForHistorySync/u);
  assert.doesNotMatch(source, /analyzeGroupHistoryChunk|mergeGroupHistoryAnalyses|listDclawHistory/u);
  assert.doesNotMatch(source, /insertConversationMessageAndWakeGroupHistory/u);
});
```

Add filesystem assertions that the three obsolete production modules no longer exist.

- [ ] **Step 2: Run the boundary test and verify it fails against existing wiring**

Run: `node --test tests/server-group-automation-boundary.test.js`

Expected: FAIL because the server still imports and starts the group-history runtime.

- [ ] **Step 3: Replace startup and worker dependency wiring**

In `src/server.js`:

```js
finalizeObsoleteGroupHistoryRemoval();

const groupAutomationWorker = createGroupAutomationWorker({
  db: groupAutomationDb,
  executeAgentTask: executeGroupAutomationAgentTask,
  sendGroupMessage: sendFrozenGroupAutomationMessage
});

const insertConversationMessage = insertConversationMessageDb;
```

Remove imports, variables, status probes, startup timers, shutdown hooks and message-insert wake calls for group history. Keep local `conversation_messages` writes unchanged. Keep group task status serialization, WebSocket/UI notifications, task CRUD, evidence navigation and upstream send callbacks.

- [ ] **Step 4: Delete obsolete production modules and dedicated tests**

Use `apply_patch` deletions for exactly the files listed in this task. Do not delete normal DClaw conversation tests, group automation configuration tests, occurrence tests, send-safety tests or UI boundary tests.

- [ ] **Step 5: Run server and worker boundaries**

Run: `node --test tests/server-group-automation-boundary.test.js tests/group-automation-worker.test.js tests/group-automation-send-safety.test.js tests/group-agent-turns.test.js`

Expected: PASS.

- [ ] **Step 6: Run a production-code static scan for forbidden runtime references**

Run:

```bash
rg -n "dclaw-group-history|group-history-sync-worker|group-history-transcript|GROUP_HISTORY_SYNC_|groupHistorySyncWorker|managed_group_automation_chunks" src .env.example README.md
```

Expected: no matches. Historical design and plan documents are excluded intentionally because they document the migration rationale.

- [ ] **Step 7: Commit and push server cutover and deletions**

```bash
git status --short
git add src/server.js tests/server-group-automation-boundary.test.js src/dclaw-group-history.js src/group-history-sync-worker.js src/group-history-transcript.js tests/dclaw-group-history.test.js tests/db-group-history-sync.test.js tests/group-history-sync-worker.test.js tests/group-history-transcript.test.js tests/group-automation-long-history.test.js
git commit -m "refactor: remove group history synchronization runtime"
git push origin main
```

---

### Task 6: Update Configuration, Documentation and End-to-End Regression Coverage

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `tests/group-automation-boundary.test.js`
- Create: `tests/group-automation-existing-memory-integration.test.js`

**Interfaces:**
- Consumes: all production interfaces from Tasks 1–5.
- Produces: deployable middle-platform-only documentation and one integration test proving normal group turns and scheduled tasks share the same DClaw session.

- [ ] **Step 1: Write an integration test for the complete memory boundary**

```js
test("only Agent-triggering group turns enter the shared task conversation", async () => {
  await receiveGroupMessage(alwaysReplyMemberMessage);
  await receiveGroupMessage(neverReplyMemberMessage);
  await runDueGroupAutomationTask();

  assert.equal(dclawCalls.length, 2);
  assert.equal(dclawCalls[0].metadata.eventType || "inbound_message", "inbound_message");
  assert.equal(dclawCalls[1].metadata.eventType, "group_automation");
  assert.equal(dclawCalls[1].external_session_id, dclawCalls[0].external_session_id);
  assert.match(dclawCalls[0].message, /M101.*重要客户/u);
  assert.doesNotMatch(dclawCalls.map((call) => call.message).join("\n"), /不关注成员原话/u);
});
```

Add a `mention_only` case proving a real `@` enters the conversation while a non-`@` message does not, and a two-speaker batch case proving the two local IDs remain separately attributable.

- [ ] **Step 2: Run the integration test and fix only integration defects**

Run: `node --test tests/group-automation-existing-memory-integration.test.js`

Expected: PASS after Tasks 1–5. If it fails, change only the smallest production seam responsible for the observed mismatch and rerun the focused tests for that file.

- [ ] **Step 3: Remove obsolete environment variables and rewrite deployment documentation**

Delete all `GROUP_HISTORY_SYNC_*`, DClaw history endpoint, `messages:read`, history capability probe, backfill and cross-repository deployment instructions from `.env.example` and `README.md`.

README must state these exact product facts:

- 中台只把实际触发 Agent 的群消息放入该群普通 Agent 会话；未触发消息仍仅供中台会话查看。
- `始终回复`、`仅 @ 回复`、`从不回复`同时决定日常回复与 Agent 记忆覆盖。
- 群任务到点才在同一普通会话中调用 Agent；不读取或上传完整群历史。
- 条件推送命中后发送用户固定原文；周期汇总发送 Agent 生成 Review。
- Agent 首次加两次重试共三次；明确拒绝发送最多三次，发送结果不明确不自动重发。
- 整个功能不需要 DClaw 服务端修改或新增权限。

- [ ] **Step 4: Add a static boundary preventing reintroduction of removed architecture**

In `tests/group-automation-boundary.test.js`, scan production files, README and `.env.example` and reject:

```js
const forbidden = [
  "GROUP_HISTORY_SYNC_",
  "group-history-analysis",
  "createGroupHistorySyncWorker",
  "managed_group_history_sync_states",
  "managed_group_automation_chunks",
  "buildCompactGroupTranscript",
  "packTranscriptChunks"
];
```

The test must not scan `docs/superpowers/specs` or `docs/superpowers/plans`, which remain historical design records.

- [ ] **Step 5: Run all focused group automation tests**

Run:

```bash
node --test \
  tests/group-agent-turns.test.js \
  tests/dclaw-group-automation-session.test.js \
  tests/group-automation-agent.test.js \
  tests/db-group-automation.test.js \
  tests/db-group-automation-evidence.test.js \
  tests/group-automation-worker.test.js \
  tests/group-automation-send-safety.test.js \
  tests/server-group-automation-boundary.test.js \
  tests/group-automation-boundary.test.js \
  tests/group-automation-existing-memory-integration.test.js
```

Expected: PASS with zero failed tests.

- [ ] **Step 6: Run private-chat and normal DClaw regressions**

Run:

```bash
node --test \
  tests/dclaw-request-sanitization.test.js \
  tests/dclaw-retry.test.js \
  tests/dclaw-tags.test.js \
  tests/conversation-*.test.js \
  tests/server-*-boundary.test.js
```

Expected: PASS; private requests contain no `groupTurns` and retain their prior session, flow, asset and label behavior.

- [ ] **Step 7: Run the entire test suite**

Run: `npm test`

Expected: exit code `0`, no failed tests.

- [ ] **Step 8: Verify maintenance boundaries and changed files**

Run:

```bash
git diff --check
git status --short
git diff --name-only HEAD
git -C "/Users/moxi/Desktop/codex space/dclaw-server" status --short
```

Expected:

- `git diff --check` has no output.
- DClaw server has no changes created by this implementation.
- Unrelated pre-existing group-pinning/UI files may remain dirty but are not staged.
- All implementation changes are confined to the middle-platform repository and listed files.

- [ ] **Step 9: Commit and push docs and final regression coverage**

```bash
git add .env.example README.md tests/group-automation-boundary.test.js tests/group-automation-existing-memory-integration.test.js
git commit -m "docs: document existing conversation group automation"
git push origin main
git status --short
```

Expected: the new commit is present on `origin/main`; only unrelated pre-existing working-tree changes remain.

---

## Acceptance Checklist

- [ ] A、B 同批发言在 Agent 请求中保留不同的中台消息 ID、姓名、角色和时间，顶层最后发言人不能覆盖 A。
- [ ] 单条群消息与多人群消息使用相同 `groupTurns` 结构。
- [ ] 日常群回复与群任务的 `external_user_id`、`external_session_id` 和运行会话 ID 完全一致。
- [ ] 未触发 Agent 的群消息不会被补传；三种回复策略的记忆覆盖符合产品规则。
- [ ] 条件任务只在目标时间调用 Agent；达成发送用户固定内容，未达成不发送。
- [ ] 周期汇总只在目标时间调用 Agent，合法非空 Review 才可发送，记录不足不得编造。
- [ ] Agent 三次总调用预算没有嵌套重试放大。
- [ ] Agent 证据 ID 必须属于当前 Bot 与群会话；无效证据禁止发送。
- [ ] 群背景、角色配置、内部任务提示和判断备注不能泄露给群成员。
- [ ] 任务配置、倒计时、执行状态、历史、证据定位、原生多角色 `@` 和安全发送体验无回归。
- [ ] 中台生产代码不再包含群历史专用客户端、同步 Worker、回填、转录、chunk 或 `GROUP_HISTORY_SYNC_*`。
- [ ] DClaw 服务端仓库未被修改。
- [ ] 聚焦测试、私聊回归和 `npm test` 全部通过后，所有中台提交均已推送到 `origin/main`。
