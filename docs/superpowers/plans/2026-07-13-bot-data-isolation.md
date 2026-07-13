# Bot 数据隔离 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让每一个控制台业务数据读写和异步展示都严格按 `botId` 隔离。

**Architecture:** 数据层为会话和回调操作增加 `botId` 条件，服务路由在读取或变更会话前验证归属，控制台使用 Bot 上下文版本令牌丢弃过期异步结果。全局 worker 继续运行，但仅处理记录中保存的 Bot。

**Tech Stack:** Node.js 22、Express、SQLite、原生浏览器 JavaScript、node:test。

## Global Constraints

- 不修改用户现有业务数据。
- 不把 API key 写入控制台响应或日志。
- `conversationKey` 不得单独作为授权条件。
- 每项生产代码先有对应失败测试。

---

### Task 1: 数据层会话和回调隔离

**Files:**
- Modify: `src/db.js`
- Modify: `tests/db-bot-isolation.test.js`

- [ ] 写入 Bot A/B 会话测试：A 无法通过 B 的会话键读取消息、事件或重置 B；命令回调只能更新同 Bot 的发送行。
- [ ] 运行 `node --test tests/db-bot-isolation.test.js`，确认在旧实现上失败。
- [ ] 让会话读取、节点更新、重置、消息/事件列表和回调更新同时按 `botId` 与键/消息 ID 查询。
- [ ] 重跑隔离测试并确认通过。

### Task 2: 服务端会话归属和媒体上传隔离

**Files:**
- Modify: `src/server.js`
- Modify: `tests/server-bot-isolation-boundary.test.js`

- [ ] 写入路由边界测试：会话详情、节点修改、重置必须传递 Bot 归属；回调传递 `botId`；上传需验证 Bot 访问权。
- [ ] 运行 `node --test tests/server-bot-isolation-boundary.test.js`，确认旧源码断言失败。
- [ ] 实现请求 Bot 校验、上传按 Bot 目录保存和命令回调 Bot 作用域。
- [ ] 重跑服务边界测试并确认通过。

### Task 3: 控制台 Bot 切换异步边界

**Files:**
- Modify: `public/console/app.js`
- Modify: `tests/console-auth-boundary.test.js`

- [ ] 写入测试覆盖保存状态机、任务详情、上传后创建推送、解锁密钥和人工接手的 Bot 上下文校验。
- [ ] 运行 `node --test tests/console-auth-boundary.test.js`，确认缺失保护时失败。
- [ ] 让每个异步写回捕获发起时 `botId/contextVersion`，Bot 已切换则丢弃结果；切换时清除各类草稿。
- [ ] 重跑前端边界测试并确认通过。

### Task 4: 全量验证与提交

**Files:**
- Modify: 仅上述实现和测试文件

- [ ] 运行 `npm test`。
- [ ] 审核 `git diff --check` 与 `git status --short`，确保没有无关文件。
- [ ] 提交隔离实现并推送分支，合并回 `main` 后再部署。
