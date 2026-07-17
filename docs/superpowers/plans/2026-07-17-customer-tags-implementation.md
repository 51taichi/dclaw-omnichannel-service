# Customer Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Agent-owned customer tag system with LLM-suggested tag decisions, service-side adjudication, conversation filtering, and tag-triggered follow-up tasks.

**Architecture:** Add a focused pure rules module (`src/tags.js`) for schema normalization and decision adjudication, then persist schemas/states/events/tasks in SQLite through `src/db.js`. Extend the DClaw request/response contract in `src/dclaw.js`, integrate accepted tag changes and tag activation scheduling in `src/server.js`, and add a new console 标签 tab plus conversation tag display/filtering in `public/console`.

**Tech Stack:** Node.js ESM, Express, `node:sqlite` DatabaseSync, `node:test`, vanilla HTML/CSS/JS console.

## Global Constraints

- 标签配置、标签组、触发任务模板归属 `agentId`。
- 客户标签状态、标签变更记录、标签触发任务按 `botId + agentId + conversationKey` 隔离。
- 日期标签是服务端系统标签，不属于任何标签组，不允许 Agent 修改。
- Agent 只返回 `tagDecision` 建议；服务端必须做最终裁决。
- 互斥递进标签组只允许按标签排序单向前进，不允许回退。
- 非互斥标签组可以同时存在多个标签。
- 标签任务跟随标签状态；标签失效时取消未发送任务。
- 第一版不做复杂标签报表，不做客户批量改标签，不做关键词匹配引擎。
- 不引入新的 npm 依赖。
- 不提交当前工作区已有的 Mindspace demo 未提交文件。

---

## File Structure

- Create `src/tags.js`: pure functions for tag schema normalization, Agent rule compaction, tag decision normalization, and state transition adjudication.
- Modify `src/db.js`: add tag tables and persistence helpers for schemas, conversation tags, tag events, and tag activation tasks.
- Modify `src/dclaw.js`: include `tagRules` in customer requests, include `tagDecision` in response schemas and parsed replies, and include tag context in retry prompts.
- Modify `src/server.js`: build tag context, apply tag decisions, schedule/cancel tag activation tasks, run tag activation worker, expose tag API routes.
- Modify `public/console/index.html`: add 标签 workspace tab and controls; add tag filter controls to 会话 tab.
- Modify `public/console/app.js`: add tag schema editor, import/export, tag filters, chat tag display, and API calls.
- Modify `public/console/styles.css`: add tag editor, chips, filters, and compact conversation tag styles.
- Create tests:
  - `tests/tags.test.js`
  - `tests/db-tags.test.js`
  - `tests/dclaw-tags.test.js`
  - `tests/server-tags-boundary.test.js`
  - `tests/console-tags-boundary.test.js`

---

### Task 1: Pure Tag Rules Module

**Files:**
- Create: `src/tags.js`
- Create: `tests/tags.test.js`

**Interfaces:**
- Produces:
  - `normalizeTagSchema(raw: object): object`
  - `compactTagRulesForAgent({ schema, currentTags }): object | null`
  - `normalizeTagDecision(raw: object): { add: Array, remove: Array }`
  - `adjudicateTagDecision({ schema, currentTags, decision }): { nextTags, accepted, rejected }`
  - `dateTagIdFor(date: Date | string): string`
- Consumes: no project state, only plain objects.

- [ ] **Step 1: Write failing tests for normalization and date tag**

Create `tests/tags.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  dateTagIdFor,
  normalizeTagSchema,
  compactTagRulesForAgent
} from "../src/tags.js";

test("dateTagIdFor formats server date tags as yyyymmdd", () => {
  assert.equal(dateTagIdFor("2026-07-17T03:04:05.000Z"), "20260717");
});

test("normalizeTagSchema keeps enabled groups and normalizes activation messages", () => {
  const schema = normalizeTagSchema({
    dateTag: { enabled: true },
    groups: [
      {
        id: "intent",
        name: "意向",
        enabled: true,
        exclusive: true,
        oneWay: true,
        tags: [
          {
            id: "c",
            name: "C类",
            condition: "泛泛了解",
            activation: {
              enabled: true,
              polishByAgent: false,
              messages: [{ content: "还在吗", intervalMinutes: 2, maxTimes: 1 }]
            }
          }
        ]
      }
    ]
  });

  assert.equal(schema.dateTag.enabled, true);
  assert.equal(schema.groups[0].id, "intent");
  assert.equal(schema.groups[0].tags[0].activation.messages[0].intervalMinutes, 2);
  assert.equal(schema.groups[0].tags[0].activation.polishByAgent, false);
});

test("compactTagRulesForAgent removes activation payload and includes current tags", () => {
  const schema = normalizeTagSchema({
    groups: [
      {
        id: "intent",
        name: "意向",
        enabled: true,
        exclusive: true,
        oneWay: true,
        tags: [{ id: "b", name: "B类", condition: "询问细节" }]
      }
    ]
  });

  const rules = compactTagRulesForAgent({
    schema,
    currentTags: [{ groupId: "intent", tagId: "b", name: "B类" }]
  });

  assert.equal(rules.groups[0].tags[0].condition, "询问细节");
  assert.equal(rules.groups[0].tags[0].activation, undefined);
  assert.equal(rules.currentTags[0].tagId, "b");
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
node --test tests/tags.test.js
```

Expected: FAIL with `Cannot find module '../src/tags.js'`.

- [ ] **Step 3: Implement schema normalization**

Create `src/tags.js`:

```js
export function dateTagIdFor(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function asId(value) {
  return String(value || "").trim();
}

function normalizeActivationMessage(raw = {}) {
  const source = typeof raw === "string" ? { content: raw } : raw || {};
  const content = String(source.content || "").trim();
  if (!content) return null;
  return {
    content,
    intervalMinutes: Math.max(1, Number.parseInt(source.intervalMinutes ?? 30, 10) || 30),
    maxTimes: Math.max(1, Number.parseInt(source.maxTimes ?? 1, 10) || 1)
  };
}

export function normalizeTagActivation(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const messages = Array.isArray(source.messages)
    ? source.messages.map(normalizeActivationMessage).filter(Boolean)
    : [];
  return {
    enabled: Boolean(source.enabled),
    polishByAgent: source.polishByAgent !== false,
    messages
  };
}

export function normalizeTagSchema(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const groups = Array.isArray(source.groups)
    ? source.groups.map((group, groupIndex) => {
        const groupId = asId(group.id || `group_${groupIndex + 1}`);
        const tags = Array.isArray(group.tags)
          ? group.tags.map((tag, tagIndex) => {
              const tagId = asId(tag.id || `tag_${tagIndex + 1}`);
              return {
                id: tagId,
                name: String(tag.name || tagId).trim(),
                condition: String(tag.condition || "").trim(),
                order: tagIndex,
                enabled: tag.enabled !== false,
                activation: normalizeTagActivation(tag.activation || {})
              };
            }).filter((tag) => tag.id && tag.enabled)
          : [];
        return {
          id: groupId,
          name: String(group.name || groupId).trim(),
          enabled: group.enabled !== false,
          exclusive: group.exclusive !== false,
          oneWay: Boolean(group.oneWay),
          tags
        };
      }).filter((group) => group.id && group.enabled && group.tags.length)
    : [];
  return {
    version: String(source.version || "1.0.0"),
    dateTag: { enabled: Boolean(source.dateTag?.enabled) },
    groups
  };
}

export function compactTagRulesForAgent({ schema, currentTags = [] }) {
  const normalized = normalizeTagSchema(schema);
  if (!normalized.dateTag.enabled && !normalized.groups.length) return null;
  return {
    dateTagEnabled: normalized.dateTag.enabled,
    groups: normalized.groups.map((group) => ({
      id: group.id,
      name: group.name,
      exclusive: group.exclusive,
      oneWay: group.oneWay,
      tags: group.tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        condition: tag.condition
      }))
    })),
    currentTags: Array.isArray(currentTags) ? currentTags : []
  };
}
```

- [ ] **Step 4: Run tests and verify normalization passes**

Run:

```bash
node --test tests/tags.test.js
```

Expected: PASS for the three tests.

- [ ] **Step 5: Write failing tests for adjudication**

Append to `tests/tags.test.js`:

```js
import {
  adjudicateTagDecision,
  normalizeTagDecision
} from "../src/tags.js";

test("adjudicateTagDecision allows one-way exclusive upgrade and cancels old tag", () => {
  const schema = normalizeTagSchema({
    groups: [{
      id: "intent",
      name: "意向",
      exclusive: true,
      oneWay: true,
      tags: [
        { id: "c", name: "C类", condition: "了解" },
        { id: "b", name: "B类", condition: "询问" },
        { id: "a", name: "A类", condition: "强意向" }
      ]
    }]
  });

  const result = adjudicateTagDecision({
    schema,
    currentTags: [{ groupId: "intent", tagId: "c", name: "C类" }],
    decision: normalizeTagDecision({ add: [{ groupId: "intent", tagId: "b", reason: "询问细节" }] })
  });

  assert.deepEqual(result.nextTags.map((tag) => tag.tagId), ["b"]);
  assert.equal(result.accepted[0].action, "replace");
  assert.equal(result.accepted[0].oldTagIds[0], "c");
});

test("adjudicateTagDecision rejects one-way exclusive rollback", () => {
  const schema = normalizeTagSchema({
    groups: [{
      id: "intent",
      name: "意向",
      exclusive: true,
      oneWay: true,
      tags: [
        { id: "c", name: "C类", condition: "了解" },
        { id: "b", name: "B类", condition: "询问" },
        { id: "a", name: "A类", condition: "强意向" }
      ]
    }]
  });

  const result = adjudicateTagDecision({
    schema,
    currentTags: [{ groupId: "intent", tagId: "a", name: "A类" }],
    decision: normalizeTagDecision({ add: [{ groupId: "intent", tagId: "b", reason: "回退判断" }] })
  });

  assert.deepEqual(result.nextTags.map((tag) => tag.tagId), ["a"]);
  assert.equal(result.rejected[0].reason, "one_way_regression");
});

test("adjudicateTagDecision keeps non-exclusive tags together", () => {
  const schema = normalizeTagSchema({
    groups: [{
      id: "interest",
      name: "兴趣",
      exclusive: false,
      tags: [
        { id: "video", name: "想看视频", condition: "要视频" },
        { id: "price", name: "关注价格", condition: "问价格" }
      ]
    }]
  });

  const result = adjudicateTagDecision({
    schema,
    currentTags: [{ groupId: "interest", tagId: "video", name: "想看视频" }],
    decision: normalizeTagDecision({ add: [{ groupId: "interest", tagId: "price", reason: "问价格" }] })
  });

  assert.deepEqual(result.nextTags.map((tag) => tag.tagId).sort(), ["price", "video"]);
});
```

- [ ] **Step 6: Run tests and verify adjudication fails**

Run:

```bash
node --test tests/tags.test.js
```

Expected: FAIL with `does not provide an export named 'adjudicateTagDecision'`.

- [ ] **Step 7: Implement decision normalization and adjudication**

Append to `src/tags.js`:

```js
function normalizeAction(item = {}) {
  const groupId = asId(item.groupId || item.group_id);
  const tagId = asId(item.tagId || item.tag_id);
  if (!groupId || !tagId) return null;
  return {
    groupId,
    tagId,
    reason: String(item.reason || "").trim()
  };
}

export function normalizeTagDecision(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    add: Array.isArray(source.add) ? source.add.map(normalizeAction).filter(Boolean) : [],
    remove: Array.isArray(source.remove) ? source.remove.map(normalizeAction).filter(Boolean) : []
  };
}

function tagKey(tag) {
  return `${tag.groupId}:${tag.tagId}`;
}

function findGroup(schema, groupId) {
  return schema.groups.find((group) => group.id === groupId) || null;
}

function findTag(group, tagId) {
  return group?.tags.find((tag) => tag.id === tagId) || null;
}

function currentGroupTags(currentTags, groupId) {
  return currentTags.filter((tag) => tag.groupId === groupId);
}

export function adjudicateTagDecision({ schema, currentTags = [], decision = {} }) {
  const normalizedSchema = normalizeTagSchema(schema);
  const normalizedDecision = normalizeTagDecision(decision);
  const next = new Map(
    (Array.isArray(currentTags) ? currentTags : [])
      .filter((tag) => tag?.groupId && tag?.tagId)
      .map((tag) => [tagKey(tag), { ...tag }])
  );
  const accepted = [];
  const rejected = [];

  for (const action of normalizedDecision.remove) {
    const group = findGroup(normalizedSchema, action.groupId);
    const tag = findTag(group, action.tagId);
    if (!group || !tag) {
      rejected.push({ ...action, action: "remove", reason: "unknown_tag" });
      continue;
    }
    if (group.exclusive) {
      rejected.push({ ...action, action: "remove", reason: "exclusive_remove_not_allowed" });
      continue;
    }
    const key = tagKey(action);
    if (next.delete(key)) {
      accepted.push({ ...action, action: "remove", oldTagIds: [action.tagId], newTagIds: [] });
    }
  }

  for (const action of normalizedDecision.add) {
    const group = findGroup(normalizedSchema, action.groupId);
    const tag = findTag(group, action.tagId);
    if (!group || !tag) {
      rejected.push({ ...action, action: "add", reason: "unknown_tag" });
      continue;
    }
    const existing = currentGroupTags([...next.values()], group.id);
    if (group.exclusive) {
      const current = existing[0] || null;
      if (current?.tagId === tag.id) continue;
      if (group.oneWay && current) {
        const currentTag = findTag(group, current.tagId);
        if (currentTag && tag.order < currentTag.order) {
          rejected.push({ ...action, action: "add", reason: "one_way_regression" });
          continue;
        }
      }
      for (const old of existing) next.delete(tagKey(old));
      next.set(`${group.id}:${tag.id}`, {
        groupId: group.id,
        groupName: group.name,
        tagId: tag.id,
        tagName: tag.name,
        name: tag.name,
        reason: action.reason
      });
      accepted.push({
        ...action,
        action: existing.length ? "replace" : "add",
        oldTagIds: existing.map((item) => item.tagId),
        newTagIds: [tag.id]
      });
    } else {
      const key = `${group.id}:${tag.id}`;
      if (next.has(key)) continue;
      next.set(key, {
        groupId: group.id,
        groupName: group.name,
        tagId: tag.id,
        tagName: tag.name,
        name: tag.name,
        reason: action.reason
      });
      accepted.push({ ...action, action: "add", oldTagIds: [], newTagIds: [tag.id] });
    }
  }

  return {
    nextTags: [...next.values()],
    accepted,
    rejected
  };
}
```

- [ ] **Step 8: Run tests and commit**

Run:

```bash
node --test tests/tags.test.js
```

Expected: PASS.

Commit:

```bash
git add src/tags.js tests/tags.test.js
git commit -m "Add customer tag rule engine"
```

---

### Task 2: SQLite Persistence for Tag Schemas, States, Events, and Tasks

**Files:**
- Modify: `src/db.js`
- Create: `tests/db-tags.test.js`

**Interfaces:**
- Consumes from Task 1: `normalizeTagSchema`, `normalizeTagActivation`
- Produces:
  - `getAgentTagSchema(agentId)`
  - `upsertAgentTagSchema({ agentId, schema })`
  - `listConversationTags({ botId, agentId, conversationKey })`
  - `applyConversationTagChanges({ botId, agentId, conversationKey, accepted, nextTags, source })`
  - `cancelTagActivationTasks({ botId, agentId, conversationKey, groupId, tagId, reason })`
  - `scheduleTagActivationTask({...})`
  - `claimDueTagActivationTasks({ limit, nowIso, staleBeforeIso })`
  - `markTagActivationTaskSent({ id, worktoolMessageIds })`
  - `markTagActivationTaskFailed({ id, error })`
  - `listTagActivationTasks({ conversationKey, limit })`

- [ ] **Step 1: Write failing persistence tests**

