# 新增好友再次进入流程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让重复新增好友回调在十分钟冷却后重新进入入口流程并重新计时激活。

**Architecture:** 为 `flow_sessions` 新增 `last_friend_added_at`，由一个数据库事务在首次或过期事件时更新会话、作废旧任务和激活 generation。服务端只负责把成功重入后的会话交给现有调度器。

**Tech Stack:** Node.js 22、Express 5、`node:sqlite`、Node test runner。

## Global Constraints

- 十分钟内的同一 `botId + friendName` 回调必须去重。
- 流程重入不删除聊天原文和客户资产。
- 流程重入取消旧激活任务并恢复 AI 接待。
- 不修改 DClaw Agent 文件或协议。

---

### Task 1: 持久化并原子化新增好友流程重入

**Files:**
- Modify: `src/db.js`
- Test: `tests/db-friend-added-reentry.test.js`

- [ ] 写失败测试：首次事件创建会话；十分钟内事件返回 cooldown；十分钟后事件重入入口、保留资产并取消旧任务。
- [ ] 运行 `npm test -- tests/db-friend-added-reentry.test.js`，确认测试因缺少 helper 而失败。
- [ ] 新增迁移列及 `beginFriendAddedFlowEntry({ botId, conversationKey, machine, cooldownMs, occurredAt })`，在事务内完成判断和状态更新。
- [ ] 重跑该测试并提交数据库改动。

### Task 2: 让新增好友回调使用原子流程重入

**Files:**
- Modify: `src/server.js`
- Modify: `tests/server-friend-added-activation-boundary.test.js`

- [ ] 写失败测试：服务端使用 `beginFriendAddedFlowEntry`，并记录 `friend_added_cooldown`。
- [ ] 运行 `npm test -- tests/server-friend-added-activation-boundary.test.js`，确认失败。
- [ ] 用数据库 helper 替代 existing-session 分支；成功时使用返回会话调用现有 `scheduleCurrentActivation`。
- [ ] 重跑目标测试和完整 `npm test`。

### Task 3: 文档与验证

**Files:**
- Modify: `README.md`
- Modify: `.env.example`

- [ ] 记录 `FRIEND_ADDED_REENTRY_COOLDOWN_MINUTES=10` 默认值及重入不会删除聊天或资产。
- [ ] 执行完整 `npm test`。
- [ ] 提交并推送 `main`。
