# 群定时任务响应式布局修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复群定时任务卡在中等宽度下被裁切的问题，并保护所有长文本场景。

**Architecture:** 由 `.group-automation-section` 提供 inline-size 容器上下文，任务卡根据自身可用宽度切换三列、两列和单列。继续保留页面媒体查询处理整个群管理工作台，文字保护由各自组件内部完成。

**Tech Stack:** 原生 HTML、CSS Container Queries、Node.js `node:test`、现有浏览器验收流程。

## Global Constraints

- 保留现有卡片、SVG icon、状态胶囊、按钮顺序和操作方式。
- 不改变定时任务业务状态、接口或数据结构。
- 不引入新依赖。
- 群定时任务列表继续限制高度并使用内部纵向滚动。

---

### Task 1: 响应式卡片和长文本保护

**Files:**
- Modify: `tests/console-group-automation-boundary.test.js`
- Modify: `public/console/styles.css`

**Interfaces:**
- Consumes: `.group-automation-section`、`.group-automation-card`、`.group-automation-mention-card`、`.group-automation-history-item` 现有 DOM 类名。
- Produces: 不裁切操作区的容器自适应布局，以及稳定的成员名和历史标题显示。

- [ ] **Step 1: 写入失败的 CSS 布局回归测试**

在 `tests/console-group-automation-boundary.test.js` 增加断言，要求：

```js
test("group automation cards respond to their actual container and protect long text", () => {
  assert.match(css, /\.group-automation-section\s*\{[^}]*container-type:\s*inline-size/s);
  assert.match(css, /@container\s*\(max-width:\s*760px\)[\s\S]*\.group-automation-card\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(140px,\s*auto\)/s);
  assert.match(css, /@container\s*\(max-width:\s*520px\)[\s\S]*\.group-automation-card\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.group-automation-mention-card strong\s*\{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s);
  assert.match(css, /\.group-automation-history-item > div:first-child strong\s*\{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s);
});
```

- [ ] **Step 2: 运行定向测试确认失败**

Run: `node --test tests/console-group-automation-boundary.test.js`

Expected: FAIL，原因是 `.group-automation-section` 尚未声明容器，且缺少容器查询和长文本规则。

- [ ] **Step 3: 实现最小 CSS 修复**

在 `public/console/styles.css`：

```css
.group-automation-section {
  container-type: inline-size;
}

@container (max-width: 760px) {
  .group-automation-card {
    grid-template-columns: minmax(0, 1fr) minmax(140px, auto);
  }

  .group-automation-card-actions {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }
}

@container (max-width: 520px) {
  .group-automation-card {
    grid-template-columns: minmax(0, 1fr);
  }

  .group-automation-card-state,
  .group-automation-card-actions {
    grid-column: auto;
  }
}
```

同时为角色姓名和历史标题补充 `min-width: 0`、`overflow: hidden`、`text-overflow: ellipsis`、`white-space: nowrap`；历史首行在窄容器下允许换行。

- [ ] **Step 4: 运行定向测试确认通过**

Run: `node --test tests/console-group-automation-boundary.test.js`

Expected: PASS。

- [ ] **Step 5: 浏览器响应式复现验证**

用真实的 `300px Bot 侧栏 + 30/70 群工作台 + 任务卡` 结构分别设置 1440px、1280px、900px、700px 视口，读取每张任务卡的 `clientWidth` 与 `scrollWidth`。

Expected: 每个视口均满足 `scrollWidth <= clientWidth`；六个操作按钮完整可见；长任务名和 @ 姓名单行省略；状态标签不被压缩。

- [ ] **Step 6: 全量验证并提交**

Run: `npm test`

Expected: 全部测试通过，无失败或跳过。

Run: `git diff --check && git status --short`

Expected: 无格式错误，只有本任务计划内文件变化。

Commit:

```bash
git add public/console/styles.css tests/console-group-automation-boundary.test.js docs/superpowers/plans/2026-08-04-group-automation-responsive-layout.md
git commit -m "fix: make group automation cards responsive"
```
