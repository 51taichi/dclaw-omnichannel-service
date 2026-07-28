# Group Management and Reply Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Bot-scoped group-management console with optional group creation, stable group identity, local background and role configuration, per-group reply and tag-group policies, differential WorkTool writes, and group-alert navigation without affecting private-chat behavior.

**Architecture:** Introduce a focused group domain around an immutable local group ID and canonical group conversation key. Keep WorkTool transport in `worktool.js`, persistence in `db.js`, group discovery/configuration orchestration in a new `groups.js`, and expose narrow Bot-authorized routes from `server.js`. Extend the existing single Agent reply pipeline with a channel policy/context adapter so group and private replies share knowledge, attachments, validation, and delivery while retaining separate flow and tag state.

**Tech Stack:** Node.js ES modules, Express 5, `node:sqlite` `DatabaseSync`, browser-native JavaScript, HTML/CSS, WorkTool HTTP APIs, Node test runner.

## Global Constraints

- The private **任务** tab and private task/flow/activation/handoff behavior must remain unchanged.
- Group and private business state share reply capabilities and complete tag definitions/behavior; backgrounds, roles, tag results, sessions, and private task state remain isolated.
- **群管理** never renders chat history; group history remains in **会话**.
- The main group layout is a 30% group list and a 70% selected-group configuration pane.
- **创建外部群** and **修改群信息** are separate dialogs.
- Group discovery uses callbacks, accepted creation commands, tab-entry refresh, and manual refresh only; no background group-list polling is permitted.
- A newly discovered group defaults to mention-only replies, inherited member policy, empty background, and only the system date tag group.
- Group roles are customer-maintained configuration, not an authoritative live membership list.
- Role deletion never removes a real Enterprise WeChat participant.
- Group reply policies are `always`, `mention_only`, and `never`; role policies additionally support `inherit`.
- A message performs group tag recognition only when that message actually enters the Agent reply path.
- Groups bind whole tag groups; mutual exclusion, accumulation, removal, and voice-alert behavior remain defined only by the shared tag schema.
- A bound tag group retains the complete tag feature, including activation messages, intervals, repetition, Agent polishing, cancellation, and retry; group tag activation sends to the group.
- The system date tag group is always bound and cannot be removed.
- WorkTool callback binding must use `openCallback=1` and `replyAll=1`.
- Unchanged group fields and member remarks must not call WorkTool.
- WorkTool command acceptance and device execution success must be represented separately.
- Every new route and query must enforce existing Bot/workspace authorization.
- Existing uncommitted changes in `src/agent-response-gateway.js`, `src/db.js`, `src/server.js`, and their tests belong to the user; implementation must preserve and reconcile them rather than overwrite them.

---

## File Structure

### New backend files

- `src/groups.js`: group constants, policy resolution, discovery/alias resolution, public serialization, differential mutation planning, and Agent group-context construction.

### Modified backend files

- `src/db.js`: group registry, aliases, roles, tag-group bindings, optimistic configuration versioning, canonical group conversation identity, and group-aware alert fields.
- `src/worktool.js`: list, create, modify, and member-remark WorkTool commands with pure command builders.
- `src/server.js`: callback group resolution, group-aware Agent/tag path, Bot-authorized group-management routes, and command result recording.
- `src/dclaw.js`: bounded group background and role context in group Agent requests without private flow state.

### Modified frontend files

- `public/console/index.html`: **群管理** navigation item, 30/70 panel, create dialog, modify dialog.
- `public/console/app.js`: group-management state, API client, rendering, dialog flows, optimistic saves, alert navigation copy.
- `public/console/styles.css`: group split-pane, role editor, dialogs, responsive layout, conflict/error states.

### New tests

- `tests/db-groups.test.js`
- `tests/groups.test.js`
- `tests/worktool-group-management.test.js`
- `tests/server-group-management-boundary.test.js`
- `tests/server-group-reply-policy.test.js`
- `tests/server-group-tags.test.js`
- `tests/console-group-management-boundary.test.js`

### Updated tests

- `tests/db-group-session.test.js`
- `tests/server-group-conversation-boundary.test.js`
- `tests/server-group-mention-boundary.test.js`
- `tests/server-tags-boundary.test.js`
- `tests/db-tag-alerts.test.js`
- `tests/console-auth-boundary.test.js`
- `tests/tag-alert-client.test.js`

---

### Task 1: Persist Stable Groups, Aliases, Roles, and Tag-Group Bindings

**Files:**
- Create: `tests/db-groups.test.js`
- Modify: `src/db.js`
- Update: `tests/db-group-session.test.js`

**Interfaces:**
- Produces from `src/db.js`:
  - `createOrGetGroup({ botId, currentName, currentRemark?, source, discoveredAt?, createdAt?, dateSource? }): group`
  - `getGroupById({ botId, groupId }): group | null`
  - `resolveGroupByAddress({ botId, groupName, groupRemark? }): { status: "resolved", group, matchedBy } | { status: "ambiguous", candidates } | null`
  - `listGroupsPage({ botId, search?, page?, pageSize? }): { items, pagination }`
  - `updateGroupExternalSnapshot({ botId, groupId, expectedVersion, currentName?, currentRemark?, announcement? }): group`
  - `saveGroupConfig({ botId, groupId, expectedVersion, replyPolicy, background, tagGroupIds }): group`
  - `listGroupRoles({ botId, groupId }): role[]`
  - `saveGroupRoles({ botId, groupId, expectedVersion, roles }): { group, roles }`
  - `mergeGroupAlias({ botId, sourceGroupId, targetGroupId }): group`
  - `canonicalGroupConversationKey({ botId, groupId }): string`