Create `tests/db-tags.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyConversationTagChanges,
  cancelTagActivationTasks,
  claimDueTagActivationTasks,
  getAgentTagSchema,
  listConversationTags,
  listTagActivationTasks,
  markTagActivationTaskFailed,
  markTagActivationTaskSent,
  scheduleTagActivationTask,
  upsertAgentTagSchema
} from "../src/db.js";

test("agent tag schemas are stored by agent id", () => {
  const schema = upsertAgentTagSchema({
    agentId: "tag_agent_a",
    schema: {
      dateTag: { enabled: true },
      groups: [{ id: "intent", name: "意向", tags: [{ id: "a", name: "A类", condition: "强意向" }] }]
    }
  });

  assert.equal(schema.agentId, "tag_agent_a");
  assert.equal(getAgentTagSchema("tag_agent_a").config.groups[0].id, "intent");
  assert.equal(getAgentTagSchema("missing_agent"), null);
});

test("conversation tags are isolated by bot agent and conversation", () => {
  applyConversationTagChanges({
    botId: "tag_bot_a",
    agentId: "tag_agent_a",
    conversationKey: "tag_bot_a:private:张三",
    accepted: [{ action: "add", groupId: "intent", tagId: "a", reason: "强意向", oldTagIds: [], newTagIds: ["a"] }],
    nextTags: [{ groupId: "intent", groupName: "意向", tagId: "a", tagName: "A类", reason: "强意向" }],
    source: "agent_decision"
  });

  assert.equal(listConversationTags({
    botId: "tag_bot_a",
    agentId: "tag_agent_a",
    conversationKey: "tag_bot_a:private:张三"
  })[0].tagId, "a");
  assert.deepEqual(listConversationTags({
    botId: "tag_bot_a",
    agentId: "other_agent",
    conversationKey: "tag_bot_a:private:张三"
  }), []);
});

test("tag activation tasks can be scheduled claimed and finalized", () => {
  const task = scheduleTagActivationTask({
    botId: "tag_bot_a",
    agentId: "tag_agent_a",
    conversationKey: "tag_bot_a:private:张三",
    groupId: "intent",
    tagId: "a",
    activation: {
      enabled: true,
      polishByAgent: false,
      messages: [{ content: "还想了解吗", intervalMinutes: 1, maxTimes: 1 }]
    },
    dueAt: "2026-07-17T00:00:00.000Z",
    attemptNumber: 1,
    messageIndex: 0
  });

  assert.equal(task.status, "pending");
  const claimed = claimDueTagActivationTasks({ nowIso: "2026-07-17T00:00:01.000Z", limit: 5 });
  assert.equal(claimed.some((item) => item.id === task.id), true);
  const sent = markTagActivationTaskSent({ id: task.id, worktoolMessageIds: ["msg_1"] });
  assert.equal(sent.status, "sent");
});

test("cancelTagActivationTasks cancels pending tag work", () => {
  const task = scheduleTagActivationTask({
    botId: "tag_bot_b",
    agentId: "tag_agent_b",
    conversationKey: "tag_bot_b:private:李四",
    groupId: "intent",
    tagId: "b",
    activation: {
      enabled: true,
      polishByAgent: false,
      messages: [{ content: "继续了解吗", intervalMinutes: 1, maxTimes: 1 }]
    },
    dueAt: "2026-07-17T00:00:00.000Z"
  });

  cancelTagActivationTasks({
    botId: "tag_bot_b",
    agentId: "tag_agent_b",
    conversationKey: "tag_bot_b:private:李四",
    groupId: "intent",
    tagId: "b",
    reason: "tag_removed"
  });

  assert.equal(listTagActivationTasks({ conversationKey: "tag_bot_b:private:李四" }).find((item) => item.id === task.id).status, "canceled");
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
node --test tests/db-tags.test.js
```

Expected: FAIL with missing exports from `src/db.js`.

- [ ] **Step 3: Add SQLite tables**

Modify the `db.exec` schema block in `src/db.js` after `flow_activation_tasks`:

```sql
  CREATE TABLE IF NOT EXISTS agent_tag_schemas (
    agent_id TEXT PRIMARY KEY,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversation_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    group_id TEXT,
    group_name TEXT,
    tag_id TEXT NOT NULL,
    tag_name TEXT NOT NULL,
    tag_type TEXT NOT NULL DEFAULT 'normal',
    reason TEXT,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(bot_id, agent_id, conversation_key, tag_type, group_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS conversation_tag_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    event_type TEXT NOT NULL,
    group_id TEXT,
    tag_id TEXT,
    accepted INTEGER NOT NULL DEFAULT 1,
    reason TEXT,
    source TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tag_activation_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    group_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    message_index INTEGER NOT NULL DEFAULT 0,
    message_content TEXT NOT NULL,
    max_times INTEGER NOT NULL DEFAULT 1,
    interval_minutes INTEGER NOT NULL DEFAULT 30,
    polish_by_agent INTEGER NOT NULL DEFAULT 1,
    messages_json TEXT NOT NULL,
    status TEXT NOT NULL,
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
```

- [ ] **Step 4: Add row mappers and schema functions**

Import tag helpers near the top of `src/db.js`:

```js
import { normalizeTagActivation, normalizeTagSchema } from "./tags.js";
```

Add mapper functions near existing `rowToFlowActivationTask` helpers:

```js
function rowToAgentTagSchema(row) {
  if (!row) return null;
  return {
    agentId: row.agent_id,
    config: parseJson(row.config_json) || { dateTag: { enabled: false }, groups: [] },
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToConversationTag(row) {
  if (!row) return null;
  return {
    id: row.id,
    botId: row.bot_id,
    agentId: row.agent_id,
    conversationKey: row.conversation_key,
    groupId: row.group_id || "",
    groupName: row.group_name || "",
    tagId: row.tag_id,
    tagName: row.tag_name,
    tagType: row.tag_type,
    reason: row.reason || "",
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToTagActivationTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    botId: row.bot_id,
    agentId: row.agent_id,
    conversationKey: row.conversation_key,
    groupId: row.group_id,
    tagId: row.tag_id,
    attemptNumber: row.attempt_number,
    messageIndex: row.message_index,
    messageContent: row.message_content,
    maxTimes: row.max_times,
    intervalMinutes: row.interval_minutes,
    polishByAgent: Boolean(row.polish_by_agent),
    messages: parseJson(row.messages_json) || [],
    status: row.status,
    dueAt: row.due_at,
    sentAt: row.sent_at,
    canceledAt: row.canceled_at,
    cancelReason: row.cancel_reason || "",
    errorMessage: row.error_message || "",
    worktoolMessageIds: parseJson(row.worktool_message_ids_json) || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
```

Add schema functions:

```js
export function getAgentTagSchema(agentId) {
  return rowToAgentTagSchema(
    db.prepare("SELECT * FROM agent_tag_schemas WHERE agent_id = ?").get(agentId)
  );
}

export function upsertAgentTagSchema({ agentId, schema }) {
  const normalized = normalizeTagSchema(schema);
  const timestamp = now();
  db.prepare(`
    INSERT INTO agent_tag_schemas (agent_id, config_json, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      config_json = excluded.config_json,
      updated_at = excluded.updated_at
  `).run(agentId, json(normalized), timestamp, timestamp);
  return getAgentTagSchema(agentId);
}
```

- [ ] **Step 5: Add state, event, and task functions**

Add below flow activation helpers in `src/db.js`:

```js
export function listConversationTags({ botId, agentId, conversationKey }) {
  return db.prepare(`
    SELECT *
    FROM conversation_tags
    WHERE bot_id = ?
      AND agent_id = ?
      AND conversation_key = ?
    ORDER BY tag_type ASC, group_id ASC, tag_id ASC
  `).all(botId, agentId, conversationKey).map(rowToConversationTag);
}

export function applyConversationTagChanges({
  botId,
  agentId,
  conversationKey,
  accepted = [],
  rejected = [],
  nextTags = [],
  source = "agent_decision"
}) {
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      DELETE FROM conversation_tags
      WHERE bot_id = ?
        AND agent_id = ?
        AND conversation_key = ?
        AND tag_type = 'normal'
    `).run(botId, agentId, conversationKey);
    for (const tag of nextTags) {
      db.prepare(`
        INSERT INTO conversation_tags (
          bot_id, agent_id, conversation_key, group_id, group_name, tag_id, tag_name,
          tag_type, reason, source, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'normal', ?, ?, ?, ?)
      `).run(
        botId,
        agentId,
        conversationKey,
        tag.groupId || "",
        tag.groupName || "",
        tag.tagId,
        tag.tagName || tag.name || tag.tagId,
        tag.reason || "",
        source,
        timestamp,
        timestamp
      );
    }
    for (const event of [...accepted, ...rejected]) {
      db.prepare(`
        INSERT INTO conversation_tag_events (
          bot_id, agent_id, conversation_key, event_type, group_id, tag_id,
          accepted, reason, source, payload_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        botId,
        agentId,
        conversationKey,
        event.action || "tag_decision",
        event.groupId || "",
        event.tagId || "",
        accepted.includes(event) ? 1 : 0,
        event.reason || "",
        source,
        json(event),
        timestamp
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return listConversationTags({ botId, agentId, conversationKey });
}

export function scheduleTagActivationTask({
  botId,
  agentId,
  conversationKey,
  groupId,
  tagId,
  activation,
  dueAt,
  attemptNumber = 1,
  messageIndex = 0
}) {
  const config = normalizeTagActivation(activation);
  const normalizedMessageIndex = Math.max(0, Number.parseInt(messageIndex, 10) || 0);
  const message = config.messages[normalizedMessageIndex] || null;
  const timestamp = now();
  const result = db.prepare(`
    INSERT INTO tag_activation_tasks (
      bot_id, agent_id, conversation_key, group_id, tag_id, attempt_number,
      message_index, message_content, max_times, interval_minutes, polish_by_agent,
      messages_json, status, due_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(
    botId,
    agentId,
    conversationKey,
    groupId,
    tagId,
    Math.max(1, Number.parseInt(attemptNumber, 10) || 1),
    normalizedMessageIndex,
    message?.content || "",
    message?.maxTimes || 1,
    message?.intervalMinutes || 30,
    config.polishByAgent ? 1 : 0,
    json(config.messages),
    dueAt || timestamp,
    timestamp,
    timestamp
  );
  return rowToTagActivationTask(
    db.prepare("SELECT * FROM tag_activation_tasks WHERE id = ?").get(result.lastInsertRowid)
  );
}
```

Add claim/cancel/finalize helpers by copying the flow activation structure and replacing table/mapper names:

```js
export function claimDueTagActivationTasks({ limit = 20, nowIso = now(), staleBeforeIso = "" } = {}) {
  const timestamp = now();
  if (staleBeforeIso) {
    db.prepare(`
      UPDATE tag_activation_tasks
      SET status = 'pending', processing_started_at = NULL, updated_at = ?
      WHERE status = 'processing' AND processing_started_at < ?
    `).run(timestamp, staleBeforeIso);
  }
  const rows = db.prepare(`
    SELECT *
    FROM tag_activation_tasks
    WHERE status = 'pending'
      AND due_at <= ?
    ORDER BY due_at ASC, id ASC
    LIMIT ?
  `).all(nowIso, Math.max(1, Number.parseInt(limit, 10) || 20));
  const claimed = [];
  for (const row of rows) {
    const result = db.prepare(`
      UPDATE tag_activation_tasks
      SET status = 'processing', processing_started_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(timestamp, timestamp, row.id);
    if (result.changes > 0) {
      claimed.push(rowToTagActivationTask(db.prepare("SELECT * FROM tag_activation_tasks WHERE id = ?").get(row.id)));
    }
  }
  return claimed;
}

export function cancelTagActivationTasks({ botId, agentId, conversationKey, groupId = "", tagId = "", reason = "" }) {
  const timestamp = now();
  const clauses = ["bot_id = ?", "agent_id = ?", "conversation_key = ?", "status IN ('pending', 'processing')"];
  const params = [botId, agentId, conversationKey];
  if (groupId) {
    clauses.push("group_id = ?");
    params.push(groupId);
  }
  if (tagId) {
    clauses.push("tag_id = ?");
    params.push(tagId);
  }
  return db.prepare(`
    UPDATE tag_activation_tasks
    SET status = 'canceled', canceled_at = ?, cancel_reason = ?, updated_at = ?
    WHERE ${clauses.join(" AND ")}
  `).run(timestamp, reason || "", timestamp, ...params).changes;
}

export function markTagActivationTaskSent({ id, worktoolMessageIds = [] }) {
  const timestamp = now();
  const result = db.prepare(`
    UPDATE tag_activation_tasks
    SET status = 'sent', sent_at = ?, error_message = '', worktool_message_ids_json = ?, updated_at = ?
    WHERE id = ? AND status = 'processing'
  `).run(timestamp, json(worktoolMessageIds), timestamp, id);
  if (result.changes === 0) return null;
  return rowToTagActivationTask(db.prepare("SELECT * FROM tag_activation_tasks WHERE id = ?").get(id));
}

export function markTagActivationTaskFailed({ id, error = "" }) {
  const timestamp = now();
  const result = db.prepare(`
    UPDATE tag_activation_tasks
    SET status = 'failed', error_message = ?, updated_at = ?
    WHERE id = ? AND status = 'processing'
  `).run(String(error || ""), timestamp, id);
  if (result.changes === 0) return null;
  return rowToTagActivationTask(db.prepare("SELECT * FROM tag_activation_tasks WHERE id = ?").get(id));
}

export function listTagActivationTasks({ conversationKey = "", limit = 100 } = {}) {
  const normalizedLimit = Math.max(1, Number.parseInt(limit, 10) || 100);
  const rows = conversationKey
    ? db.prepare("SELECT * FROM tag_activation_tasks WHERE conversation_key = ? ORDER BY id ASC LIMIT ?").all(conversationKey, normalizedLimit)
    : db.prepare("SELECT * FROM tag_activation_tasks ORDER BY id ASC LIMIT ?").all(normalizedLimit);
  return rows.map(rowToTagActivationTask);
}
```

- [ ] **Step 6: Add log visibility**

In `listRecords` allowed map, add:

```js
"tag-activation-tasks": {
  table: "tag_activation_tasks",
  mapper: rowToTagActivationTask
},
"conversation-tags": {
  table: "conversation_tags",
  mapper: rowToConversationTag
},
"conversation-tag-events": {
  table: "conversation_tag_events",
  mapper: (row) => ({ ...row, payload: parseJson(row.payload_json) })
}
```

- [ ] **Step 7: Run tests and commit**

Run:

```bash
node --test tests/db-tags.test.js
node --test tests/tags.test.js
```

Expected: PASS.

Commit:

```bash
git add src/db.js tests/db-tags.test.js
git commit -m "Persist customer tag schemas and tasks"
```

---

### Task 3: DClaw Agent Contract for Tag Decisions

**Files:**
- Modify: `src/dclaw.js`
- Create: `tests/dclaw-tags.test.js`

**Interfaces:**
- Consumes: `tagContext` object from server with compact rules.
- Produces: parsed `agentReply.tagDecision`.

- [ ] **Step 1: Write failing DClaw contract tests**

Create `tests/dclaw-tags.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDclawAttachmentSourceRetryRequest,
  buildDclawReplyFormatRetryRequest,
  buildDclawRequest,
  parseAgentReply
} from "../src/dclaw.js";

const binding = {
  botId: "tag_bot",
  agentId: "tag_agent",
  agentApiUrl: "https://dclaw.example.test/api/open/v1/targets/tag_agent/messages",
  agentApiKey: ""
};

const conversation = {
  conversationKey: "tag_bot:private:魔兮"
};

const message = {
  roomType: 2,
  spoken: "我想了解",
  rawSpoken: "我想了解",
  receivedName: "魔兮",
  textType: 1
};

test("buildDclawRequest includes tag rules in message and metadata", () => {
  const request = buildDclawRequest({
    binding,
    conversation,
    message,
    tagContext: {
      dateTagEnabled: true,
      groups: [{ id: "intent", name: "意向", exclusive: true, oneWay: true, tags: [{ id: "b", name: "B类", condition: "询问细节" }] }],
      currentTags: []
    }
  });

  assert.match(request.message, /tagRules/);
  assert.match(request.message, /tagDecision/);
  assert.equal(request.metadata.tagRules.groups[0].id, "intent");
});

test("parseAgentReply extracts tagDecision", () => {
  const reply = parseAgentReply(JSON.stringify({
    reply: "可以",
    attachments: [],
    sources: [],
    tagDecision: { add: [{ groupId: "intent", tagId: "b", reason: "询问细节" }], remove: [] }
  }));

  assert.equal(reply.valid, true);
  assert.equal(reply.tagDecision.add[0].tagId, "b");
});

test("retry prompts preserve tagDecision schema", () => {
  const request = buildDclawRequest({ binding, conversation, message, tagContext: { groups: [], currentTags: [] } });
  assert.match(buildDclawReplyFormatRetryRequest(request).message, /tagDecision/);
  assert.match(buildDclawAttachmentSourceRetryRequest(request, {}).message, /tagDecision/);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
node --test tests/dclaw-tags.test.js
```

Expected: FAIL because `tagContext` is ignored and `tagDecision` is missing.

- [ ] **Step 3: Extend request builder**

Modify `buildDclawRequest` signature in `src/dclaw.js`:

```js
export function buildDclawRequest({
  binding,
  conversation,
  message,
  flow = null,
  tagContext = null,
  conversationReset = false
}) {
```

After `const agentFlow = compactFlowForAgent(flow);`, add:

```js
  const agentTagRules = tagContext && typeof tagContext === "object" ? tagContext : null;
```

Add instructions:

```js
  if (agentTagRules) {
    instructions.push(
      "本次请求包含 tagRules。请根据客户当前表达判断是否满足标签条件，并在最终 JSON 中通过 tagDecision 给出建议。",
      "tagDecision 只是建议，服务端会最终裁决；不要在 reply 中解释标签规则。",
      "tagDecision 格式：{\"add\":[{\"groupId\":\"标签组ID\",\"tagId\":\"标签ID\",\"reason\":\"命中原因\"}],\"remove\":[]}。没有变化时使用 {\"add\":[],\"remove\":[]}。"
    );
  }
```

Update JSON payload:

```js
      JSON.stringify({
        worktoolMessage,
        flow: agentFlow,
        tagRules: agentTagRules,
        conversationReset
      }, null, 2)
```

Update metadata:

```js
      tagRules: agentTagRules,
```

- [ ] **Step 4: Extend schema strings in normal and retry prompts**

Add helper:

```js
function responseSchemaForRequest({ hasFlow, hasTags }) {
  const tagPart = hasTags ? ",\"tagDecision\":{\"add\":[],\"remove\":[]}" : "";
  return hasFlow
    ? `{"reply":"发给客户的文本","attachments":[],"sources":[],"flowDecision":{"currentNodeId":"当前节点ID","nextNodeId":"建议下一节点ID或当前节点ID","nodeCompleted":false,"confidence":0.0,"reason":"判断原因","collectedDataPatch":{}}${tagPart}}`
    : `{"reply":"发给客户的文本","attachments":[],"sources":[]${tagPart}}`;
}
```

Use it in `buildDclawRequest`, `buildDclawReplyFormatRetryRequest`, and `buildDclawAttachmentSourceRetryRequest`:

```js
const responseSchema = responseSchemaForRequest({
  hasFlow: Boolean(request?.metadata?.flow),
  hasTags: Boolean(request?.metadata?.tagRules)
});
```

- [ ] **Step 5: Parse tag decisions**

Import in `src/dclaw.js`:

```js
import { normalizeTagDecision } from "./tags.js";
```

Add to valid `parseAgentReply` return:

```js
tagDecision: normalizeTagDecision(parsed.tagDecision || parsed.tags || {}),
```

Add to `invalidAgentReply` and `degradeAgentReply` returns:

```js
tagDecision: { add: [], remove: [] },
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
node --test tests/dclaw-tags.test.js tests/dclaw-request-sanitization.test.js tests/server-reply-contract.test.js
```

Expected: PASS.

Commit:

```bash
git add src/dclaw.js tests/dclaw-tags.test.js
git commit -m "Add tag decision contract to DClaw requests"
```

---

### Task 4: Server-Side Tag Context, Decision Application, and Date Tags

**Files:**
- Modify: `src/server.js`
- Modify: `src/db.js`
- Create: `tests/server-tags-boundary.test.js`

**Interfaces:**
- Consumes:
  - `getAgentTagSchema`
  - `listConversationTags`
  - `applyConversationTagChanges`
  - `cancelTagActivationTasks`
  - `adjudicateTagDecision`
  - `compactTagRulesForAgent`
- Produces:
  - tag context included in normal Agent calls.
  - accepted tag decisions persisted after valid Agent reply.
  - date tag persisted on friend-added event.

- [ ] **Step 1: Write boundary tests**

Create `tests/server-tags-boundary.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("incoming agent calls build and pass tag context", () => {
  assert.match(source, /buildTagContext/);
  assert.match(source, /tagContext/);
  assert.match(source, /buildDclawRequest\(\{[\s\S]*tagContext/);
});

test("server applies tag decisions only after valid agent replies", () => {
  const applyIndex = source.indexOf("applyAgentTagDecision");
  const validIndex = source.indexOf("if (!strictInvocation.agentReply.valid)");
  assert.ok(applyIndex > validIndex);
  assert.match(source, /agentReply\.tagDecision/);
});

test("friend-added event can create date tags", () => {
  assert.match(source, /applySystemDateTag/);
  assert.match(source, /friend_added\.date_tag\.applied/);
});

test("conversation reset and handoff cancel tag activation work", () => {
  assert.match(source, /cancelTagActivationTasks\(\{[\s\S]*reason: "human_handoff"/);
  assert.match(source, /cancelTagActivationTasks\(\{[\s\S]*reason: "conversation_reset"/);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
node --test tests/server-tags-boundary.test.js
```

Expected: FAIL because server functions are not present.

- [ ] **Step 3: Add date tag persistence helper in db**

Add to `src/db.js`:

```js
export function upsertSystemDateTag({ botId, agentId, conversationKey, dateTagId, source = "friend_added" }) {
  const timestamp = now();
  db.prepare(`
    INSERT INTO conversation_tags (
      bot_id, agent_id, conversation_key, group_id, group_name, tag_id, tag_name,
      tag_type, reason, source, created_at, updated_at
    )
    VALUES (?, ?, ?, '', '', ?, ?, 'date', ?, ?, ?, ?)
    ON CONFLICT(bot_id, agent_id, conversation_key, tag_type, group_id, tag_id)
    DO UPDATE SET updated_at = excluded.updated_at
  `).run(botId, agentId, conversationKey, dateTagId, dateTagId, "新增好友日期", source, timestamp, timestamp);
  return listConversationTags({ botId, agentId, conversationKey });
}
```

- [ ] **Step 4: Add server tag helpers**

Import at top of `src/server.js`:

```js
import {
  adjudicateTagDecision,
  compactTagRulesForAgent,
  dateTagIdFor,
  normalizeTagSchema
} from "./tags.js";
```

Import DB helpers:

```js
  applyConversationTagChanges,
  cancelTagActivationTasks,
  getAgentTagSchema,
  listConversationTags,
  upsertSystemDateTag
```

Add helper functions near flow helpers:

```js
function buildTagContext({ binding, conversationKey }) {
  if (!binding?.agentId) return null;
  const schemaRow = getAgentTagSchema(binding.agentId);
  const schema = normalizeTagSchema(schemaRow?.config || {});
  const currentTags = listConversationTags({
    botId: binding.botId,
    agentId: binding.agentId,
    conversationKey
  });
  return compactTagRulesForAgent({ schema, currentTags });
}

function applySystemDateTag({ botId, binding, conversationKey }) {
  const schema = normalizeTagSchema(getAgentTagSchema(binding?.agentId)?.config || {});
  if (!binding?.agentId || !schema.dateTag.enabled) return null;
  return upsertSystemDateTag({
    botId,
    agentId: binding.agentId,
    conversationKey,
    dateTagId: dateTagIdFor(new Date()),
    source: "friend_added"
  });
}

function applyAgentTagDecision({ botId, binding, conversationKey, agentReply }) {
  const schema = normalizeTagSchema(getAgentTagSchema(binding?.agentId)?.config || {});
  if (!binding?.agentId || !schema.groups.length) return null;
  const currentTags = listConversationTags({ botId, agentId: binding.agentId, conversationKey });
  const result = adjudicateTagDecision({
    schema,
    currentTags: currentTags.filter((tag) => tag.tagType !== "date"),
    decision: agentReply?.tagDecision || {}
  });
  if (!result.accepted.length && !result.rejected.length) return null;
  const tags = applyConversationTagChanges({
    botId,
    agentId: binding.agentId,
    conversationKey,
    accepted: result.accepted,
    rejected: result.rejected,
    nextTags: result.nextTags,
    source: "agent_decision"
  });
  return { tags, accepted: result.accepted, rejected: result.rejected };
}
```

- [ ] **Step 5: Wire tag context into normal requests**

In `processIncomingMessage`, before `buildDclawRequest`, add:

```js
  const tagContext = buildTagContext({ binding, conversationKey });
```

Pass it into request:

```js
  const request = buildDclawRequest({
    binding,
    conversation,
    message: agentMessage,
    flow,
    tagContext,
    conversationReset
  });
```

- [ ] **Step 6: Apply tag decision after valid reply**

After `const sources = ...` in the successful reply block, add:

```js
    const tagUpdate = applyAgentTagDecision({
      botId,
      binding,
      conversationKey,
      agentReply
    });
    if (tagUpdate) {
      logInfo("tag.decision.applied", {
        ...logContext,
        agentId: binding.agentId,
        invocationId,
      tagCount: tagUpdate.tags.length
      });
    }
```

Include tags in outbound raw payloads:

```js
tags: tagUpdate?.tags || listConversationTags({ botId, agentId: binding.agentId, conversationKey }),
tagDecision: agentReply.tagDecision,
```

- [ ] **Step 7: Apply date tag on friend-added**

Inside `handleFriendAddedEvent` after durable conversation key is resolved and before scheduling activation, add:

```js
  const dateTags = applySystemDateTag({ botId, binding, conversationKey });
  if (dateTags) {
    logInfo("friend_added.date_tag.applied", {
      ...logContext,
      conversationKey,
      agentId: binding.agentId,
      tagCount: dateTags.length
    });
  }
```

- [ ] **Step 8: Cancel tag tasks on handoff and reset**

Where human handoff cancels flow activation, add:

```js
      cancelTagActivationTasks({
        botId,
        agentId: getBotBinding(botId)?.agentId || "",
        conversationKey,
        reason: "human_handoff"
      });
```

Where conversation reset cancels flow activation, add:

```js
    cancelTagActivationTasks({
      botId,
      agentId: getBotBinding(botId)?.agentId || "",
      conversationKey,
      reason: "conversation_reset"
    });
```

- [ ] **Step 9: Run tests and commit**

Run:

```bash
node --test tests/server-tags-boundary.test.js tests/dclaw-tags.test.js tests/db-tags.test.js
```

Expected: PASS.

Commit:

```bash
git add src/server.js src/db.js tests/server-tags-boundary.test.js
git commit -m "Apply customer tag decisions in server"
```

---

### Task 5: Tag Activation Scheduling and Worker

**Files:**
- Modify: `src/server.js`
- Modify: `src/dclaw.js`
- Modify: `src/db.js`
- Create: `tests/server-tag-activation-boundary.test.js`

**Interfaces:**
- Consumes accepted tag events from Task 4 and activation configs from tag schema.
- Produces due tag activation messages through WorkTool and optional Agent polish.

- [ ] **Step 1: Write failing boundary tests**

Create `tests/server-tag-activation-boundary.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const dclaw = fs.readFileSync(new URL("../src/dclaw.js", import.meta.url), "utf8");

test("server schedules tag activation after accepted tag changes", () => {
  assert.match(server, /scheduleTagActivationsForAcceptedChanges/);
  assert.match(server, /tag\.activation\.scheduled/);
});

test("tag activation worker has independent non-overlapping loop", () => {
  assert.match(server, /tagActivationWorkerBusy/);
  assert.match(server, /processTagActivationBatch/);
  assert.match(server, /claimDueTagActivationTasks/);
});

test("tag activation checks tag is still active before sending", () => {
  assert.match(server, /isTagStillActiveForTask/);
  assert.match(server, /tag\.activation\.stale_skipped/);
});

test("dclaw has tag activation polish request", () => {
  assert.match(dclaw, /buildDclawTagActivationRequest/);
  assert.match(dclaw, /eventType=tag_activation_due/);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
node --test tests/server-tag-activation-boundary.test.js
```

Expected: FAIL because tag activation worker does not exist.

- [ ] **Step 3: Add DClaw tag activation polish request**

In `src/dclaw.js`, add:

```js
export function buildDclawTagActivationRequest({
  binding,
  conversationKey,
  task,
  recentMessages = []
}) {
  const userId = String(conversationKey || "").split(":private:")[1] || "";
  const worktoolMessage = {
    channel: "wecom-worktool",
    eventType: "tag_activation_due",
    botId: binding.botId,
    agentId: binding.agentId,
    conversationId: conversationKey,
    sessionId: conversationKey,
    messageId: `tag_activation:${task.id}`,
    message: task.messageContent || "",
    rawMessage: task.messageContent || "",
    roomType: 2,
    groupName: "",
    userId,
    metadata: {
      tagActivationTaskId: task.id,
      groupId: task.groupId,
      tagId: task.tagId,
      recentMessages
    }
  };
  return {
    external_user_id: userId || "unknown",
    external_session_id: conversationKey,
    message: [
      "你收到的是 WorkTool 回调服务器的标签触发跟进事件。",
      "eventType=tag_activation_due 表示某个客户标签仍然有效，需要发送一次自然跟进。",
      "请只围绕 message 中的跟进话术做真人化表达，不要新增未经确认的事实、附件或资源。",
      "最终只输出一个 JSON 对象：{\"reply\":\"发给客户的标签跟进话术\",\"attachments\":[],\"sources\":[]}",
      "",
      JSON.stringify({ worktoolMessage }, null, 2)
    ].join("\n"),
    stream: true,
    metadata: {
      source: "worktool",
      eventType: "tag_activation_due",
      botId: binding.botId,
      agentId: binding.agentId,
      conversationId: conversationKey,
      worktool: worktoolMessage
    }
  };
}
```

- [ ] **Step 4: Add scheduling helpers**

In `src/server.js`, import:

```js
  claimDueTagActivationTasks,
  listTagActivationTasks,
  markTagActivationTaskFailed,
  markTagActivationTaskSent,
  scheduleTagActivationTask
```

Add helper:

```js
function scheduleTagActivationsForAcceptedChanges({ botId, binding, conversationKey, accepted = [] }) {
  const schema = normalizeTagSchema(getAgentTagSchema(binding.agentId)?.config || {});
  const scheduled = [];
  for (const change of accepted) {
    if (!["add", "replace"].includes(change.action)) continue;
    const group = schema.groups.find((item) => item.id === change.groupId);
    const tag = group?.tags.find((item) => item.id === change.tagId);
    const activation = tag?.activation || {};
    if (!activation.enabled || !activation.messages?.length) continue;
    const firstMessage = activation.messages[0];
    const task = scheduleTagActivationTask({
      botId,
      agentId: binding.agentId,
      conversationKey,
      groupId: group.id,
      tagId: tag.id,
      activation,
      dueAt: activationDueAtForAttempt(new Date().toISOString(), firstMessage.intervalMinutes, 1),
      attemptNumber: 1,
      messageIndex: 0
    });
    scheduled.push(task);
  }
  return scheduled;
}
```

Call it after accepted tag decision is applied:

```js
const scheduledTagTasks = scheduleTagActivationsForAcceptedChanges({
  botId,
  binding,
  conversationKey,
  accepted: tagUpdate?.accepted || []
});
```

- [ ] **Step 5: Cancel old tag tasks on replace/remove**

Before applying new state, for each accepted change:

```js
function cancelTagTasksForAcceptedChanges({ botId, binding, conversationKey, accepted = [] }) {
  for (const change of accepted) {
    for (const oldTagId of change.oldTagIds || []) {
      cancelTagActivationTasks({
        botId,
        agentId: binding.agentId,
        conversationKey,
        groupId: change.groupId,
        tagId: oldTagId,
        reason: "tag_changed"
      });
    }
    if (change.action === "remove") {
      cancelTagActivationTasks({
        botId,
        agentId: binding.agentId,
        conversationKey,
        groupId: change.groupId,
        tagId: change.tagId,
        reason: "tag_removed"
      });
    }
  }
}
```

- [ ] **Step 6: Add worker**

Copy the flow activation worker pattern in `src/server.js`, using distinct config:

```js
const tagActivationWorkerConfig = {
  enabled: process.env.TAG_ACTIVATION_WORKER_ENABLED !== "false",
  intervalMs: Number(process.env.TAG_ACTIVATION_WORKER_INTERVAL_MS || 10000),
  batchSize: Number(process.env.TAG_ACTIVATION_WORKER_BATCH_SIZE || 20),
  staleProcessingMs: Number(process.env.TAG_ACTIVATION_WORKER_STALE_PROCESSING_MS || 300000),
  sendDelayMs: Number(process.env.TAG_ACTIVATION_SEND_DELAY_MS || 500),
  maxConcurrentAgentCalls: Number(process.env.TAG_ACTIVATION_MAX_CONCURRENT_AGENT_CALLS || 2)
};

let tagActivationWorkerBusy = false;
```

Add:

```js
function isTagStillActiveForTask(task) {
  return listConversationTags({
    botId: task.botId,
    agentId: task.agentId,
    conversationKey: task.conversationKey
  }).some((tag) => tag.groupId === task.groupId && tag.tagId === task.tagId);
}
```

Implement `processTagActivationTask(task)`:

```js
async function processTagActivationTask(task) {
  if (!isTagStillActiveForTask(task)) {
    markTagActivationTaskFailed({ id: task.id, error: "stale_tag_activation_task" });
    logInfo("tag.activation.stale_skipped", { tagActivationTaskId: task.id, conversationKey: task.conversationKey });
    return;
  }
  const binding = getBotBinding(task.botId);
  if (!binding || binding.agentId !== task.agentId) {
    markTagActivationTaskFailed({ id: task.id, error: "agent_binding_changed" });
    return;
  }
  const target = privateTargetNameFromConversationKey(task.conversationKey);
  if (!target) throw new Error("missing tag activation target");
  const content = String(task.messageContent || "").trim();
  if (!content) throw new Error("empty tag activation message");
  const finalContent = task.polishByAgent
    ? await buildPolishedTagActivationContent({ binding, task })
    : content;
  const result = await sendTextMessage({ robotId: task.botId, targets: [target], content: finalContent });
  markTagActivationTaskSent({ id: task.id, worktoolMessageIds: [result.data || ""] });
  insertConversationMessage({
    botId: task.botId,
    conversationKey: task.conversationKey,
    direction: "outbound",
    senderName: binding.botName || binding.agentName || "机器人",
    content: finalContent,
    rawPayload: { source: "tag_activation", tagActivationTaskId: task.id, worktoolResponse: result }
  });
}
```

Implement `buildPolishedTagActivationContent` by invoking `buildDclawTagActivationRequest`, `invokeStrictAgentReply`, and returning `agentReply.reply` with the same invalid-format fail-closed behavior used by flow activation.

Add interval:

```js
if (tagActivationWorkerConfig.enabled) {
  setInterval(() => {
    void processTagActivationBatch().catch((error) => {
      logError("tag.activation.worker.failed", { error });
    });
  }, tagActivationWorkerConfig.intervalMs).unref();
}
```

- [ ] **Step 7: Run tests and commit**

Run:

```bash
node --test tests/server-tag-activation-boundary.test.js tests/server-activation-worker-boundary.test.js tests/dclaw-tags.test.js
```

Expected: PASS.

Commit:

```bash
git add src/server.js src/dclaw.js src/db.js tests/server-tag-activation-boundary.test.js
git commit -m "Add tag activation worker"
```

---

### Task 6: Tag API Routes

**Files:**
- Modify: `src/server.js`
- Create: `tests/server-tags-api-boundary.test.js`

**Interfaces:**
- Produces:
  - `GET /api/tag-schemas/:botId`
  - `PUT /api/tag-schemas/:botId`
  - `GET /api/flow-sessions/:conversationKey` includes `tags`
  - `GET /api/flow-sessions` includes each session's `tags`

- [ ] **Step 1: Write failing route boundary tests**

Create `tests/server-tags-api-boundary.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("server exposes tag schema routes by selected bot", () => {
  assert.match(source, /"\/api\/tag-schemas\/:botId"/);
  assert.match(source, /upsertAgentTagSchema/);
  assert.match(source, /getAgentTagSchema/);
});

test("flow session APIs include tags", () => {
  assert.match(source, /tags: listConversationTags/);
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
node --test tests/server-tags-api-boundary.test.js
```

Expected: FAIL because routes are missing.

- [ ] **Step 3: Add routes**

In `src/server.js`, near flow machine routes:

```js
app.get(
  "/api/tag-schemas/:botId",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, req.params.botId);
    const binding = getBotBinding(req.params.botId);
    if (!binding) throw new Error("bot binding not found");
    res.json({
      ok: true,
      agentId: binding.agentId,
      schema: getAgentTagSchema(binding.agentId)?.config || { dateTag: { enabled: false }, groups: [] }
    });
  })
);

app.put(
  "/api/tag-schemas/:botId",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, req.params.botId);
    const binding = getBotBinding(req.params.botId);
    if (!binding) throw new Error("bot binding not found");
    const schema = upsertAgentTagSchema({
      agentId: binding.agentId,
      schema: req.body?.schema || req.body || {}
    });
    res.json({ ok: true, agentId: binding.agentId, schema: schema.config });
  })
);
```

- [ ] **Step 4: Include tags in session APIs**

In `/api/flow-sessions/:conversationKey`, add:

```js
const binding = getBotBinding(botId);
```

Add response field:

```js
tags: binding ? listConversationTags({ botId, agentId: binding.agentId, conversationKey }) : []
```

In `/api/flow-sessions`, after `listFlowSessions`, map sessions with tags:

```js
const binding = getBotBinding(botId);
const sessions = listFlowSessions({ botId, limit: Number(req.query.limit || 100) })
  .map((session) => ({
    ...session,
    tags: binding ? listConversationTags({ botId, agentId: binding.agentId, conversationKey: session.conversationKey }) : []
  }));
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
node --test tests/server-tags-api-boundary.test.js tests/server-auth-boundary.test.js
```

Expected: PASS.

Commit:

```bash
git add src/server.js tests/server-tags-api-boundary.test.js
git commit -m "Expose customer tag APIs"
```

---

### Task 7: Console Tag Tab and Conversation Tag Display

**Files:**
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Create: `tests/console-tags-boundary.test.js`

**Interfaces:**
- Consumes:
  - `GET /api/tag-schemas/:botId`
  - `PUT /api/tag-schemas/:botId`
  - session `tags` fields.
- Produces:
  - visible 标签 tab.
  - tag schema editor with import/export.
  - tag chips in session cards and chat header.
  - tag filter dropdown.

- [ ] **Step 1: Write failing console boundary tests**

Create `tests/console-tags-boundary.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("console has customer tags workspace tab", () => {
  assert.match(html, /data-workspace-tab="tags"/);
  assert.match(html, /id="tagSchemaPanel"/);
});

test("console loads and saves tag schemas", () => {
  assert.match(js, /loadTagSchema/);
  assert.match(js, /saveTagSchema/);
  assert.match(js, /\/api\/tag-schemas\//);
});

test("console renders tag chips and tag filters", () => {
  assert.match(js, /renderConversationTags/);
  assert.match(js, /flowSessionTagFilter/);
  assert.match(css, /\.tag-chip/);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --test tests/console-tags-boundary.test.js
```

Expected: FAIL.

- [ ] **Step 3: Add HTML controls**

In `public/console/index.html`, add a workspace button:

```html
<button data-workspace-tab="tags" type="button">
  <svg class="icon" aria-hidden="true"><use href="#icon-info"></use></svg>
  标签
</button>
```

Add panel:

```html
<section class="tab-panel bot-context-panel" id="tagsTab" data-tab-panel="tags" hidden>
  <section class="panel" id="tagSchemaPanel">
    <div class="panel-head compact">
      <h2>客户标签</h2>
      <div class="panel-actions">
        <button class="secondary" id="importTagsButton" type="button">导入</button>
        <button class="secondary" id="exportTagsButton" type="button">导出</button>
        <button class="primary" id="saveTagsButton" type="button">保存标签</button>
      </div>
    </div>
    <div class="tag-schema-toolbar">
      <label class="checkbox-card">
        <input id="dateTagEnabled" type="checkbox" />
        <span>启用日期标签</span>
      </label>
      <button class="secondary" id="addTagGroupButton" type="button">新增标签组</button>
    </div>
    <div id="tagGroupList" class="tag-group-list"></div>
    <input id="importTagsFile" type="file" accept="application/json,.json" hidden />
  </section>
</section>
```

In conversation filters, add:

```html
<label>
  <span class="field-label">标签</span>
  <select id="flowSessionTagFilter">
    <option value="all">全部</option>
  </select>
</label>
```

- [ ] **Step 4: Add JS state and selectors**

In `state`, add:

```js
tagSchema: { dateTag: { enabled: false }, groups: [] },
```

In `els`, add:

```js
tagGroupList: document.querySelector("#tagGroupList"),
dateTagEnabled: document.querySelector("#dateTagEnabled"),
addTagGroupButton: document.querySelector("#addTagGroupButton"),
saveTagsButton: document.querySelector("#saveTagsButton"),
importTagsButton: document.querySelector("#importTagsButton"),
exportTagsButton: document.querySelector("#exportTagsButton"),
importTagsFile: document.querySelector("#importTagsFile"),
flowSessionTagFilter: document.querySelector("#flowSessionTagFilter"),
```

- [ ] **Step 5: Implement tag schema editor helpers**

Add after activation editor helpers:

```js
function defaultTagSchema() {
  return { dateTag: { enabled: false }, groups: [] };
}

function defaultTagGroup(index = state.tagSchema.groups.length + 1) {
  return {
    id: `group_${index}`,
    name: `标签组 ${index}`,
    enabled: true,
    exclusive: true,
    oneWay: false,
    tags: []
  };
}

function defaultTag(index = 1) {
  return {
    id: `tag_${index}`,
    name: `标签 ${index}`,
    condition: "",
    activation: { enabled: false, polishByAgent: true, messages: [defaultActivationMessage()] }
  };
}

function renderConversationTags(tags = []) {
  const visibleTags = Array.isArray(tags) ? tags : [];
  if (!visibleTags.length) return "";
  return `
    <span class="conversation-tags">
      ${visibleTags.map((tag) => {
        const label = tag.tagType === "date" ? tag.tagName : `${tag.groupName || "标签"}：${tag.tagName}`;
        const title = [label, tag.reason].filter(Boolean).join("\\n");
        return `<span class="tag-chip ${tag.tagType === "date" ? "is-date" : ""}" title="${escapeHtml(title)}">${escapeHtml(tag.tagName)}</span>`;
      }).join("")}
    </span>
  `;
}
```

Implement `renderTagSchemaEditor()` with group cards containing:

- group name input.
- enabled checkbox.
- exclusive checkbox.
- oneWay checkbox.
- add tag button.
- tag rows with name, condition textarea, activation controls using existing activation message card style.

Use data attributes:

```html
data-tag-group-index
data-tag-field
data-tag-index
data-tag-activation-field
data-tag-activation-message-index
```

- [ ] **Step 6: Implement load/save/import/export**

Add:

```js
async function loadTagSchema({ contextVersion = state.botContextVersion } = {}) {
  const botId = state.selectedBotId;
  if (!botId) return;
  const data = await request(`/api/tag-schemas/${encodeURIComponent(botId)}`);
  if (!isCurrentBotContext(botId, contextVersion)) return;
  state.tagSchema = data.schema || defaultTagSchema();
  renderTagSchemaEditor();
  renderFlowSessionTagFilter();
}

async function saveTagSchema() {
  const botId = state.selectedBotId;
  if (!botId) {
    toast("请选择 Bot");
    return;
  }
  await request(`/api/tag-schemas/${encodeURIComponent(botId)}`, {
    method: "PUT",
    botId,
    body: JSON.stringify({ schema: state.tagSchema })
  });
  toast("标签配置已保存");
  await loadTagSchema();
}

function exportTagSchema() {
  const blob = new Blob([JSON.stringify(state.tagSchema || defaultTagSchema(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "customer-tags.json";
  a.click();
  URL.revokeObjectURL(url);
}
```

Implement import using `FileReader`:

```js
async function importTagSchemaFile(file) {
  const text = await file.text();
  const schema = JSON.parse(text);
  state.tagSchema = schema;
  renderTagSchemaEditor();
  toast("标签 JSON 已导入，保存后生效");
}
```

- [ ] **Step 7: Wire into existing context loads**

In `loadBotContextData`, add:

```js
loadTagSchema({ contextVersion }),
```

In `resetBotContext`, reset:

```js
state.tagSchema = defaultTagSchema();
if (els.tagGroupList) els.tagGroupList.innerHTML = "";
if (els.flowSessionTagFilter) els.flowSessionTagFilter.innerHTML = `<option value="all">全部</option>`;
```

- [ ] **Step 8: Render tags in sessions and filters**

In `renderFlowSessions`, after session name/status:

```js
${renderConversationTags(session.tags || [])}
```

In `filterFlowSessions`, add:

```js
const tagFilter = els.flowSessionTagFilter?.value || "all";
if (tagFilter !== "all" && !(session.tags || []).some((tag) => `${tag.groupId}:${tag.tagId}` === tagFilter || `date:${tag.tagId}` === tagFilter)) return false;
```

Add `renderFlowSessionTagFilter()`:

```js
function renderFlowSessionTagFilter() {
  if (!els.flowSessionTagFilter) return;
  const current = els.flowSessionTagFilter.value || "all";
  const options = new Map([["all", "全部"]]);
  for (const session of currentFlowSessions) {
    for (const tag of session.tags || []) {
      const key = tag.tagType === "date" ? `date:${tag.tagId}` : `${tag.groupId}:${tag.tagId}`;
      options.set(key, tag.tagType === "date" ? `日期：${tag.tagName}` : `${tag.groupName}：${tag.tagName}`);
    }
  }
  els.flowSessionTagFilter.innerHTML = [...options]
    .map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`)
    .join("");
  els.flowSessionTagFilter.value = options.has(current) ? current : "all";
}
```

Call it after `currentFlowSessions = data.sessions || []`.

In `openFlowSession`, render tags near chat header by adding a small container in HTML or updating an existing header area:

```js
document.querySelector("#chatTagList").innerHTML = renderConversationTags(data.tags || []);
```

- [ ] **Step 9: Add CSS**

Add to `public/console/styles.css`:

```css
.tag-schema-toolbar,
.tag-group-head,
.tag-row-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.tag-group-list {
  display: grid;
  gap: 14px;
}

.tag-group-card,
.tag-row-card {
  border: 1px solid rgba(47, 64, 229, 0.18);
  border-radius: 8px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.82);
}

.tag-row-card {
  margin-top: 10px;
}

.conversation-tags {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  min-width: 0;
}

.tag-chip {
  display: inline-flex;
  align-items: center;
  max-width: 120px;
  padding: 2px 8px;
  border: 1px solid rgba(47, 64, 229, 0.35);
  border-radius: 999px;
  color: #2436ce;
  background: rgba(47, 64, 229, 0.08);
  font-size: 12px;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tag-chip.is-date {
  color: #c8501b;
  border-color: rgba(255, 86, 34, 0.4);
  background: rgba(255, 86, 34, 0.08);
}
```

- [ ] **Step 10: Run tests and commit**

Run:

```bash
node --test tests/console-tags-boundary.test.js
```

Expected: PASS.

Commit:

```bash
git add public/console/index.html public/console/app.js public/console/styles.css tests/console-tags-boundary.test.js
git commit -m "Add customer tag console"
```

---

### Task 8: End-to-End Verification and Documentation

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Test: full suite.

**Interfaces:**
- Documents new worker env vars and console use.

- [ ] **Step 1: Update `.env.example`**

Add:

```env
TAG_ACTIVATION_WORKER_ENABLED=true
TAG_ACTIVATION_WORKER_INTERVAL_MS=10000
TAG_ACTIVATION_WORKER_BATCH_SIZE=20
TAG_ACTIVATION_WORKER_STALE_PROCESSING_MS=300000
TAG_ACTIVATION_SEND_DELAY_MS=500
TAG_ACTIVATION_MAX_CONCURRENT_AGENT_CALLS=2
```

- [ ] **Step 2: Update README**

Add a section:

```md
## 客户标签

控制台的“标签”页按当前 Bot 绑定的 Agent 维护标签配置。标签配置跟随 Agent，客户标签状态按 `botId + agentId + conversationKey` 隔离。

- 日期标签：新增好友后自动打当天日期。
- 互斥递进标签：例如 C 类到 B 类到 A 类，只允许按排序方向前进。
- 非互斥标签：多个标签可以并存。
- 标签任务：标签打上后可以按间隔和次数发送跟进话术，标签失效后未发送任务会取消。
```

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Inspect git status**

Run:

```bash
git status --short
```

Expected: no unexpected service implementation files remain modified beyond the documentation updates in this task.

- [ ] **Step 5: Commit docs**

Commit:

```bash
git add README.md .env.example
git commit -m "Document customer tag configuration"
```

- [ ] **Step 6: Final deployment note**

After all tasks are implemented and tested, provide these production commands:

```bash
cd /opt/worktool-bot-service
git pull origin main
docker compose up -d --build
docker logs --tail=120 worktool-bot-service
```

Expected health check:

```bash
curl -s http://127.0.0.1:18765/health
```

Expected response contains:

```json
{"ok":true,"service":"worktool-bot-service"}
```

---

## Self-Review

- Spec coverage:
  - Agent-owned tag schema: Tasks 2, 6, 7.
  - `botId + agentId + conversationKey` state isolation: Tasks 2, 4, 6.
  - Date tags: Tasks 1, 4.
  - Agent-suggested decisions with service adjudication: Tasks 1, 3, 4.
  - Exclusive one-way groups and non-exclusive groups: Task 1.
  - Tag-triggered tasks and cancellation: Tasks 2, 4, 5.
  - Console Tags tab, filtering, import/export: Tasks 6, 7.
  - Tests and docs: Task 8 plus tests in every task.
- Placeholder scan: no unfinished placeholders are used as implementation instructions.
- Type consistency:
  - `tagDecision.add/remove` uses `groupId`, `tagId`, `reason`.
  - DB helpers consistently use `botId`, `agentId`, `conversationKey`.
  - Tag task worker names are distinct from flow activation worker names.
