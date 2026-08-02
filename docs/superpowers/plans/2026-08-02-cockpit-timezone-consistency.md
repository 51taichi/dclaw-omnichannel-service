# 驾驶舱时间口径一致性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一驾驶舱北京时间周期并兼容已经按 UTC 周期保存的历史快照和日报。

**Architecture:** 驾驶舱领域层提供唯一时区常量、规范周期和历史候选周期；聚合与 API 均消费该接口。数据库配置固定归一为系统时区，API 只读回退旧周期，不修改历史数据。

**Tech Stack:** Node.js、Express、SQLite、`node:test`

## Global Constraints

- 系统时区固定为 `Asia/Shanghai`。
- 概览接口保持只读，不聚合、不调用 AI。
- 不修改核心回复、任务推进、标签判断或 Agent 调用链路。

---

### Task 1: 周期口径与历史候选

**Files:**
- Modify: `src/cockpit-domain.js`
- Test: `tests/cockpit-domain.test.js`

**Interfaces:**
- Produces: `COCKPIT_TIME_ZONE`、`cockpitPeriodCandidates({ type, anchor })`

- [x] 写入失败测试，断言默认周期使用北京时间且历史候选包含相同日期的 UTC 周期。
- [x] 运行 `node --test tests/cockpit-domain.test.js`，确认因接口缺失失败。
- [x] 实现固定时区与候选周期。
- [x] 再次运行领域测试并确认通过。

### Task 2: 聚合和读取统一

**Files:**
- Modify: `src/cockpit-aggregator.js`
- Modify: `src/server.js`
- Modify: `src/db.js`
- Test: `tests/server-cockpit-boundary.test.js`
- Test: `tests/cockpit-aggregator.test.js`

**Interfaces:**
- Consumes: `COCKPIT_TIME_ZONE`、`cockpitPeriodCandidates({ type, anchor })`

- [x] 写入失败测试，断言概览按候选周期只读查找且配置不依赖运行环境时区。
- [x] 运行目标测试，确认因旧实现失败。
- [x] 聚合固定写北京时间周期，概览按北京时间优先、UTC 历史周期回退，并以相同规则筛选日报。
- [x] 运行目标测试并确认通过。

### Task 3: 完整验证

**Files:**
- Verify only

- [x] 运行所有驾驶舱测试。
- [x] 运行 `npm test`。
- [x] 检查 `git diff --check` 和改动范围。
- [ ] 提交并推送 main。
