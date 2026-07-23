# 推送标签选择与定时推送实施计划

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

Goal: 为推送 tab 增加按客户标签全量选择和一次性可取消定时推送，同时保持现有立即推送及其他 tab 行为不变。

Architecture: 复用现有 proactive_tasks、proactive_task_targets 和主动推送 worker。数据库用可空 scheduled_at 区分立即任务和定时任务，用 canceled 状态取消未领取目标；标签选择通过服务端按 Bot 的 agent 关联 conversation_tags 查询全量私聊目标，前端把结果合并进现有 selectedTargets。所有 API 继续使用现有 Bot 访问校验。

Tech Stack: Node.js, Express, node:sqlite, vanilla HTML/CSS/JavaScript, Node test runner.

---

### Task 1: 数据库定时任务状态和标签目标查询

Files:
- Modify: src/db.js：proactive schema、row mapper、目标查询、任务创建/领取/取消
- Test: tests/db-proactive-scheduling.test.js：新增数据库行为测试

- [ ] Step 1: Write the failing tests

新增数据库隔离测试，覆盖这些行为：

1. listProactiveTargetTags 返回当前 Bot 下的普通标签和日期标签，并且不返回另一个 Bot 的标签。
2. listProactiveAddressBookTargetsPage 接收 tagFilters，多个标签按 OR 组合，客户 B 同时命中多个标签时只返回一次。
3. createProactiveTask 保存 scheduledAt；未到时间时 claimNextProactiveTarget 返回 null，到时间后按目标 ID 顺序领取。
4. cancelProactiveTask 将 pending 目标改为 canceled，已发送目标保持 sent，取消后 worker 无法继续领取。

Run: node --test tests/db-proactive-scheduling.test.js

Expected: FAIL，因为 scheduledAt、listProactiveTargetTags、tagFilters、带时间的领取和 cancelProactiveTask 尚未实现。

- [ ] Step 2: Add the minimal database implementation

在 proactive_tasks 增加 migration-safe 字段 scheduled_at、canceled_at、cancel_reason，并在 rowToProactiveTask 暴露 scheduledAt、canceledAt、cancelReason。

扩展 createProactiveTask 保存 scheduledAt；扩展 proactiveAddressBookTargetsWhere，按绑定 agent_id 和 conversation_tags 的 EXISTS 子查询匹配私聊目标，多个 tagFilters 使用 OR；新增 listProactiveTargetTags 查询该 Bot 下启用私聊目标的 distinct normal/date 标签。

将 claimNextProactiveTarget 改为接收 nowIso，连接 proactive_tasks 并要求目标 pending 且 task.scheduled_at 为空或不晚于 nowIso。新增事务函数 cancelProactiveTask，拒绝不存在或已结束任务，取消所有 pending 子目标，再将任务标记 canceled 并记录原因。

- [ ] Step 3: Run focused and existing database tests

Run: node --test tests/db-proactive-scheduling.test.js tests/db-pagination.test.js tests/db-tags.test.js

Expected: focused tests and existing immediate proactive pagination/tag tests pass.

- [ ] Step 4: Commit the database slice

Run: git add src/db.js tests/db-proactive-scheduling.test.js && git commit -m "feat: add scheduled proactive task persistence"

### Task 2: Server API and worker scheduling boundary

Files:
- Modify: src/server.js：时间规范化、主动推送 API、worker 调用
- Test: tests/server-proactive-scheduling-boundary.test.js

- [ ] Step 1: Write the failing boundary tests

验证 server.js 包含：scheduledAt 解析和校验、createProactiveTask 传递 scheduledAt、GET /api/proactive/targets/tags、POST /api/proactive/tasks/:taskId/cancel、assertBotAccess、listProactiveTargetTags 和 cancelProactiveTask。

Run: node --test tests/server-proactive-scheduling-boundary.test.js

Expected: FAIL，因为新路由和时间处理尚不存在。

- [ ] Step 2: Implement the minimal server behavior

新增北京时间 YYYY-MM-DDTHH:mm 到 ISO 的解析函数，拒绝格式错误和不晚于当前时间的值。创建任务时传入 scheduledAt；未来任务不立即调用 processNextProactiveTarget，立即任务保持当前唤醒行为。

