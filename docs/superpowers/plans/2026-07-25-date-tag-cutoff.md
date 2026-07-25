# 添加日期特殊标签组与切日时间 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将客户添加日期改为固定特殊标签组，并支持 Agent 级北京时间切日时间，同时保证规则只影响生效后的新客户。

**Architecture:** 在 `src/tags.js` 中集中处理切日时间归一化和业务日期计算；在 `src/db.js` 中集中维护服务端 `effectiveAt` 并提供幂等的日期标签创建入口；新增好友流程和普通会话首次入库都复用该入口。控制台把特殊日期组固定渲染在普通标签组之前，导入导出只传递可配置字段。

**Tech Stack:** Node.js ES modules、Express、`node:sqlite`、原生 HTML/CSS/JavaScript、Node test runner。

## Global Constraints

- 所有日期计算使用 `Asia/Shanghai`。
- `cutoffTime` 格式为 `HH:mm`，非法值归一化为 `00:00`。
- `00:00` 保持现有北京时间自然日语义。
- 非零切日时间达到整分钟时归入次日。
- 规则修改、停用和重新启用都不修改已有日期标签。
- 日期规则只对 `effectiveAt` 之后的新私聊客户生效。
- `effectiveAt` 只能由服务端维护，不能由前端导入覆盖。
- 普通标签组、会话筛选、推送筛选、激活任务和 Agent 判定逻辑保持不变。
- 不引入新依赖。

---

### Task 1: 切日时间归一化与业务日期计算

**Files:**
- Modify: `src/tags.js`
- Test: `tests/tags.test.js`

**Interfaces:**
- Produces: `normalizeDateTagCutoffTime(value): string`
- Produces: `dateTagIdFor(value, cutoffTime = "00:00"): string`
- Produces: `normalizeTagSchema(raw).dateTag` with `{ enabled, cutoffTime, effectiveAt }`
- Consumes: existing `Asia/Shanghai` date formatting

- [ ] **Step 1: Write failing cutoff normalization and date boundary tests**

Add tests covering:

```js
assert.equal(normalizeDateTagCutoffTime("20:00"), "20:00");
assert.equal(normalizeDateTagCutoffTime("7:05"), "07:05");
assert.equal(normalizeDateTagCutoffTime("24:00"), "00:00");
assert.equal(normalizeDateTagCutoffTime(""), "00:00");

assert.equal(dateTagIdFor("2026-07-25T11:59:00.000Z", "20:00"), "20260725");
assert.equal(dateTagIdFor("2026-07-25T12:00:00.000Z", "20:00"), "20260726");
assert.equal(dateTagIdFor("2026-12-31T12:00:00.000Z", "20:00"), "20270101");
assert.equal(dateTagIdFor("2026-07-25T16:30:00.000Z", "00:00"), "20260726");
```

Also assert that an old schema normalizes to:

```js
{
  enabled: true,
  cutoffTime: "00:00",
  effectiveAt: ""
}
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
node --test tests/tags.test.js
```

Expected: FAIL because `normalizeDateTagCutoffTime` is not exported and `dateTagIdFor` ignores the cutoff.

- [ ] **Step 3: Implement the date rule primitives**

Implement:

```js
export function normalizeDateTagCutoffTime(value = "00:00") {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "00:00";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return "00:00";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
```

Extend the Beijing formatter to return hour and minute. In `dateTagIdFor`, preserve natural-date behavior for `00:00`; otherwise add one calendar day when Beijing local minutes are greater than or equal to the cutoff. Use UTC calendar arithmetic on the extracted Beijing year/month/day to handle month, year, and leap-day rollover deterministically.

Normalize `effectiveAt` only when it is a valid ISO timestamp; otherwise use an empty string.

- [ ] **Step 4: Run the focused tests**

Run:

```bash
node --test tests/tags.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tags.js tests/tags.test.js
git commit -m "Add configurable date tag cutoff calculation"
```

---

### Task 2: 服务端日期规则生效时间与幂等写入

**Files:**
- Modify: `src/db.js`
- Test: `tests/db-tags.test.js`

**Interfaces:**
- Consumes: `normalizeTagSchema(raw)` and `dateTagIdFor(value, cutoffTime)`
- Produces: `ensureConversationDateTag({ botId, agentId, conversationKey, firstSeenAt, source }): ConversationTag[] | null`
- Produces: `initializeLegacyDateTagRuleEffectiveTimes(): number`
- Changes: `upsertAgentTagSchema({ agentId, schema })` assigns or preserves `effectiveAt`

- [ ] **Step 1: Replace historical-backfill expectations with future-only tests**

Update the current “saving an enabled date tag schema backfills existing private conversations” test so it asserts:

```js
const beforeEnable = upsertConversation(...);
const saved = upsertAgentTagSchema({
  agentId,
  schema: { dateTag: { enabled: true, cutoffTime: "20:00" }, groups: [] }
});
assert.ok(saved.config.dateTag.effectiveAt);
assert.deepEqual(listConversationTags({ botId, agentId, conversationKey: beforeEnable.conversationKey }), []);
```

Add tests for:

- a conversation created after enable receives a date tag;
- unchanged saves preserve `effectiveAt`;
- changing `cutoffTime` advances `effectiveAt` and preserves existing date tags;
- disabling preserves tags and blocks new tags;
- re-enabling creates a new `effectiveAt`;
- an existing date tag is never replaced by a later ensure call;
- legacy enabled configs receive an `effectiveAt` during initialization without writing `conversation_tags`.

- [ ] **Step 2: Run the focused database tests and verify failure**

Run:

```bash
node --test tests/db-tags.test.js
```

Expected: FAIL because current save/startup behavior backfills history and existing date tags are replaced.

- [ ] **Step 3: Implement server-owned rule transitions**

In `upsertAgentTagSchema`:

1. Load and normalize the existing schema.
2. Normalize the requested schema while ignoring a client-provided `effectiveAt`.
3. Preserve the old `effectiveAt` only when `enabled` and `cutoffTime` are unchanged.
4. Set `effectiveAt = timestamp` when enabling or changing `cutoffTime`.
5. Clear `effectiveAt` while disabled.
6. Remove `backfillConversationFirstSeenDateTags(agentId)`.

Use an internal helper with this interface:

```js
function resolveDateTagRuleForSave({ previous, requested, timestamp }) {
  return { enabled, cutoffTime, effectiveAt };
}
```

- [ ] **Step 4: Implement one idempotent date-tag creation path**

Add:

```js
export function ensureConversationDateTag({
  botId,
  agentId,
  conversationKey,
  firstSeenAt,
  source = "conversation_first_seen"
}) {
  // Validate private conversation, enabled rule, effectiveAt boundary,
  // and absence of an existing date tag before inserting.
}
```

The function must:

- return `null` when ineligible;
- return current tags without mutation when a date tag already exists;
- calculate the ID with `dateTagIdFor(firstSeenAt, schema.dateTag.cutoffTime)`;
- insert one date tag using the existing unique constraint;
- never delete or replace another date tag.

Change `syncConversationFirstSeenDateTag` to call this function. Keep the `upsertConversation` safety path, with eligibility enforced by `effectiveAt`.

Change `upsertSystemDateTag` to preserve an existing date tag rather than deleting it. Retain it as a low-level compatibility function for tests and existing callers.

- [ ] **Step 5: Replace startup backfill with legacy-rule initialization**

Replace `backfillEnabledConversationFirstSeenDateTags` with:

```js
export function initializeLegacyDateTagRuleEffectiveTimes() {
  // For enabled schemas missing effectiveAt, persist cutoffTime and now().
  // Never read or write conversations/conversation_tags.
}
```

Return the number of migrated Agent schemas for structured startup logging.

- [ ] **Step 6: Run database tests**

Run:

```bash
node --test tests/db-tags.test.js tests/db-reset.test.js tests/db-proactive-scheduling.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db.js tests/db-tags.test.js tests/db-reset.test.js tests/db-proactive-scheduling.test.js
git commit -m "Make date tag rules future-only"
```

---

### Task 3: 新增好友流程使用统一日期标签入口

**Files:**
- Modify: `src/server.js`
- Test: `tests/server-tags-boundary.test.js`
- Test: `tests/server-friend-added-activation-boundary.test.js`

**Interfaces:**
- Consumes: `ensureConversationDateTag(...)`
- Consumes: `initializeLegacyDateTagRuleEffectiveTimes()`
- Removes: server-side direct use of `dateTagIdFor` for friend-added tags

- [ ] **Step 1: Add failing server boundary tests**

Assert that:

```js
assert.match(source, /ensureConversationDateTag\(\{[\s\S]*firstSeenAt:/);
assert.doesNotMatch(source, /dateTagId:\s*dateTagIdFor\(firstSeenAt/);
assert.match(source, /initializeLegacyDateTagRuleEffectiveTimes\(\)/);
assert.doesNotMatch(source, /backfillEnabledConversationFirstSeenDateTags\(\)/);
```

Keep the existing assertion that `friend_added.date_tag.applied` is logged.

- [ ] **Step 2: Run focused server tests and verify failure**

Run:

```bash
node --test tests/server-tags-boundary.test.js tests/server-friend-added-activation-boundary.test.js
```

Expected: FAIL because the server still computes and upserts date tags directly.

- [ ] **Step 3: Update friend-added and startup wiring**

Change `applySystemDateTag` to call:

```js
ensureConversationDateTag({
  botId,
  agentId: binding.agentId,
  conversationKey,
  firstSeenAt: firstSeenAt || new Date(),
  source: "friend_added"
});
```

Replace the startup backfill call and log with:

```js
const migratedDateTagRuleCount = initializeLegacyDateTagRuleEffectiveTimes();
logInfo("customer_date_tag_rules.migrated", { agentCount: migratedDateTagRuleCount });
```

Do not change normal private messages, group handling, flow activation, tag activation, or friend-added re-entry behavior.

- [ ] **Step 4: Run focused server tests**

Run:

```bash
node --test tests/server-tags-boundary.test.js tests/server-friend-added-activation-boundary.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server.js tests/server-tags-boundary.test.js tests/server-friend-added-activation-boundary.test.js
git commit -m "Apply date cutoff in friend-added flow"
```

---

### Task 4: 固定“添加日期”特殊标签组 UI

**Files:**
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Test: `tests/console-tags-boundary.test.js`
- Test: `tests/console-auth-boundary.test.js`

**Interfaces:**
- Consumes: `schema.dateTag.enabled`
- Consumes: `schema.dateTag.cutoffTime`
- Produces: save payload `dateTag: { enabled, cutoffTime }`
- Produces: export payload without `effectiveAt`

- [ ] **Step 1: Write failing console structure tests**

Add assertions that the rendered editor contains:

```js
class="tag-group-card date-tag-special-group"
id="dateTagEnabled"
id="dateTagCutoffTime"
type="time"
value="00:00"
```

Assert that the special group is emitted before normal groups and its markup does not contain:

```text
data-add-tag
data-remove-tag-group
data-toggle-tag-group
data-tag-group-field="exclusive"
data-tag-group-field="oneWay"
```

Update the startup toggle test so it checks the dynamically rendered special group rather than the removed static toolbar switch.

- [ ] **Step 2: Run focused console tests and verify failure**

Run:

```bash
node --test tests/console-tags-boundary.test.js tests/console-auth-boundary.test.js
```

Expected: FAIL because the date toggle still lives in the toolbar and no cutoff input exists.

- [ ] **Step 3: Extend client-side schema normalization**

Change:

```js
function defaultTagSchema() {
  return {
    dateTag: { enabled: false, cutoffTime: "00:00", effectiveAt: "" },
    groups: []
  };
}
```

Normalize `cutoffTime` to `HH:mm` with a browser-side helper matching server behavior. Preserve `effectiveAt` only for local state display; never source it from import files.

- [ ] **Step 4: Render the special group first**

Remove the static date-tag switch from `.tag-schema-toolbar`.

Create `renderDateTagSpecialGroup()` returning one non-collapsible card:

```html
<article class="tag-group-card date-tag-special-group">
  <div class="tag-group-head">
    <label class="toggle switch-toggle tag-group-enabled-toggle">
      <input id="dateTagEnabled" type="checkbox" />
      <span class="switch-slider" aria-hidden="true"></span>
      <span class="switch-label">启用</span>
    </label>
    <div class="field-row date-tag-name-field">
      <span class="field-label">标签组</span>
      <strong>添加日期</strong>
    </div>
    <label class="date-tag-cutoff-field">
      <span class="field-label">切日时间</span>
      <input id="dateTagCutoffTime" type="time" step="60" value="00:00" />
    </label>
  </div>
</article>
```

Set `tagGroupList.innerHTML` to the special group followed by normal groups. Rebind the special switch and time input after every render.

- [ ] **Step 5: Save, import, and export only editable date fields**

When saving:

```js
dateTag: {
  enabled: dateTagEnabledInput().checked,
  cutoffTime: normalizeDateTagCutoffTimeDraft(dateTagCutoffInput().value)
}
```

When exporting, omit `effectiveAt`. When importing, normalize missing or invalid cutoff to `00:00`. Clearing the time input restores `00:00`.

- [ ] **Step 6: Add scoped special-group styling**

Add CSS so the card:

- uses the same border, background, spacing, and height as normal group headers;
- remains first and always expanded;
- gives the fixed name and time input stable grid widths;
- stacks cleanly in the existing mobile breakpoint;
- has no empty action-button area.

Do not change ordinary `.tag-group-card` collapse animations.

- [ ] **Step 7: Run focused console tests**

Run:

```bash
node --test tests/console-tags-boundary.test.js tests/console-auth-boundary.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add public/console/index.html public/console/app.js public/console/styles.css tests/console-tags-boundary.test.js tests/console-auth-boundary.test.js
git commit -m "Render date tags as a special fixed group"
```

---

### Task 5: 回归验证与发布准备

**Files:**
- Modify only if a failing regression directly requires it
- Test: all repository tests

**Interfaces:**
- Consumes all prior tasks
- Produces a deployable `main` branch with no date-tag regression

- [ ] **Step 1: Run all date-tag and console tests**

Run:

```bash
node --test tests/tags.test.js tests/db-tags.test.js tests/db-reset.test.js tests/db-proactive-scheduling.test.js tests/server-tags-boundary.test.js tests/server-friend-added-activation-boundary.test.js tests/console-tags-boundary.test.js tests/console-auth-boundary.test.js
```

Expected: PASS.

- [ ] **Step 2: Run the full suite**

Run:

```bash
npm test
```

Expected: PASS. If the known proactive target ordering assertion fails independently, rerun `tests/db-proactive-scheduling.test.js` and report it separately without changing unrelated ordering behavior.

- [ ] **Step 3: Check formatting and final diff**

Run:

```bash
git diff --check
git status --short
git log --oneline -6
```

Confirm only feature files are committed and existing unrelated dirty files remain untouched.

- [ ] **Step 4: Push**

```bash
git push origin main
```

Expected: `main` advances through the feature commits.
