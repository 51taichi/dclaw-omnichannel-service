# 人工接手会话全局置顶实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让人工接手会话在服务端分页前全局置顶，清除客户搜索后仍出现在第一页顶部。

**Architecture:** 保持现有 API、过滤条件和前端即时排序不变，只调整 `listFlowSessionsPage` 的数据库排序。数据库首先按接手状态分组，再按最后消息时间和 ID 排序，随后执行分页，因此浏览器收到的每一页都符合全局顺序。

**Tech Stack:** Node.js、SQLite `node:sqlite`、Node test runner。

## Global Constraints

- 过滤发生在排序和分页之前。
- 人工接手会话优先；各状态组内按 `last_message_at DESC, id DESC` 排序。
- 切换接手状态不得修改 `last_message_at`。
- 不新增接口，不额外拉取或合并人工会话列表。
- 直接使用当前 `main`，不创建分支。

---

### Task 1: 服务端分页前全局置顶

**Files:**
- Modify: `src/db.js:6002-6060`
- Test: `tests/db-pagination.test.js`

**Interfaces:**
- Consumes: `listFlowSessionsPage({ botId, page, pageSize, type, query, nodeId, tagFilters, dateTag })`。
- Produces: 相同返回结构 `{ items, pagination }`，但 `items` 在分页前按人工接手优先排序。

- [ ] **Step 1: 写出失败的数据库回归测试**

在 `tests/db-pagination.test.js` 中创建超过一页的会话。目标会话使用较旧的 `last_message_at`，先验证普通情况下不在第一页；通过现有 `updateFlowSessionHandoff` 将其切换为 `human`，再调用无搜索条件的 `listFlowSessionsPage`，断言目标会话位于第一页第一条，并断言它的 `lastMessageAt` 没有变化。其余 AI 会话应保持按最后消息时间倒序。

```js
test("human handoff sessions stay globally pinned after clearing search", () => {
  const before = getFlowSessionForBot({ botId, conversationKey: targetKey });
  assert.equal(listFlowSessionsPage({ botId, page: 1, pageSize: 2 }).items.some(
    (item) => item.conversationKey === targetKey
  ), false);

  assert.equal(listFlowSessionsPage({
    botId,
    page: 1,
    pageSize: 2,
    query: targetName
  }).items[0].conversationKey, targetKey);

  updateFlowSessionHandoff({
    botId,
    conversationKey: targetKey,
    handoffStatus: "human",
    handoffBy: "console",
    reason: "测试人工接手"
  });

  const page = listFlowSessionsPage({ botId, page: 1, pageSize: 2 });
  assert.equal(page.items[0].conversationKey, targetKey);
  assert.equal(
    getFlowSessionForBot({ botId, conversationKey: targetKey }).lastMessageAt,
    before.lastMessageAt
  );
});
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node --test tests/db-pagination.test.js`

Expected: 新测试在清除搜索后的第一页断言失败，因为当前 SQL 只按 `last_message_at DESC, id DESC` 排序。

- [ ] **Step 3: 修改服务端 SQL 排序**

在 `listFlowSessionsPage` 查询中将排序改为：

```sql
ORDER BY
  CASE WHEN fs.handoff_status = 'human' THEN 0 ELSE 1 END ASC,
  fs.last_message_at DESC,
  fs.id DESC
LIMIT ? OFFSET ?
```

不要修改 `updateFlowSessionHandoff` 的 `last_message_at`。

- [ ] **Step 4: 运行聚焦测试**

Run: `node --test tests/db-pagination.test.js tests/console-handoff-boundary.test.js tests/console-session-type-boundary.test.js`

Expected: 全部通过，且没有错误或警告。

- [ ] **Step 5: 运行完整回归与差异检查**

Run: `npm test`

Expected: 0 failed。

Run: `git diff --check`

Expected: 无输出并返回 0。

- [ ] **Step 6: 提交并推送 main**

```bash
git add src/db.js tests/db-pagination.test.js
git commit -m "fix: pin human handoff sessions globally"
git push origin main
```