- Consumed by `src/groups.js`, `src/server.js`, and later group APIs.

- [ ] **Step 1: Write failing group persistence tests**

Create `tests/db-groups.test.js` with isolated database setup following
`tests/db-group-session.test.js`. Cover immutable identity, aliases, defaults,
version conflicts, roles, and tag bindings:

```js
test("renaming a group preserves its immutable id and canonical conversation key", () => {
  const created = db.createOrGetGroup({
    botId: "bot-a",
    currentName: "A项目群",
    source: "callback",
    discoveredAt: "2026-07-28T01:00:00.000Z",
    dateSource: "first_discovered"
  });
  const renamed = db.updateGroupExternalSnapshot({
    botId: "bot-a",
    groupId: created.id,
    expectedVersion: created.version,
    currentName: "A项目交付群"
  });

  assert.equal(renamed.id, created.id);
  assert.equal(
    renamed.conversationKey,
    db.canonicalGroupConversationKey({ botId: "bot-a", groupId: created.id })
  );
  assert.equal(
    db.resolveGroupByAddress({ botId: "bot-a", groupName: "A项目群" }).group.id,
    created.id
  );
  assert.equal(
    db.resolveGroupByAddress({ botId: "bot-a", groupName: "A项目交付群" }).group.id,
    created.id
  );
});

test("a stale group configuration save is rejected", () => {
  const group = db.createOrGetGroup({
    botId: "bot-a",
    currentName: "售后群",
    source: "callback"
  });
  db.saveGroupConfig({
    botId: "bot-a",
    groupId: group.id,
    expectedVersion: group.version,
    replyPolicy: "always",
    background: "A产品售后",
    tagGroupIds: ["date", "emotion"]
  });
  assert.throws(
    () => db.saveGroupConfig({
      botId: "bot-a",
      groupId: group.id,
      expectedVersion: group.version,
      replyPolicy: "never",
      background: "",
      tagGroupIds: ["date"]
    }),
    /group configuration version conflict/
  );
});
```

Also assert:

- same-named groups on different Bots are isolated;
- a new group defaults to `mention_only`;
- the date tag-group binding is inserted and cannot be deleted;
- a role uses `inherit` by default;
- deleting a role leaves the group and conversation intact;
- aliases are exact matches only;
- a role keeps old names as aliases after current-name update.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
node --test tests/db-groups.test.js tests/db-group-session.test.js
```

Expected: FAIL because the group persistence functions and tables do not exist.

- [ ] **Step 3: Add the group schema and row mappers**

Add tables and indexes to the startup schema in `src/db.js`:

```sql
CREATE TABLE IF NOT EXISTS managed_groups (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  conversation_key TEXT NOT NULL UNIQUE,
  current_name TEXT NOT NULL,
  current_remark TEXT NOT NULL DEFAULT '',
  announcement TEXT NOT NULL DEFAULT '',
  reply_policy TEXT NOT NULL DEFAULT 'mention_only'
    CHECK (reply_policy IN ('always', 'mention_only', 'never')),
  background TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (lifecycle_status IN ('creating', 'confirmed', 'failed', 'conflict')),
  group_created_at TEXT,
  date_source TEXT NOT NULL DEFAULT 'first_discovered',
  config_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS managed_group_aliases (
  group_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  alias_type TEXT NOT NULL CHECK (alias_type IN ('name', 'remark')),
  alias_value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (group_id, alias_type, alias_value)
);

CREATE INDEX IF NOT EXISTS idx_managed_group_alias_lookup
ON managed_group_aliases (bot_id, alias_value);

CREATE TABLE IF NOT EXISTS managed_group_roles (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  current_name TEXT NOT NULL,
  identity_type TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  reply_policy TEXT NOT NULL DEFAULT 'inherit'
    CHECK (reply_policy IN ('inherit', 'always', 'mention_only', 'never')),
  desired_mark_name TEXT NOT NULL DEFAULT '',
  original_mark_name TEXT NOT NULL DEFAULT '',
  sync_mark_name INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (group_id, current_name)
);

CREATE TABLE IF NOT EXISTS managed_group_role_aliases (
  role_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  alias_value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (role_id, alias_value)
);

CREATE INDEX IF NOT EXISTS idx_managed_group_role_alias_lookup
ON managed_group_role_aliases (group_id, alias_value);

CREATE TABLE IF NOT EXISTS managed_group_tag_groups (
  group_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  tag_group_id TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (group_id, tag_group_id)
);
```

Use UUIDs for local group and role IDs. Generate canonical keys as
`${botId}:group-id:${groupId}`. Keep current display names out of canonical
identity.

- [ ] **Step 4: Implement transactional defaults, aliases, roles, and versions**

Implement the interfaces above with transactions for:

- group creation plus current-name alias plus date binding;
- external snapshot update plus old/new aliases;
- configuration plus tag-binding replacement;
- role replacement plus preserved role aliases;
- manual group merge with source aliases moved to the target.

Throw an error carrying `code = "GROUP_VERSION_CONFLICT"` when
`expectedVersion` does not match.

- [ ] **Step 5: Migrate existing group conversation records non-destructively**

At startup, scan existing conversations whose key matches
`<botId>:group:<groupName>`. For each:

1. create a `managed_groups` record when none resolves;
2. assign its canonical key to the group registry;
3. keep the legacy key as a name alias;
4. migrate conversation-key references in one transaction across
   `conversations`, `incoming_messages`, `outgoing_messages`,
   `agent_invocations`, `agent_response_validation_failures`,
   `agent_tag_evaluations`, `message_processing`, `flow_sessions`,
   `conversation_messages`, `flow_state_events`, `flow_activation_tasks`,
   `flow_action_executions`, `conversation_tags`,
   `conversation_tag_events`, `tag_alert_events`, `tag_activation_tasks`, and
   `conversation_reset_tasks`;
5. leave private keys unchanged.

Add a database test with messages, tags, alerts, and invocations on a legacy
group key, then assert all records use the canonical key after migration.

- [ ] **Step 6: Run focused database tests**

Run:

```bash
node --test tests/db-groups.test.js tests/db-group-session.test.js tests/db-tags.test.js tests/db-tag-alerts.test.js
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db.js tests/db-groups.test.js tests/db-group-session.test.js
git commit -m "Add stable group management persistence"
```

---

### Task 2: Add Pure Group Domain Rules

**Files:**
- Create: `src/groups.js`
- Create: `tests/groups.test.js`

**Interfaces:**
- Consumes: Task 1 database interfaces.
- Produces:
  - `GROUP_REPLY_POLICIES`
  - `GROUP_ROLE_REPLY_POLICIES`
  - `SYSTEM_DATE_TAG_GROUP_ID = "__date__"`
  - `normalizeGroupReplyPolicy(value, { allowInherit? }): string`
  - `resolveGroupReplyDecision({ groupPolicy, rolePolicy, atMe }): { invokeAgent, reason, effectivePolicy }`
  - `buildGroupTagContext({ schema, boundTagGroupIds, currentTags }): tagContext`
  - `buildGroupAgentContext({ group, roles, speakerName, maxChars? }): object`
  - `planGroupExternalPatch({ original, next }): { changed, commandFields }`
  - `planMemberRemarkChanges(roles): Array<{ roleId, currentName, markName }>`
  - `serializeManagedGroup(group, { roles?, tagGroupIds? }): object`
- Consumed by `src/server.js`, `src/dclaw.js`, and API routes.

- [ ] **Step 1: Write failing policy and differential-planning tests**

```js
test("role policy overrides the group and mention-only checks atMe", () => {
  assert.deepEqual(
    resolveGroupReplyDecision({
      groupPolicy: "always",
      rolePolicy: "mention_only",
      atMe: "false"
    }),
    {
      invokeAgent: false,
      reason: "mention_required",
      effectivePolicy: "mention_only"
    }
  );
});

test("member remark planning omits disabled and unchanged rows", () => {
  assert.deepEqual(planMemberRemarkChanges([
    {
      id: "a",
      currentName: "张三",
      originalMarkName: "张三-甲方",
      desiredMarkName: "张三-甲方",
      syncMarkName: true
    },
    {
      id: "b",
      currentName: "李四",
      originalMarkName: "李四",
      desiredMarkName: "李四-助理",
      syncMarkName: true
    },
    {
      id: "c",
      currentName: "王五",
      originalMarkName: "王五",
      desiredMarkName: "王五-技术",
      syncMarkName: false
    }
  ]), [{ roleId: "b", currentName: "李四", markName: "李四-助理" }]);
});
```

Also test:

- `inherit` resolves to the group policy;
- `always` ignores `atMe`;
- `never` never invokes;
- group tag context contains only bound groups plus
  `SYSTEM_DATE_TAG_GROUP_ID`;
- Agent context includes background, configured roles, speaker role, and no
  membership-state claims;
- external patch planning returns `changed=false` when all fields match.

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
node --test tests/groups.test.js
```

Expected: FAIL because `src/groups.js` does not exist.

- [ ] **Step 3: Implement the pure group domain module**

Use explicit policy sets:

```js
export const GROUP_REPLY_POLICIES =
  new Set(["always", "mention_only", "never"]);
export const GROUP_ROLE_REPLY_POLICIES =
  new Set(["inherit", "always", "mention_only", "never"]);
```

Return deterministic objects from policy resolution and differential planners.
Bound context construction must preserve the tag schema's existing
`exclusive`, conditions, and `voiceAlertEnabled` fields without rewriting
them.

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
node --test tests/groups.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/groups.js tests/groups.test.js
git commit -m "Add group reply and configuration rules"
```

---

### Task 3: Add WorkTool Group Management Commands

**Files:**
- Create: `tests/worktool-group-management.test.js`
- Modify: `src/worktool.js`

**Interfaces:**
- Produces:
  - `listWorkToolGroups({ robotId, groupName?, page?, size? })`
  - `buildCreateExternalGroupCommand({ groupName, selectList, groupAnnouncement?, groupRemark? })`
  - `createExternalGroup({ robotId, ...input })`
  - `buildModifyGroupCommand({ groupName, newGroupName?, newGroupAnnouncement?, newGroupRemark? })`
  - `modifyGroup({ robotId, ...input })`
  - `buildMemberRemarkCommands({ groupName, changes })`
  - `modifyGroupMemberRemarks({ robotId, groupName, changes })`
- Consumed by Task 6 API routes.

- [ ] **Step 1: Write failing command-builder tests**

```js
test("create group uses type 206 and selected private contact names", () => {
  assert.deepEqual(buildCreateExternalGroupCommand({
    groupName: "A售后群",
    selectList: ["张三", "李四"],
    groupAnnouncement: "售后服务群"
  }), {
    type: 206,
    groupName: "A售后群",
    selectList: ["张三", "李四"],
    groupAnnouncement: "售后服务群"
  });
});

test("member remark builder emits only supplied changes", () => {
  assert.deepEqual(buildMemberRemarkCommands({
    groupName: "A售后群",
    changes: [{ currentName: "李四", markName: "李四-助理" }]
  }), [{
    type: 225,
    groupName: "A售后群",
    friend: { name: "李四", markName: "李四-助理" }
  }]);
});
```

Test empty names, duplicate selected contacts, reserved invalid values, unchanged
modify input, pagination query parameters, and one request containing multiple
type-225 commands.

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
node --test tests/worktool-group-management.test.js
```

Expected: FAIL because the builders do not exist.

- [ ] **Step 3: Implement pure builders and HTTP wrappers**

Use `/robot/wework/group/list` for explicit synchronization and
`/wework/sendRawMessage` for command types `206`, `207`, and `225`.

Do not hide the deprecated list endpoint behind a timer. Normalize its response
to:

```js
{
  items: data.list || [],
  pagination: {
    page: Number(data.pageNum || page),
    pageSize: Number(data.pageSize || size),
    total: Number(data.total || 0),
    totalPages: Number(data.totalPage || 0)
  }
}
```

- [ ] **Step 4: Run WorkTool tests**

Run:

```bash
node --test tests/worktool-group-management.test.js tests/wecom-client.test.js tests/worktool-group-invite.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worktool.js tests/worktool-group-management.test.js
git commit -m "Add WorkTool group management commands"
```

---

### Task 4: Resolve Every Group Callback to Stable Identity

**Files:**
- Create: `tests/server-group-reply-policy.test.js`
- Modify: `src/server.js`
- Modify: `src/db.js`
- Update: `tests/server-group-conversation-boundary.test.js`
- Update: `tests/server-group-mention-boundary.test.js`

**Interfaces:**
- Consumes:
  - Task 1 group resolution and canonical conversation key.
  - Task 2 `resolveGroupReplyDecision()`.
- Produces in `src/server.js`:
  - `resolveInboundConversation({ botId, message }): { conversationKey, group? }`
  - `resolveInboundGroupPolicy({ botId, group, message }): decision`
- Later tasks consume the stable group on the Agent/tag path.

- [ ] **Step 1: Write failing inbound behavior tests**

Add executable tests around exported pure helpers or a test server harness:

```js
test("an unknown group callback creates a mention-only managed group", () => {
  const resolved = resolveInboundConversation({
    botId: "bot-a",
    message: {
      roomType: 1,
      groupName: "临时售后群",
      receivedName: "张三",
      atMe: "false"
    }
  });

  assert.match(resolved.conversationKey, /^bot-a:group-id:/);
  assert.equal(resolved.group.replyPolicy, "mention_only");
});

test("a role configured never is persisted but does not invoke the Agent", () => {
  const decision = resolveInboundGroupPolicy({
    botId: "bot-a",
    group,
    message: { receivedName: "王五", atMe: "true" }
  });
  assert.equal(decision.invokeAgent, false);
  assert.equal(decision.reason, "policy_never");
});
```

Cover group-always, group-mention-only, role override, inherit, unknown sender,
and Bot-authored echo suppression.

- [ ] **Step 2: Run focused server tests and verify failure**

Run:

```bash
node --test tests/server-group-reply-policy.test.js tests/server-group-conversation-boundary.test.js tests/server-group-mention-boundary.test.js
```

Expected: FAIL because callbacks still derive identity directly from group name
and use one hard-coded mention rule.

- [ ] **Step 3: Replace name-derived inbound identity with group resolution**

Before `ingestIncomingMessage()` builds its message key:

1. resolve or create the managed group for room types `1` and `3`;
2. use the canonical group conversation key;
3. preserve `groupName`, `groupRemark`, and local `groupId` in audit payloads;
4. add newly observed unmatched names as unconfigured role suggestions without
   assigning identity type or a membership state.

Private `getConversationKey()` behavior remains unchanged.

- [ ] **Step 4: Apply policy after persistence and before Agent coalescing**

Replace the current group-only mention gate with
`resolveInboundGroupPolicy()`. Keep non-triggering messages persisted and mark
processing status with one of:

- `group_policy_never`
- `group_mention_required`
- `group_bot_echo`

Only eligible messages join or start an Agent coalescing batch.

- [ ] **Step 5: Force all-message callback binding**

Keep the public binding input backward compatible, but normalize configured
group-capable callbacks to `replyAll: 1`. Add a test proving a request that
passes `replyAll: 0` cannot silently disable required group ingestion; return a
validation error explaining the requirement.

- [ ] **Step 6: Run focused callback tests**

Run:

```bash
node --test tests/server-group-reply-policy.test.js tests/server-group-conversation-boundary.test.js tests/server-group-mention-boundary.test.js tests/inbound-coalescer.test.js tests/server-inbound-coalescing-boundary.test.js
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server.js src/db.js tests/server-group-reply-policy.test.js tests/server-group-conversation-boundary.test.js tests/server-group-mention-boundary.test.js
git commit -m "Apply managed group identity and reply policies"
```

---

### Task 5: Add Group Background, Roles, and Bound Tags to the Agent Path

**Files:**
- Create: `tests/server-group-tags.test.js`
- Modify: `src/dclaw.js`
- Modify: `src/server.js`
- Modify: `src/db.js`
- Update: `tests/dclaw-request-sanitization.test.js`
- Update: `tests/server-tags-boundary.test.js`
- Update: `tests/db-tag-alerts.test.js`
- Update: `tests/server-tag-activation-boundary.test.js`

**Interfaces:**
- Consumes:
  - Task 2 `buildGroupAgentContext()` and `buildGroupTagContext()`.
  - Task 4 resolved managed group.
- Produces:
  - group Agent request metadata containing bounded `groupContext`;
  - group-scoped calls to existing `applyAgentTagDecision()`;
  - group alert records with group and sender display data;
  - group-compatible tag activation scheduling and delivery.

- [ ] **Step 1: Write failing Agent-context tests**

Extend `tests/dclaw-request-sanitization.test.js`:

```js
test("group requests contain bounded background and role context but no private flow", () => {
  const request = buildDclawRequest({
    binding,
    conversation: { conversationKey: "bot_1:group-id:g1" },
    message: {
      roomType: 1,
      groupName: "A售后群",
      receivedName: "张三",
      spoken: "系统还是报错"
    },
    flow: null,
    groupContext: {
      background: "客户购买了A产品",
      speaker: { name: "张三", identityType: "customer", description: "项目负责人" },
      roles: []
    }
  });

  assert.match(request.message, /客户购买了A产品/);
  assert.match(request.message, /项目负责人/);
  assert.doesNotMatch(request.message, /当前私聊会话启用了客服流程状态机/);
});
```

- [ ] **Step 2: Write failing group tag and alert tests**

In `tests/server-group-tags.test.js`, configure the group with only
`SYSTEM_DATE_TAG_GROUP_ID` and `emotion`, then assert:

- the Agent tag context omits an unbound `intent` group;
- an added alert-enabled emotion tag creates one group alert;
- the same active tag on a later invocation creates no second alert;
- an alert-disabled tag creates no alert;
- a mutually exclusive replacement follows existing tag behavior;
- a tag with activation configured schedules the normal activation task against
  the canonical group conversation;
- no private conversation tags change.

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```bash
node --test tests/dclaw-request-sanitization.test.js tests/server-group-tags.test.js tests/server-tags-boundary.test.js tests/db-tag-alerts.test.js
```

Expected: FAIL because group requests have no configured context and group tag
context is currently `null`.

- [ ] **Step 4: Extend DClaw request construction**

Add optional `groupContext` to `buildDclawRequest()`. Serialize only bounded
fields:

```js
groupContext: {
  groupId,
  background,
  speaker: { name, identityType, description },
  roles: [{ name, identityType, description }]
}
```

Do not send WorkTool member-remark synchronization fields, historical aliases,
configuration versions, or external mutation status to the Agent.

- [ ] **Step 5: Build bound group tag context**

For an eligible group message:

1. load the shared Agent tag schema;
2. load that group's bound tag-group IDs;
3. include `SYSTEM_DATE_TAG_GROUP_ID` plus selected groups;
4. load current tags for the canonical group conversation;
5. pass the result through the existing strict reply and tag-audit path;
6. apply decisions with existing mutual-exclusion and alert semantics.

Non-triggering messages never call this path.

- [ ] **Step 6: Make tag alerts group-aware without forking alert semantics**

Add nullable `conversation_type`, `group_id`, `group_name`, and `sender_name`
columns to `tag_alert_events`. Preserve the unique source tag-event reference.
Populate group display fields for group alerts and existing customer fields for
private alerts.

- [ ] **Step 7: Deliver tag activation to the current group address**

Extend the existing tag activation worker without creating a second scheduler.
At delivery time:

1. detect whether `task.conversationKey` resolves to a managed group;
2. verify the tag is still active using the existing stale-tag check;
3. load the group's current name or remark from `managed_groups`;
4. use that address as the WorkTool target instead of
   `privateTargetNameFromConversationKey()`;
5. preserve existing Agent polishing, retries, reservation-before-send,
   finalization, next-attempt scheduling, cancellation, and idempotency;
6. record outbound content on the canonical group conversation.

Add tests proving rename-safe delivery, removal-before-send cancellation,
duplicate-worker idempotency, and unchanged private delivery.

- [ ] **Step 8: Run focused tag and request tests**

Run:

```bash
node --test tests/dclaw-request-sanitization.test.js tests/server-group-tags.test.js tests/server-tags-boundary.test.js tests/db-tags.test.js tests/db-tag-alerts.test.js tests/server-tag-activation-boundary.test.js tests/agent-response-gateway.test.js
```

Expected: all PASS, including existing tag-activation worker tests.

- [ ] **Step 9: Commit**

```bash
git add src/dclaw.js src/server.js src/db.js tests/dclaw-request-sanitization.test.js tests/server-group-tags.test.js tests/server-tags-boundary.test.js tests/db-tag-alerts.test.js tests/server-tag-activation-boundary.test.js
git commit -m "Add group context and bound tag recognition"
```

---

### Task 6: Expose Bot-Authorized Group Management APIs

**Files:**
- Create: `tests/server-group-management-boundary.test.js`
- Modify: `src/server.js`
- Modify: `src/groups.js`

**Interfaces:**
- Consumes Tasks 1-3 persistence, rules, and WorkTool wrappers.
- Produces routes:
  - `GET /api/groups?botId=&search=&page=&pageSize=&refresh=`
  - `POST /api/groups/create`
  - `GET /api/groups/:groupId?botId=`
  - `PATCH /api/groups/:groupId/config`
  - `PATCH /api/groups/:groupId/external`
  - `POST /api/groups/:groupId/roles/merge`
- Every route returns `{ ok: true, ... }` on success and uses existing error
  middleware for validation, authorization, conflict, and WorkTool failures.

- [ ] **Step 1: Write failing route-boundary tests**

Assert every route calls `assertBotAccess()` before loading or mutating group
data. Add request-level tests for:

- list without refresh performs no WorkTool list call;
- refresh imports returned groups once;
- create filters selected targets to private contacts owned by the Bot;
- config update rejects a stale `expectedVersion` with HTTP `409`;
- external update produces no WorkTool call when the patch is empty;
- a local config save succeeds even if a separate external mutation fails;
- role merge never calls a kick/remove WorkTool command.

- [ ] **Step 2: Run route tests and verify failure**

Run:

```bash
node --test tests/server-group-management-boundary.test.js
```

Expected: FAIL because the routes do not exist.

- [ ] **Step 3: Add list, detail, and explicit refresh routes**

`GET /api/groups` defaults to local data. Only `refresh=1` calls
`listWorkToolGroups()`, imports the returned page, and returns normalized local
groups. Do not schedule another refresh.

The detail response includes:

```js
{
  group,
  roles,
  tagGroupIds,
  availableTagGroups
}
```

`availableTagGroups` comes from the selected Bot's Agent schema.

- [ ] **Step 4: Add create and external-modify routes**

Create returns a local `creating` record plus WorkTool acceptance:

```js
{
  ok: true,
  group,
  command: { accepted: result.code === 0, response: result }
}
```

External update accepts `expectedVersion`, `original`, and `next`; recompute the
diff on the server and never trust a client-supplied `changed` flag.

- [ ] **Step 5: Add local config, roles, and manual merge routes**

Validate policy enums, background length, tag-group IDs, and role payloads.
Require `SYSTEM_DATE_TAG_GROUP_ID` in bindings server-side. Save local state
transactionally, then run only planned member-remark changes and return
per-change outcomes:

```js
{
  group,
  roles,
  externalResults: [
    { roleId, status: "success" | "failed" | "skipped", message }
  ]
}
```

- [ ] **Step 6: Map conflicts and permission failures**

Return:

- `409` for version or same-name conflicts;
- `422` for invalid policy, tag group, or ambiguous target;
- `502` for WorkTool command rejection when no local result is involved;
- `200` with local result plus `externalResults` for partial external failure.

- [ ] **Step 7: Run focused API tests**

Run:

```bash
node --test tests/server-group-management-boundary.test.js tests/server-auth-boundary.test.js tests/server-workspace-boundary.test.js tests/workspace-auth.test.js
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server.js src/groups.js tests/server-group-management-boundary.test.js
git commit -m "Expose group management APIs"
```

---

### Task 7: Build the Group Management Tab and Split-Pane UI

**Files:**
- Create: `tests/console-group-management-boundary.test.js`
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Update: `tests/console-auth-boundary.test.js`

**Interfaces:**
- Consumes Task 6 APIs.
- Produces frontend functions:
  - `loadGroups({ refresh?: boolean, page?: number, search?: string })`
  - `selectManagedGroup(groupId)`
  - `renderManagedGroups()`
  - `renderManagedGroupConfig()`
  - `saveManagedGroupConfig()`

- [ ] **Step 1: Write failing console boundary tests**

Assert the static console contains:

- a Bot-locked/unlocked **群管理** navigation action;
- `#groupsTab`;
- a 30/70 split container;
- group search and explicit refresh controls;
- no message-history container inside `#groupsTab`;
- a **创建外部群** button;
- a **修改群信息** button;
- policy controls with the exact four role options;
- helper copy recommending **始终回复** for important customers.

- [ ] **Step 2: Run console tests and verify failure**

Run:

```bash
node --test tests/console-group-management-boundary.test.js tests/console-auth-boundary.test.js
```

Expected: FAIL because the tab does not exist.

- [ ] **Step 3: Add the HTML shell and navigation**

Add the new action between **会话** and **任务** or in the closest existing
business-navigation position. Preserve locked-state behavior used by the other
Bot tabs.

The right pane contains:

- current group summary;
- modify button;
- group default policy;
- background textarea;
- role editor;
- tag-group checkboxes with date disabled-on;
- local save button.

- [ ] **Step 4: Add scoped group state and API loading**

Extend console state with:

```js
groups: [],
groupsPagination: null,
selectedGroupId: "",
selectedGroupDetail: null,
groupsLoading: false,
groupsContextVersion: 0
```

Use the existing selected-Bot/context-version guards so a slow response from a
previous Bot cannot render into the current Bot.

Entering the tab calls `loadGroups({ refresh: true })` once for that explicit
entry. Searching and pagination use local API queries. Only the **刷新群列表**
button passes `refresh: true` again.

- [ ] **Step 5: Render list and configuration states**

Render:

- empty list instructions;
- loading and API error states;
- current name, source, creation date, and date source;
- `creating`, `failed`, `conflict`, and `待配置` badges;
- roles without joined/left/invited membership claims;
- tag groups by shared schema name.

- [ ] **Step 6: Implement optimistic local save**

Send `expectedVersion` from the loaded detail. On `409`, keep unsaved form
values, show a conflict message, and offer an explicit reload. On success,
replace the selected detail with the returned normalized data.

- [ ] **Step 7: Add responsive styles**

At desktop width, use `grid-template-columns: minmax(240px, 3fr) minmax(0, 7fr)`.
At the console's existing mobile breakpoint, stack the list above the detail.
Keep group styles under `.groups-*` selectors.

- [ ] **Step 8: Run focused UI boundary tests**

Run:

```bash
node --test tests/console-group-management-boundary.test.js tests/console-auth-boundary.test.js tests/console-session-type-boundary.test.js
```

Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add public/console/index.html public/console/app.js public/console/styles.css tests/console-group-management-boundary.test.js tests/console-auth-boundary.test.js
git commit -m "Add group management console tab"
```

---

### Task 8: Implement Create and Modify Dialog Workflows

**Files:**
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Update: `tests/console-group-management-boundary.test.js`

**Interfaces:**
- Consumes Task 6 create/external APIs and the existing proactive address-book
  target API.
- Produces:
  - `openCreateGroupDialog()`
  - `submitCreateGroupDialog()`
  - `openModifyGroupDialog()`
  - `submitModifyGroupDialog()`

- [ ] **Step 1: Add failing dialog tests**

Assert:

- create is a button plus dialog, not an expanded panel;
- the contact picker reuses private target data and filters `targetType === "private"`;
- the modify dialog prefills current name, announcement, and supported remark;
- create success closes the dialog and selects the returned local group;
- modify submit compares original and next values;
- an unchanged modify form does not call the API;
- public announcement copy is visually distinct from private Agent background.

- [ ] **Step 2: Run the dialog tests and verify failure**

Run:

```bash
node --test tests/console-group-management-boundary.test.js
```

Expected: FAIL on missing dialog behavior.

- [ ] **Step 3: Implement create dialog contact loading and submission**

Load the Push tab address-book endpoint for the current Bot, retain private
targets only, and provide search/multi-select. Disable submit while pending.

After success:

1. close dialog;
2. insert or replace the returned group in local state;
3. select its ID;
4. load its detail;
5. render the right-pane configuration.

- [ ] **Step 4: Implement differential modify dialog**

Store an immutable copy of the opened values. Before submission, compare
trimmed current fields. If no field changed, close with an informational toast
and make no request.

On partial or full failure, keep the dialog open and show field/command errors.
On success, update current display data and aliases from the API response.

- [ ] **Step 5: Render per-role remark synchronization outcomes**

After local config save, show each returned external result beside its role.
`skipped` must explain either “未选择同步” or “备注未变化”; `failed` retains the
desired value and offers the next explicit save as retry.

- [ ] **Step 6: Run focused frontend tests**

Run:

```bash
node --test tests/console-group-management-boundary.test.js tests/console-action-toolbox-boundary.test.js tests/console-auth-boundary.test.js
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add public/console/index.html public/console/app.js public/console/styles.css tests/console-group-management-boundary.test.js
git commit -m "Add group creation and modification dialogs"
```

---

### Task 9: Make Group Tag Alerts Navigate to Group Evidence

**Files:**
- Modify: `public/console/app.js`
- Modify: `public/console/tag-alert-client.js`
- Update: `tests/tag-alert-client.test.js`
- Update: `tests/console-group-management-boundary.test.js`

**Interfaces:**
- Consumes Task 5 group-aware alert payloads and the existing
  `openFlowSession(conversationKey, options)` behavior.
- Produces group-aware alert labels and unchanged mark-read semantics.

- [ ] **Step 1: Write failing group-alert client tests**

Add a group alert fixture:

```js
{
  id: 91,
  conversationType: "group",
  conversationKey: "bot-a:group-id:g1",
  groupId: "g1",
  groupName: "A售后群",
  senderName: "张三",
  tagName: "有情绪",
  evidenceMessageId: 123
}
```

Assert the rendered item says the group and sender, and clicking it calls:

```js
openFlowSession("bot-a:group-id:g1", {
  anchorMessageId: 123,
  alertTagName: "有情绪",
  missingEvidence: false
});
```

It must switch to **会话**, not **群管理**.

- [ ] **Step 2: Run alert tests and verify failure**

Run:

```bash
node --test tests/tag-alert-client.test.js tests/console-group-management-boundary.test.js
```

Expected: FAIL because alert copy assumes a private customer.

- [ ] **Step 3: Add conversation-type-aware rendering**

Private alert copy remains unchanged. Group alert copy uses:

```text
A售后群 · 张三
达成「有情绪」标签
```

Keep one sound per received alert batch and existing unread/read behavior.

- [ ] **Step 4: Verify group session lookup supports canonical keys**

Update session list/detail lookup only where required so
`bot:group-id:<uuid>` remains classified and rendered as a group. Do not infer
type only from the old `:group:<name>` key; prefer stored room type or managed
group identity.

- [ ] **Step 5: Run alert and session tests**

Run:

```bash
node --test tests/tag-alert-client.test.js tests/db-tag-alerts.test.js tests/console-session-type-boundary.test.js tests/server-group-conversation-boundary.test.js
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add public/console/app.js public/console/tag-alert-client.js tests/tag-alert-client.test.js tests/console-group-management-boundary.test.js
git commit -m "Navigate group tag alerts to evidence"
```

---

### Task 10: Full Regression, Live-Contract Checklist, and Documentation

**Files:**
- Modify: `README.md`
- Update: `tests/server-group-management-boundary.test.js`
- Update: `tests/server-group-reply-policy.test.js`
- Update: `tests/server-group-tags.test.js`

**Interfaces:**
- Consumes all earlier tasks.
- Produces documented operator requirements and a verified release candidate.

- [ ] **Step 1: Add final cross-channel isolation tests**

Create one Bot with a same-named private contact and group. Assert:

- group background appears only in the group request;
- group tag changes only the group conversation;
- private flow node and activation tasks remain unchanged;
- group tag activation targets the group while private tag activation continues
  to target the private contact;
- private handoff does not suppress the group;
- group config deletion or merge does not delete private messages.

- [ ] **Step 2: Add no-polling and no-op mutation boundaries**

Source-boundary assertions must prove:

- no `setInterval()` or worker calls `listWorkToolGroups()`;
- tab entry and refresh are the only frontend callers that request `refresh=1`;
- unchanged group information and unchanged role remarks do not call
  `/wework/sendRawMessage`.

- [ ] **Step 3: Run focused final feature tests**

Run:

```bash
node --test \
  tests/db-groups.test.js \
  tests/groups.test.js \
  tests/worktool-group-management.test.js \
  tests/server-group-management-boundary.test.js \
  tests/server-group-reply-policy.test.js \
  tests/server-group-tags.test.js \
  tests/console-group-management-boundary.test.js \
  tests/tag-alert-client.test.js
```

Expected: all PASS.

- [ ] **Step 4: Run the complete test suite**

Run:

```bash
npm test
```

Expected: all tests PASS with no unhandled rejection, leaked server, or SQLite
constraint warning.

- [ ] **Step 5: Perform local console smoke verification**

Start:

```bash
npm run dev
```

Verify with a configured local Bot:

1. unlock the Bot and open **群管理**;
2. confirm the 30/70 layout and no message history;
3. enter the tab and observe one explicit group synchronization;
4. create a group and confirm automatic selection;
5. configure background, role policy, and tag groups;
6. save unchanged values and confirm no external command in logs;
7. open modify dialog and verify prefilled fields;
8. trigger always, mention-only, never, and inherited reply cases;
9. trigger an alert-enabled group tag and navigate to evidence in **会话**;
10. trigger a tag with activation configured and verify its due message is sent
    to the group;
11. confirm private task and tag state did not change.

Stop the development server after verification.

- [ ] **Step 6: Document operator requirements and limitations**

Add a README section stating:

- WorkTool callbacks require `openCallback=1` and `replyAll=1`;
- WorkTool's group-list API is deprecated and is never polled;
- roles are manually maintained and are not a live membership list;
- callback member identity is name-based and external renames require manual
  merge;
- external group mutations require Bot group permissions;
- command acceptance is distinct from device execution;
- group name restrictions and WorkTool request limits apply.

- [ ] **Step 7: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors; only intended feature files plus pre-existing
user changes are present.

- [ ] **Step 8: Commit**

```bash
git add README.md tests/server-group-management-boundary.test.js tests/server-group-reply-policy.test.js tests/server-group-tags.test.js
git commit -m "Document and verify group management"
```
