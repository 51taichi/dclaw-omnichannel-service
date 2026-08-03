# Group Scheduled Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build isolated per-group recurring conditional pushes and template-driven periodic summaries with shared fact ledgers, native multi-person mentions, live countdown/status, execution history, and evidence navigation.

**Architecture:** Add a dedicated group-automation domain with focused schedule, template, Agent-contract, worker, stream, and console modules. Persist tasks, one shared fact ledger per managed group, task-cycle states, durable ledger jobs, and idempotent occurrences in SQLite; wire them into the existing server without reusing private flow state or `proactive_tasks` business records.

**Tech Stack:** Node.js ESM, built-in `node:test`, Express 5, SQLite through the existing `src/db.js` adapter, vanilla HTML/CSS/JavaScript, DClaw Agent API, WorkTool `sendRawMessage` type 203.

## Global Constraints

- All schedule and cycle calculations use `Asia/Shanghai`.
- Monthly choices are exactly days 1 through 28 plus `month_end`; 29, 30, and 31 are invalid inputs.
- Weekly and monthly tasks may select multiple trigger days; each selected trigger is an independent occurrence.
- Conditional-push business state is only `achieved` or `not_achieved`; loading and failures are operational metadata, not third business states.
- Fixed conditional-push content is sent verbatim and is never polished by the Agent.
- Periodic summaries use only `{{变量名称（白话规则）}}` variables and do not expose a separate metric editor.
- Every managed group has one shared fact ledger and one live message cursor; tasks keep separate cycle results and temporary backfill cursors.
- Only inbound group-member messages may create facts. Bot outbound messages, proactive messages, tag activations, and group-automation output are excluded.
- Group reply policies do not filter ledger evidence.
- No background polling of WorkTool groups, group messages, or console status. New messages, configuration changes, explicit refresh, due execution, and bounded retry enqueue work. A database worker may claim already-enqueued durable jobs and due occurrences.
- Task records, facts, cycles, and occurrences are isolated by `botId + groupId`; group names are never durable identities.
- The feature must not read or mutate private flow nodes, private assets, private handoff, customer tags, or existing proactive task records.
- WorkTool sends one group target per command and uses native `atList`; `@所有人` is not supported.
- Agent or summary failure retries at most three times within ten minutes and never causes speculative customer-visible output.
- Confirmed delivery is never retried. Ambiguous network delivery is marked `delivery_unknown` until callback or manual resolution.
- Every task-visible fact and every non-fallback summary variable must reference real inbound `conversation_messages` IDs.
- Evidence navigation reuses the existing tag-alert path that can load an unloaded conversation, open around an anchor message, and highlight it.
- Implementation uses TDD and commits after every independently passing task.

---

## File Map

### New production files

- `src/group-automation-schedule.js` — normalize recurrence, compute cycle windows and next Beijing run.
- `src/group-summary-template.js` — parse, validate, and render white-language summary variables.
- `src/group-automation-agent.js` — build bounded DClaw requests and strictly validate ledger/occurrence JSON.
- `src/group-automation-worker.js` — durable ledger/backfill and occurrence execution orchestration through injected dependencies.
- `src/group-automation-stream.js` — Bot-scoped SSE snapshots and task updates.
- `public/console/group-automation-client.js` — SSE lifecycle and selected-group filtering.

### Existing production files

- `src/db.js` — schema, row mapping, task repository, shared facts, jobs, cycles, occurrences, leases, and cleanup.
- `src/dclaw.js` — export dedicated ledger and occurrence request builders using the existing conversation identity and request bounds.
- `src/worktool.js` — add validated `atList` support to type-203 text sends.
- `src/server.js` — enqueue ledger work after inbound persistence/config changes, wire workers, routes, callbacks, and SSE.
- `public/console/index.html` — load the client and add task/edit/history dialogs.
- `public/console/app.js` — group task state, CRUD, countdowns, preview, history, and evidence navigation.
- `public/console/styles.css` — bounded task list, cards, dialog form, template preview, history and responsive layout.

### New test files

- `tests/group-automation-schedule.test.js`
- `tests/group-summary-template.test.js`
- `tests/db-group-automation.test.js`
- `tests/db-group-ledger.test.js`
- `tests/group-automation-agent.test.js`
- `tests/group-automation-worker.test.js`
- `tests/group-automation-stream.test.js`
- `tests/server-group-automation-boundary.test.js`
- `tests/console-group-automation-boundary.test.js`

### Existing tests to modify

- `tests/worktool-mentions.test.js`
- `tests/console-tags-boundary.test.js`
- `tests/console-handoff-boundary.test.js`
- `tests/server-group-conversation-boundary.test.js`
- `tests/db-bot-isolation.test.js`

---

### Task 1: Beijing recurrence and cycle domain

**Files:**
- Create: `src/group-automation-schedule.js`
- Test: `tests/group-automation-schedule.test.js`

**Interfaces:**
- Consumes: ISO instants and `{ cadence, scheduleDays, timeOfDay }` task schedule data.
- Produces: `normalizeGroupAutomationSchedule(input)`, `nextGroupAutomationRunAt(schedule, afterIso)`, `groupAutomationCycleWindow(cadence, atIso)`, and `groupAutomationCycleKey(cadence, atIso)`.

- [ ] **Step 1: Write failing normalization and recurrence tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  groupAutomationCycleKey,
  groupAutomationCycleWindow,
  nextGroupAutomationRunAt,
  normalizeGroupAutomationSchedule
} from "../src/group-automation-schedule.js";