新增标签列表路由和带 tag 参数的目标查询参数，所有查询先 assertBotAccess。新增取消路由，按任务所属 Bot 校验后调用 cancelProactiveTask，返回任务及目标。

worker 调用 claimNextProactiveTarget({ nowIso: new Date().toISOString() })，其余 WorkTool 发送和重试逻辑不变。

- [ ] Step 3: Run server tests and commit

Run: node --test tests/server-proactive-scheduling-boundary.test.js tests/server-flow-actions-boundary.test.js tests/server-tags-api-boundary.test.js

Expected: PASS.

Run: git add src/server.js tests/server-proactive-scheduling-boundary.test.js && git commit -m "feat: expose scheduled proactive push APIs"

### Task 3: Push tab markup and styles

Files:
- Modify: public/console/index.html, public/console/styles.css
- Test: tests/console-proactive-scheduling-boundary.test.js

- [ ] Step 1: Write failing UI contract tests

验证 proactivePanel 包含 targetTagSelect、proactiveScheduleEnabled、proactiveScheduledAt；验证 cancel action hook 和 proactive-schedule 样式作用域。

Run: node --test tests/console-proactive-scheduling-boundary.test.js

Expected: FAIL，因为新控件不存在。

- [ ] Step 2: Add scoped controls

在 target-toolbar 增加紧凑标签选择 select，选项按标签组渲染；在 proactiveMessageFields 增加定时开关和隐藏的 datetime-local 输入；主动推送任务行在现有任务渲染位置增加取消按钮。

仅增加 proactive 相关 CSS，不调整其他 tab 共用布局、分页、按钮和列表规则。

- [ ] Step 3: Run UI tests and commit

Run: node --test tests/console-proactive-scheduling-boundary.test.js tests/console-handoff-boundary.test.js

Expected: PASS，既有推送布局断言保持通过。

Run: git add public/console/index.html public/console/styles.css tests/console-proactive-scheduling-boundary.test.js && git commit -m "feat: add proactive tag and schedule controls"

### Task 4: Push tab behavior

Files:
- Modify: public/console/app.js
- Test: tests/console-proactive-scheduling-boundary.test.js

- [ ] Step 1: Extend failing behavior tests

验证 app.js 加载标签、请求 tagFilters、跨页读取标签目标、提交 scheduledAt、调用取消 API，并保留全选私聊/全选群组逻辑。

Run: node --test tests/console-proactive-scheduling-boundary.test.js

Expected: FAIL，因为行为函数和 payload 字段不存在。

- [ ] Step 2: Implement tag selection, scheduling, and cancellation

新增标签选择状态和 DOM 引用。Bot 切换时从 /api/proactive/targets/tags 加载标签；接口失败不清除已选目标。选择标签时循环读取所有分页并按 targetKey 合并；再次取消同一标签时，只移除由该标签加入且没有被手动或其他标签保留的目标。

扩展 createProactiveTask：定时开关开启时校验未来日期时间并发送 scheduledAt，关闭时保持旧 payload 和立即发送流程。成功后清空定时控件。

任务列表显示定时时间和取消按钮；取消调用 POST /api/proactive/tasks/:taskId/cancel，刷新当前任务分页。现有目标分页、全选和清空逻辑不改。

- [ ] Step 3: Run all console tests and commit

Run: node --test tests/console-proactive-scheduling-boundary.test.js tests/console-session-type-boundary.test.js tests/console-tags-boundary.test.js tests/console-flow-actions-boundary.test.js

Expected: PASS.

Run: git add public/console/app.js tests/console-proactive-scheduling-boundary.test.js && git commit -m "feat: select proactive targets by tag and schedule delivery"

### Task 5: Full verification and push

- [ ] Step 1: Run complete test suite

Run: npm test

Expected: exit code 0 and zero failures.

- [ ] Step 2: Check diff and unrelated worktree state

Run: git diff --check HEAD~4..HEAD && git status --short --branch && git log --oneline -6

Expected: feature commits are ahead of origin/main; existing unrelated dirty files remain unstaged and untouched.

- [ ] Step 3: Push

Run: git push origin main

Expected: remote main advances and local branch is synchronized.

- [ ] Step 4: Report commit IDs, test result, and scope

Report the pushed commits and confirm the change is limited to push tab plus proactive persistence/API/worker paths.