test("monthly schedule accepts 1-28 and month_end only", () => {
  assert.deepEqual(normalizeGroupAutomationSchedule({
    cadence: "monthly",
    scheduleDays: [1, 15, "month_end", 15],
    timeOfDay: "20:30"
  }).scheduleDays, [1, 15, "month_end"]);
  for (const invalid of [0, 29, 30, 31, "31", "last"]) {
    assert.throws(() => normalizeGroupAutomationSchedule({
      cadence: "monthly", scheduleDays: [invalid], timeOfDay: "20:30"
    }), /monthly schedule day/);
  }
});

test("month_end resolves to the real Beijing month end", () => {
  assert.equal(nextGroupAutomationRunAt({
    cadence: "monthly", scheduleDays: ["month_end"], timeOfDay: "09:00"
  }, "2028-02-01T00:00:00.000Z"), "2028-02-29T01:00:00.000Z");
});

test("weekly selected days are independent and cycle starts Monday", () => {
  const schedule = { cadence: "weekly", scheduleDays: [1, 3, 5], timeOfDay: "20:00" };
  assert.equal(nextGroupAutomationRunAt(schedule, "2026-08-03T11:00:00.000Z"), "2026-08-03T12:00:00.000Z");
  assert.equal(nextGroupAutomationRunAt(schedule, "2026-08-03T12:00:00.000Z"), "2026-08-05T12:00:00.000Z");
  assert.equal(groupAutomationCycleKey("weekly", "2026-08-05T12:00:00.000Z"), "2026-W32");
  assert.deepEqual(groupAutomationCycleWindow("daily", "2026-08-04T15:00:00.000Z"), {
    cycleKey: "2026-08-04",
    startAt: "2026-08-03T16:00:00.000Z",
    endAt: "2026-08-04T16:00:00.000Z"
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing module failure**

Run: `node --test tests/group-automation-schedule.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement strict normalization and calendar iteration**

```js
export const BEIJING_TIME_ZONE = "Asia/Shanghai";
const WEEK_DAYS = new Set([1, 2, 3, 4, 5, 6, 7]);
const MONTH_DAYS = new Set([...Array.from({ length: 28 }, (_, index) => index + 1), "month_end"]);

export function normalizeGroupAutomationSchedule(input = {}) {
  const cadence = String(input.cadence || "").trim();
  if (!["daily", "weekly", "monthly"].includes(cadence)) throw new Error("invalid cadence");
  const timeOfDay = String(input.timeOfDay || "").trim();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(timeOfDay)) throw new Error("invalid timeOfDay");
  const sourceDays = cadence === "daily" ? [] : [...new Set(input.scheduleDays || [])];
  const allowed = cadence === "weekly" ? WEEK_DAYS : MONTH_DAYS;
  if (cadence !== "daily" && (!sourceDays.length || sourceDays.some((day) => !allowed.has(day)))) {
    throw new Error(`invalid ${cadence} schedule day`);
  }
  return { cadence, scheduleDays: sourceDays, timeOfDay };
}
```

Implement Beijing civil-date helpers with `Intl.DateTimeFormat`, generate candidate dates without relying on the host timezone, and return the first candidate strictly later than `afterIso`. Use ISO-week Thursday math for `YYYY-Www` keys and exclusive `endAt` boundaries.

- [ ] **Step 4: Run schedule tests**

Run: `node --test tests/group-automation-schedule.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/group-automation-schedule.js tests/group-automation-schedule.test.js
git commit -m "feat: add group automation schedule domain"
```

---

### Task 2: White-language summary template parser

**Files:**
- Create: `src/group-summary-template.js`
- Test: `tests/group-summary-template.test.js`

**Interfaces:**
- Consumes: a customer template string and a result map keyed by variable name.
- Produces: `parseGroupSummaryTemplate(template) -> { template, variables }` and `renderGroupSummaryTemplate(parsed, values) -> string`.

- [ ] **Step 1: Write failing parser tests**

```js
test("parses white-language variables and renders every token", () => {
  const parsed = parseGroupSummaryTemplate(
    "本周上课 {{本周上课次数（完成课程才计数；无记录填0；只输出数字）}} 次\n{{情况摘要}}"
  );
  assert.deepEqual(parsed.variables, [
    { name: "本周上课次数", instruction: "完成课程才计数；无记录填0；只输出数字" },
    { name: "情况摘要", instruction: "情况摘要" }
  ]);
  assert.equal(renderGroupSummaryTemplate(parsed, {
    本周上课次数: "3", 情况摘要: "学习状态稳定"
  }), "本周上课 3 次\n学习状态稳定");
});

test("rejects malformed and conflicting variables", () => {
  assert.throws(() => parseGroupSummaryTemplate("{{}}"), /variable name/);
  assert.throws(() => parseGroupSummaryTemplate("{{次数（规则）}"), /unclosed/);
  assert.throws(() => parseGroupSummaryTemplate("{{次数（规则A）}} {{次数（规则B）}}"), /conflicting/);
});

test("never leaks unresolved template syntax", () => {
  const parsed = parseGroupSummaryTemplate("结果：{{次数（只输出数字）}}");
  assert.throws(() => renderGroupSummaryTemplate(parsed, {}), /missing variable value/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/group-summary-template.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement one-pass token parsing and exact replacement**

```js
const TOKEN = /\{\{([\s\S]*?)\}\}/g;

export function parseGroupSummaryTemplate(value) {
  const template = String(value || "").trim();
  if (!template) throw new Error("summary template is required");
  const variables = [];
  const byName = new Map();
  for (const match of template.matchAll(TOKEN)) {
    const body = match[1].trim();
    const open = body.indexOf("（");
    const name = (open < 0 ? body : body.slice(0, open)).trim();
    const instruction = open < 0
      ? name
      : body.endsWith("）") ? body.slice(open + 1, -1).trim() : "";
    if (!name) throw new Error("summary variable name is required");
    if (open >= 0 && (!body.endsWith("）") || !instruction)) throw new Error("unclosed summary variable rule");
    if (byName.has(name) && byName.get(name) !== instruction) throw new Error(`conflicting summary variable: ${name}`);
    if (!byName.has(name)) variables.push({ name, instruction });
    byName.set(name, instruction);
  }
  const unmatched = template.replace(TOKEN, "");
  if (unmatched.includes("{{") || unmatched.includes("}}")) throw new Error("unclosed summary variable");
  return { template, variables };
}
```

Render by reparsing each token name, requiring every value to be a bounded scalar string, replacing every occurrence, and rejecting output containing `{{` or `}}`.

- [ ] **Step 4: Run parser tests**

Run: `node --test tests/group-summary-template.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/group-summary-template.js tests/group-summary-template.test.js
git commit -m "feat: add group summary template parser"
```

---

### Task 3: Group automation task repository and due occurrences

**Files:**
- Modify: `src/db.js:220-640`
- Modify: `src/db.js:850-1020`
- Modify: `src/db.js:7420-7810`
- Test: `tests/db-group-automation.test.js`
- Modify: `tests/db-bot-isolation.test.js`

**Interfaces:**
- Consumes: normalized schedules from Task 1 and parsed templates from Task 2 at the server boundary.
- Produces: `createGroupAutomationTask`, `updateGroupAutomationTask`, `duplicateGroupAutomationTask`, `softDeleteGroupAutomationTask`, `getGroupAutomationTask`, `listGroupAutomationTasks`, `claimDueGroupAutomationOccurrences`, `completeGroupAutomationOccurrence`, `failGroupAutomationOccurrence`, `listGroupAutomationOccurrences`, and `resolveGroupAutomationMentionNames`.

- [ ] **Step 1: Write failing repository tests**

Create a temporary-data-directory test matching `tests/db-proactive-scheduling.test.js`. Seed two Bots, managed groups, and roles, then assert:

```js
const task = db.createGroupAutomationTask({
  botId, groupId: group.id, name: "作业提醒", taskType: "conditional_push",
  cadence: "weekly", scheduleDays: [1, 3, 5], timeOfDay: "20:00",
  conditionText: "本周客户尚未提交作业", content: "请记得提交作业",
  summaryTemplate: "", mentionRoleIds: [parentRole.id, teacherRole.id],
  enabled: true, nextRunAt: "2026-08-05T12:00:00.000Z"
});
assert.deepEqual(task.mentionRoleIds, [parentRole.id, teacherRole.id]);

const claimed = db.claimDueGroupAutomationOccurrences({
  nowIso: "2026-08-05T12:00:00.000Z", limit: 10, leaseMs: 300000
});
assert.equal(claimed.length, 1);
assert.equal(claimed[0].scheduledFor, "2026-08-05T12:00:00.000Z");
assert.equal(db.claimDueGroupAutomationOccurrences({
  nowIso: "2026-08-05T12:00:00.000Z", limit: 10, leaseMs: 300000
}).length, 0);
```

Also test optimistic version rejection, soft-delete history retention, disabled tasks not claimed, role rename resolution, deleted roles omitted with warnings, group/Bot isolation, and the unique `(task_id, scheduled_for)` occurrence constraint.

- [ ] **Step 2: Run DB tests and verify missing exports**

Run: `node --test tests/db-group-automation.test.js tests/db-bot-isolation.test.js`

Expected: FAIL because `createGroupAutomationTask` is not exported.

- [ ] **Step 3: Add schema and row mappers**

Add these tables and indexes to the existing schema block:

```sql
CREATE TABLE IF NOT EXISTS managed_group_automation_tasks (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  task_type TEXT NOT NULL CHECK (task_type IN ('conditional_push','periodic_summary')),
  cadence TEXT NOT NULL CHECK (cadence IN ('daily','weekly','monthly')),
  schedule_days_json TEXT NOT NULL DEFAULT '[]',
  time_of_day TEXT NOT NULL,
  condition_text TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  summary_template TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_group_automation_tasks_due
ON managed_group_automation_tasks (enabled, deleted_at, next_run_at);

CREATE TABLE IF NOT EXISTS managed_group_automation_mentions (
  task_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (task_id, role_id)
);

CREATE TABLE IF NOT EXISTS managed_group_automation_occurrences (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  cycle_key TEXT NOT NULL,
  cycle_start_at TEXT NOT NULL,
  cycle_end_at TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TEXT,
  condition_achieved INTEGER,
  reason TEXT NOT NULL DEFAULT '',
  variable_values_json TEXT NOT NULL DEFAULT '{}',
  fact_ids_json TEXT NOT NULL DEFAULT '[]',
  evidence_message_ids_json TEXT NOT NULL DEFAULT '[]',
  mention_role_ids_json TEXT NOT NULL DEFAULT '[]',
  mention_names_json TEXT NOT NULL DEFAULT '[]',
  rendered_content TEXT NOT NULL DEFAULT '',
  worktool_message_id TEXT NOT NULL DEFAULT '',
  worktool_response_json TEXT,
  error_message TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (task_id, scheduled_for)
);
```

- [ ] **Step 4: Implement transactional CRUD and claim semantics**

Use `crypto.randomUUID()`, existing `json()/parseJson()` helpers, and Bot/group checks. Creation and update replace mention rows transactionally. Claiming must:

1. select due enabled tasks whose `next_run_at <= nowIso`;
2. insert the unique occurrence with cycle data;
3. advance task `next_run_at` using `nextGroupAutomationRunAt`;
4. mark the occurrence `evaluating`, increment attempts, and set a lease;
5. recover expired `evaluating` or `sending` leases without duplicating the occurrence.

- [ ] **Step 5: Run repository and isolation tests**

Run: `node --test tests/db-group-automation.test.js tests/db-bot-isolation.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db.js tests/db-group-automation.test.js tests/db-bot-isolation.test.js
git commit -m "feat: persist group automation tasks"
```

---

### Task 4: Shared group fact ledger, jobs, and cycle state

**Files:**
- Modify: `src/db.js:520-640`
- Modify: `src/db.js:1020-1620`
- Test: `tests/db-group-ledger.test.js`

**Interfaces:**
- Consumes: validated fact mutations and task states from Task 5.
- Produces: `enqueueGroupLedgerJob`, `claimGroupLedgerJobs`, `applyGroupLedgerEvaluation`, `failGroupLedgerJob`, `listGroupLedgerProjection`, `getGroupLedgerState`, `getGroupAutomationCycleState`, and `listGroupAutomationEvidenceMessages`.

- [ ] **Step 1: Write failing shared-ledger tests**

Assert one live cursor per group, task-specific backfill cursors, fact dedupe, correction, and atomic task-state updates:

```js
db.enqueueGroupLedgerJob({ botId, groupId, mode: "live", throughMessageId: message2.id });
db.enqueueGroupLedgerJob({ botId, groupId, mode: "live", throughMessageId: message3.id });
const jobs = db.claimGroupLedgerJobs({ nowIso, limit: 10, leaseMs: 300000 });
assert.equal(jobs.length, 1);
assert.equal(jobs[0].throughMessageId, message3.id);

db.applyGroupLedgerEvaluation({
  jobId: jobs[0].id, botId, groupId, throughMessageId: message3.id,
  facts: [{
    operation: "upsert", semanticKey: "homework:student-a:2026-08-04",
    category: "homework_submission", statement: "已提交数学作业",
    value: { subject: "student-a", submitted: true }, happenedAt,
    speakerName: "家长", roleId: parentRole.id,
    evidenceMessageIds: [message2.id]
  }],
  conditionStates: [{ taskId: task.id, cycleKey: "2026-08-04", achieved: true,
    reason: "家长明确提交", supportingFactKeys: ["homework:student-a:2026-08-04"],
    contradictingFactKeys: [] }]
});
assert.equal(db.getGroupLedgerState({ botId, groupId }).liveCursorMessageId, message3.id);
assert.equal(db.getGroupAutomationCycleState({ botId, groupId, taskId: task.id, cycleKey: "2026-08-04" }).achieved, true);
```

Add a second mutation that retracts the semantic key with a newer evidence message and flips the same cycle state to false. Verify outbound messages are rejected as evidence and a message from a `never` role is accepted.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/db-group-ledger.test.js`

Expected: FAIL because ledger functions are missing.

- [ ] **Step 3: Add ledger schema**

Add tables for `managed_group_facts`, `managed_group_fact_evidence`, `managed_group_ledger_states`, `managed_group_ledger_jobs`, and `managed_group_automation_cycle_states`. Enforce one fact semantic key per group, one live job per group, one cycle state per task/cycle, and message evidence foreign identity checks in repository code.

The job table stores `mode IN ('live','backfill','reindex')`, optional task ID, from/through message IDs, status, attempts, lease, and error. Live enqueue uses upsert/max semantics so many inbound messages collapse into one durable job.

- [ ] **Step 4: Implement atomic fact and cycle application**

`applyGroupLedgerEvaluation` must open `BEGIN IMMEDIATE`, verify every evidence message is an inbound row for the same Bot and managed group conversation key, upsert/retract facts, replace evidence relations, update condition cycle states, advance the correct live or backfill cursor, complete the job, and commit. Any invalid evidence rolls back the whole evaluation.

- [ ] **Step 5: Run ledger tests**

Run: `node --test tests/db-group-ledger.test.js tests/db-group-automation.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db.js tests/db-group-ledger.test.js tests/db-group-automation.test.js
git commit -m "feat: add shared group fact ledger"
```

---

### Task 5: Bounded Agent contracts for ledger and occurrences

**Files:**
- Create: `src/group-automation-agent.js`
- Modify: `src/dclaw.js:1-130`
- Modify: `src/dclaw.js:680-875`
- Test: `tests/group-automation-agent.test.js`

**Interfaces:**
- Consumes: binding, managed group, roles, active task definitions, cycle windows, bounded ledger projection, and allowed inbound messages/facts.
- Produces: `buildGroupLedgerAgentRequest`, `parseGroupLedgerAgentReply`, `buildGroupOccurrenceAgentRequest`, `parseGroupOccurrenceAgentReply`, and `compactGroupLedgerProjection`.

- [ ] **Step 1: Write failing request and validator tests**

```js
const request = buildGroupLedgerAgentRequest({
  binding, group, roles, tasks: [conditionTask, summaryTask],
  projection: { facts: [] }, messages: [inboundMessage], maxChars: 12000
});
assert.match(request.message, /只提取与启用条件和模板变量直接相关的客观事实/);
assert.doesNotMatch(request.message, /Bot outbound text/);
assert.ok(request.message.length <= 12000);

const parsed = parseGroupLedgerAgentReply(JSON.stringify({
  facts: [{ operation: "upsert", semanticKey: "lesson:2026-08-04:1",
    category: "lesson", statement: "完成一次课程", value: { count: 1 },
    happenedAt: "2026-08-04T10:00:00+08:00", speakerName: "老师",
    roleId: "role-teacher", evidenceMessageIds: [41] }],
  conditionStates: [{ taskId: "task-1", cycleKey: "2026-08-04",
    achieved: true, reason: "已经完成", supportingFactKeys: ["lesson:2026-08-04:1"],
    contradictingFactKeys: [] }]
}), { allowedMessageIds: [41], allowedTaskIds: ["task-1"] });
assert.equal(parsed.conditionStates[0].achieved, true);
```

Reject unknown task IDs, unknown message IDs, non-boolean `achieved`, overlong fields, duplicate semantic mutations, unsupported operations, and summary values without facts unless `fallbackUsed=true`.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/group-automation-agent.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement strict JSON extraction and bounded compaction**

Use a dedicated schema rather than `parseAgentReply`:

```js
// ledger reply
{ facts: FactMutation[], conditionStates: ConditionState[] }

// conditional occurrence reply
{ achieved: boolean, reason: string, supportingFactKeys: string[], contradictingFactKeys: string[] }

// summary occurrence reply
{ variables: [{ name: string, value: string, factKeys: string[], fallbackUsed: boolean, reason: string }] }
```

The request instructs the Agent that group background and roles are private context, every fact must cite allowed inbound message IDs, corrections must retract or replace older keys, absent records do not prove non-occurrence, and it must output one JSON object only.

`compactGroupLedgerProjection` keeps current-cycle facts, facts already referenced by task state, compressed cumulative aggregates, and active correction links. It drops oldest unreferenced statements until serialized input fits `maxChars`, but never drops a task definition or allowed message ID map.

- [ ] **Step 4: Add DClaw request builders with isolated purposes**

Build identities with purposes `group-ledger` and `group-automation-occurrence` so ledger analysis cannot contaminate the normal group conversation runtime. Preserve existing DClaw request size checks and metadata sanitization.

- [ ] **Step 5: Run Agent contract tests**

Run: `node --test tests/group-automation-agent.test.js tests/dclaw-request-sanitization.test.js tests/dclaw-conversation-identity.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/group-automation-agent.js src/dclaw.js tests/group-automation-agent.test.js
git commit -m "feat: add group automation agent contracts"
```

---

### Task 6: Native WorkTool multi-person mentions

**Files:**
- Modify: `src/worktool.js:100-121`
- Create: `tests/worktool-mentions.test.js`

**Interfaces:**
- Consumes: `sendTextMessage({ robotId, targets, content, socketType, atList })`.
- Produces: WorkTool type-203 JSON containing a deduplicated `atList` only when non-empty.

- [ ] **Step 1: Write failing atList test**

Mock `fetch`, call:

```js
await sendTextMessage({
  robotId: "bot-1",
  targets: ["服务群"],
  content: "今晚八点上课",
  atList: ["家长", "授课老师", "家长"]
});
assert.deepEqual(JSON.parse(fetch.mock.calls[0].arguments[1].body).list[0], {
  type: 203,
  titleList: ["服务群"],
  receivedContent: "今晚八点上课",
  atList: ["家长", "授课老师"]
});
```

Also assert blank names are omitted, `@所有人` is rejected, and legacy calls omit `atList` and remain byte-compatible.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/worktool-mentions.test.js`

Expected: FAIL because the payload omits `atList`.

- [ ] **Step 3: Implement mention normalization**

```js
export async function sendTextMessage({ robotId, targets, content, socketType = 2, atList = [] }) {
  const mentions = [...new Set((Array.isArray(atList) ? atList : [])
    .map((name) => String(name || "").trim()).filter(Boolean))];
  if (mentions.includes("@所有人")) throw new Error("at everyone is not supported");
  // existing validation
  return requestWorkTool("/wework/sendRawMessage", {
    robotId,
    method: "POST",
    body: JSON.stringify({ socketType, list: [{
      type: 203, titleList: targets, receivedContent: content,
      ...(mentions.length ? { atList: mentions } : {})
    }] })
  });
}
```

- [ ] **Step 4: Run WorkTool tests**

Run: `node --test tests/worktool-mentions.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worktool.js tests/worktool-mentions.test.js
git commit -m "feat: support WorkTool group mentions"
```

---

### Task 7: Durable group ledger worker and inbound/config triggers

**Files:**
- Create: `src/group-automation-worker.js`
- Modify: `src/server.js:4280-4385`
- Modify: `src/server.js:4680-4740`
- Modify: `src/server.js:5682-5730`
- Test: `tests/group-automation-worker.test.js`
- Modify: `tests/server-group-conversation-boundary.test.js`

**Interfaces:**
- Consumes: DB job functions from Task 4 and Agent contracts from Task 5 through injected dependencies.
- Produces: `createGroupAutomationWorker(deps)` with `enqueueLive`, `enqueueReindex`, `runLedgerTick`, `runOccurrenceTick`, and `recover` methods. Task 8 fills occurrence execution; this task implements ledger methods.

- [ ] **Step 1: Write failing ledger-worker tests**

Use dependency fakes to prove:

```js
const worker = createGroupAutomationWorker({ db, invokeAgent, sendText, now, logger });
await worker.enqueueLive({ botId, groupId, throughMessageId: 52 });
await worker.enqueueLive({ botId, groupId, throughMessageId: 55 });
await worker.runLedgerTick();
assert.equal(invokeAgent.mock.callCount(), 1);
assert.deepEqual(db.applied[0].throughMessageId, 55);
```

Add cases for: no enabled tasks means no Agent call; one batch updates multiple tasks; failed Agent call leaves job retryable; lease recovery; fixed push without a condition does not add a condition definition; outbound messages never appear in the request; and ledger work uses background queue priority.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/group-automation-worker.test.js tests/server-group-conversation-boundary.test.js`

Expected: FAIL with missing worker module and missing enqueue boundary.

- [ ] **Step 3: Implement worker ledger methods**

`runLedgerTick` claims a bounded batch but serializes jobs by group ID. For each job it loads the managed group, roles, enabled tasks, current cycles, allowed inbound messages after the appropriate cursor, and compact projection; invokes DClaw through `enqueueAgentInvocation(..., { priority: "background" })`; validates the reply; and atomically applies it. Retry delays are 60, 180, and 600 seconds, capped at three attempts.

- [ ] **Step 4: Wire event-driven enqueue points**

After `persistInboundConversation` returns an inbound `messageRecord` for a managed group, call `groupAutomationWorker.enqueueLive` without awaiting Agent analysis. Do this before group reply-policy early returns so `never` and unmentioned messages still enter the ledger.

After group config or roles are saved, call `enqueueReindex({ botId, groupId, reason: "group_context_changed" })`. Do not enqueue from outbound message persistence.

- [ ] **Step 5: Run worker and inbound tests**

Run: `node --test tests/group-automation-worker.test.js tests/server-group-conversation-boundary.test.js tests/server-group-reply-policy.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/group-automation-worker.js src/server.js tests/group-automation-worker.test.js tests/server-group-conversation-boundary.test.js
git commit -m "feat: update group facts from inbound messages"
```

---

### Task 8: Occurrence final evaluation, summary render, and delivery

**Files:**
- Modify: `src/group-automation-worker.js`
- Modify: `src/server.js:1550-1585`
- Modify: `src/server.js:4235-4285`
- Test: `tests/group-automation-worker.test.js`

**Interfaces:**
- Consumes: due occurrences from Task 3, ledger projection from Task 4, Agent occurrence contracts from Task 5, template renderer from Task 2, and mention-capable WorkTool send from Task 6.
- Produces: complete `runOccurrenceTick`, `retryOccurrence`, and `recover` behavior.

- [ ] **Step 1: Add failing conditional execution tests**

Cover:

```js
await worker.runOccurrenceTick();
assert.equal(finalConditionRequest.taskId, conditionTask.id);
assert.deepEqual(sendText.mock.calls[0].arguments[0], {
  robotId: botId,
  targets: [group.currentName],
  content: "请提交作业",
  atList: ["家长", "授课老师"]
});
assert.equal(db.occurrence.status, "sent");
```

Add cases for no-condition push skipping Agent; false condition becoming `skipped`; condition Agent failure never sending; role rename using the new name; deleted role warning; group rename using current group address; and a duplicate tick not sending twice.

- [ ] **Step 2: Add failing summary execution tests**

Return Agent variables with fact keys and assert exact rendering. Return a fallback variable with no fact keys and `fallbackUsed=true` and accept it. Reject an unbacked non-fallback value, unresolved variable, disclosure of “群背景/事实账本/后台配置”, or Agent text outside the JSON object.

- [ ] **Step 3: Run and verify RED**

Run: `node --test tests/group-automation-worker.test.js`

Expected: FAIL because occurrence execution is not implemented.

- [ ] **Step 4: Implement final occurrence flow**

For each claimed occurrence:

1. synchronously drain or process the group ledger through the latest inbound message ID;
2. reload task, group, roles, cycle state and projection;
3. for a fixed push with empty condition, use the configured content directly;
4. for a conditional push, invoke the final condition request and stop on false;
5. for a summary, parse the saved template, invoke summary mode, validate every variable, and render exact content;
6. resolve current mention names and call `sendTextMessage` once;
7. persist an outbound `conversation_messages` row with `rawPayload.source = "group_automation"` and occurrence ID;
8. complete the occurrence and publish a task update;
9. on error, classify safe retry, `delivery_unknown`, or terminal failure.

Use one running occurrence per group to preserve WorkTool ordering. Do not use private flow sessions or proactive task targets.

- [ ] **Step 5: Wire the worker timers and recovery**

Add `GROUP_AUTOMATION_WORKER_ENABLED`, `GROUP_AUTOMATION_LEDGER_INTERVAL_MS`, `GROUP_AUTOMATION_OCCURRENCE_INTERVAL_MS`, `GROUP_AUTOMATION_LEASE_MS`, and `GROUP_AUTOMATION_BATCH_SIZE` beside existing worker configs. On startup call `recover()`, then run separate lightweight database-claim intervals for enqueued ledger jobs and due task occurrences.

- [ ] **Step 6: Run worker tests**

Run: `node --test tests/group-automation-worker.test.js tests/db-group-automation.test.js tests/db-group-ledger.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/group-automation-worker.js src/server.js tests/group-automation-worker.test.js
git commit -m "feat: execute group scheduled automation"
```

---

### Task 9: Authorized API routes, SSE updates, history, and evidence

**Files:**
- Create: `src/group-automation-stream.js`
- Modify: `src/server.js:302`
- Modify: `src/server.js:5658-5755`
- Test: `tests/group-automation-stream.test.js`
- Test: `tests/server-group-automation-boundary.test.js`

**Interfaces:**
- Consumes: repositories/workers from Tasks 3, 4, 7, and 8.
- Produces: CRUD/history/manual-action routes and `createGroupAutomationStreamHub()`.

- [ ] **Step 1: Write failing stream tests**

Mirror `tests/tag-alert-stream.test.js` but publish Bot/group task snapshots:

```js
hub.subscribe({ botId: "bot-a", req, res, snapshot: [{ id: "task-1" }] });
hub.publish({ botId: "bot-a", groupId: "group-1", task: { id: "task-1", achieved: true } });
assert.match(res.output, /event: snapshot/);
assert.match(res.output, /event: task_updated/);
assert.doesNotMatch(otherBotRes.output, /task-1/);
```

- [ ] **Step 2: Write failing route boundary tests**

Require these routes and `assertBotAccess` on every route:

```text
GET    /api/groups/:groupId/automations
POST   /api/groups/:groupId/automations
GET    /api/groups/:groupId/automations/events
GET    /api/groups/:groupId/automations/:taskId
PATCH  /api/groups/:groupId/automations/:taskId
POST   /api/groups/:groupId/automations/:taskId/duplicate
DELETE /api/groups/:groupId/automations/:taskId
GET    /api/groups/:groupId/automations/:taskId/occurrences
POST   /api/groups/:groupId/automations/:taskId/refresh
POST   /api/groups/:groupId/automations/occurrences/:occurrenceId/retry
GET    /api/groups/:groupId/automations/evidence/:messageId
```

Test that create/update call schedule and template normalizers, validate mention role IDs against the same group, compute `nextRunAt`, and enqueue backfill/reindex. Evidence returns the existing conversation anchor payload rather than duplicating message history.

- [ ] **Step 3: Run and verify RED**

Run: `node --test tests/group-automation-stream.test.js tests/server-group-automation-boundary.test.js`

Expected: FAIL because the hub and routes do not exist.

- [ ] **Step 4: Implement the stream hub and routes**

Follow `src/tag-alert-stream.js` connection cleanup, heartbeat, and `close()` behavior. Route serializers expose operational fields separately:

```js
{
  id, name, taskType, enabled, cadence, scheduleDays, timeOfDay,
  conditionText, content, summaryTemplate, mentionRoleIds,
  nextRunAt, version,
  currentState: { achieved, reason, evaluatedAt, stale, lastError },
  lastOccurrence
}
```

Never return group background or full ledger facts in list responses. Detail/history may return fact summaries and evidence IDs required for audit.

- [ ] **Step 5: Run stream and route tests**

Run: `node --test tests/group-automation-stream.test.js tests/server-group-automation-boundary.test.js tests/server-auth-boundary.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/group-automation-stream.js src/server.js tests/group-automation-stream.test.js tests/server-group-automation-boundary.test.js
git commit -m "feat: expose group automation API"
```

---

### Task 10: Group-management task UI, dialogs, countdown, and history

**Files:**
- Create: `public/console/group-automation-client.js`
- Modify: `public/console/index.html:560-590`
- Modify: `public/console/app.js:1-200`
- Modify: `public/console/app.js:5620-5755`
- Modify: `public/console/styles.css:5932-6460`
- Test: `tests/console-group-automation-boundary.test.js`

**Interfaces:**
- Consumes: Task 9 JSON and SSE events.
- Produces: group task cards, add/edit dialog, template preview, execution-history dialog, manual actions, and local countdown refresh.

- [ ] **Step 1: Write failing console boundary tests**

Assert the HTML contains both dialogs and loads `group-automation-client.js` before `app.js`. Assert `renderGroupConfig` appends a “群定时任务” section after roles, with no group chat history. Assert the UI contains:

- task type selection for 条件推送/周期汇总;
- daily/weekly/monthly controls;
- weekly multi-day buttons;
- monthly 1—28 and 月底 controls, with no 29/30/31;
- one shared time input;
- multi-role checkbox cards;
- optional condition and fixed content fields;
- one summary template editor, insert-variable action, variable count, and preview;
- enable switch, save, copy, delete, history, refresh/retry actions;
- achieved/not-achieved copy only;
- next-run and countdown fields.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/console-group-automation-boundary.test.js`

Expected: FAIL because the assets and markup are missing.

- [ ] **Step 3: Implement client state and rendering**

Add state fields:

```js
groupAutomations: [],
groupAutomationDialogTask: null,
groupAutomationOccurrences: [],
groupAutomationCountdownTimer: null,
groupAutomationStreamGroupId: ""
```

`renderGroupAutomationSection()` renders bounded cards. Use CSS grid columns with fixed icon/status/action slots so text length never changes alignment. The task list scrolls inside the existing group workbench height and does not expand the page indefinitely.

Countdown updates every second from `nextRunAt` locally. It stops when the selected Bot/group changes or the tab is hidden and recalculates on resume; it performs no request.

- [ ] **Step 4: Implement add/edit dialog behavior**

Use a fixed header, scrollable body, and fixed footer like the corrected create-group dialog. Changing task type toggles only the type-specific panel. Cadence controls produce exact schedule values. Role cards support multiple selections. Saving sends the complete normalized payload plus version for edits.

Template preview calls the local parser behavior mirrored in the UI: show detected variable chips and substitute visible sample values such as `［本周上课次数］`; do not invoke Agent for preview.

- [ ] **Step 5: Implement history and evidence actions**

History rows show planned/actual time, sent/skipped/failed result, condition or variable summary, mentions, retry count, and details. Evidence buttons call the Task 9 evidence route and pass the returned Bot/conversation/message identity to the same `openFlowSession(..., { anchorMessageId })` path used by tag alerts.

- [ ] **Step 6: Implement SSE lifecycle**

`group-automation-client.js` mirrors tag-alert reconnect generation guards. Connect only for the selected Bot/group while group management is active, apply snapshots/updates only when selection still matches, and disconnect on Bot/group/tab changes.

- [ ] **Step 7: Add responsive styles**

Desktop keeps the existing 30/70 workbench. Task cards use compact two-column metadata and fixed action slots. At narrow widths, cards stack metadata but retain fixed status and action alignment. Dialog controls wrap by breakpoint, never by content length. Add reduced-motion handling for status highlights.

- [ ] **Step 8: Run console tests and JS syntax checks**

Run: `node --check public/console/group-automation-client.js && node --check public/console/app.js && node --test tests/console-group-automation-boundary.test.js tests/console-group-management-boundary.test.js tests/console-tags-boundary.test.js tests/console-handoff-boundary.test.js`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add public/console/group-automation-client.js public/console/index.html public/console/app.js public/console/styles.css tests/console-group-automation-boundary.test.js tests/console-group-management-boundary.test.js tests/console-tags-boundary.test.js tests/console-handoff-boundary.test.js
git commit -m "feat: add group automation console"
```

---

### Task 11: Integration hardening and requirement audit

**Files:**
- Modify: `tests/server-group-automation-boundary.test.js`
- Modify: `tests/group-automation-worker.test.js`
- Modify: `tests/db-group-ledger.test.js`
- Modify: `tests/console-group-automation-boundary.test.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: complete acceptance coverage, deployment configuration documentation, and no known requirement gaps.

- [ ] **Step 1: Add cross-component acceptance tests**

Add named cases mapping to every design acceptance criterion. The integration fixtures must assert all of these concrete outcomes:

- one inbound batch produces exactly one Agent invocation while updating daily, weekly, and monthly cycle rows;
- an upsert fact followed by a retracting correction changes `achieved` from `1` to `0` before the due occurrence is claimed;
- 2,000 month-long messages are consumed in bounded batches and every built request stays below the configured character limit;
- a non-fallback summary variable stores at least one fact/evidence ID while a `fallbackUsed=true` variable stores none;
- sent automation output creates an outbound conversation row and no ledger job through-message cursor for that outbound row;
- snapshots of private flow sessions, private assets, conversation tags, and `proactive_tasks` are byte-equivalent before and after group execution;
- evidence navigation for a group absent from `currentFlowSessions` inserts the detailed session, loads around the anchor ID, and sets the highlight target.

Use real temporary SQLite repositories for persistence boundaries and injected Agent/WorkTool fakes for external calls. Each assertion must fail before the missing integration behavior is added.

- [ ] **Step 2: Document worker configuration**

Add to `README.md` the five `GROUP_AUTOMATION_*` environment variables, defaults selected in Task 8, Beijing-time behavior, WorkTool `atList` requirement, no-polling semantics, and operational statuses including `delivery_unknown`.

- [ ] **Step 3: Run targeted feature tests**

Run:

```bash
node --test \
  tests/group-automation-schedule.test.js \
  tests/group-summary-template.test.js \
  tests/db-group-automation.test.js \
  tests/db-group-ledger.test.js \
  tests/group-automation-agent.test.js \
  tests/group-automation-worker.test.js \
  tests/group-automation-stream.test.js \
  tests/server-group-automation-boundary.test.js \
  tests/console-group-automation-boundary.test.js \
  tests/worktool-mentions.test.js
```

Expected: all feature tests PASS.

- [ ] **Step 4: Run syntax and whitespace verification**

Run:

```bash
node --check src/group-automation-schedule.js
node --check src/group-summary-template.js
node --check src/group-automation-agent.js
node --check src/group-automation-worker.js
node --check src/group-automation-stream.js
node --check src/server.js
node --check public/console/group-automation-client.js
node --check public/console/app.js
git diff --check
```

Expected: every command exits 0 with no output from `git diff --check`.

- [ ] **Step 5: Run the complete test suite**

Run: `npm test`

Expected: all repository tests PASS with zero failures, cancellations, or skipped feature tests.

- [ ] **Step 6: Audit every design acceptance criterion against code and tests**

Read `docs/superpowers/specs/2026-08-04-group-scheduled-automation-design.md` acceptance items 1—28. For each item, identify the production implementation and at least one test assertion. Add a missing test or implementation before proceeding if any item lacks direct evidence.

- [ ] **Step 7: Commit hardening and documentation**

```bash
git add README.md tests/server-group-automation-boundary.test.js tests/group-automation-worker.test.js tests/db-group-ledger.test.js tests/console-group-automation-boundary.test.js
git commit -m "test: harden group scheduled automation"
```

---

## Completion Gate

The implementation is complete only when:

1. every checkbox above is completed in order with observed RED and GREEN evidence;
2. the working tree contains no unrelated or uncommitted changes;
3. all 28 design acceptance criteria have direct implementation and test evidence;
4. `npm test`, syntax checks, and `git diff --check` pass after the final commit;
5. the final result is reviewed using `superpowers:requesting-code-review`;
6. verification is repeated under `superpowers:verification-before-completion` before any success or push claim.
