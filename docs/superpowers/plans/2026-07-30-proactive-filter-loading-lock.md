# 主动推送交叉筛选 Loading 锁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 主动推送任一筛选请求执行期间锁定其余筛选交互，消除快速交叉筛选产生的并发状态覆盖。

**Architecture:** 在 `proactive-target-selection.js` 中提供可重置的异步交互锁，负责拒绝并发任务并在 `finally` 中释放。控制台通过统一包装函数将日期、标签、搜索、类型、同步、全选和分页操作接入该锁，同时用目标区域遮罩表达 loading 状态。

**Tech Stack:** 原生 JavaScript、HTML、CSS、Node.js `node:test`

## Global Constraints

- 仅修改控制台前端和前端测试，不修改服务端 API、请求参数、数据库或筛选规则。
- loading 期间锁定筛选控件、目标卡片和分页。
- 请求成功、失败或 Bot 上下文重置后都必须释放锁。
- 遮罩不得改变主动推送模块现有尺寸。

---

### Task 1: 可重置异步交互锁

**Files:**
- Modify: `public/console/proactive-target-selection.js`
- Test: `tests/proactive-target-selection.test.js`

**Interfaces:**
- Produces: `createInteractionLock(onChange): { run(task), reset(), isLocked() }`
- `run(task)` 在空闲时执行异步任务并返回 `{ accepted: true, value }`，锁定时返回 `{ accepted: false }`。
- `reset()` 立即释放当前代次；旧任务完成时不得影响重置后启动的新任务。

- [x] **Step 1: Write the failing tests**

```js
test("interaction lock rejects a second task while the first is pending", async () => {
  let release;
  const lock = createInteractionLock(() => {});
  const first = lock.run(() => new Promise((resolve) => { release = resolve; }));
  assert.deepEqual(await lock.run(async () => "second"), { accepted: false });
  release("first");
  assert.deepEqual(await first, { accepted: true, value: "first" });
});

test("interaction lock releases after errors and reset isolates stale completions", async () => {
  const states = [];
  const lock = createInteractionLock((locked) => states.push(locked));
  await assert.rejects(lock.run(async () => { throw new Error("failed"); }), /failed/);
  assert.equal(lock.isLocked(), false);
  lock.reset();
  assert.equal(lock.isLocked(), false);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/proactive-target-selection.test.js`

Expected: FAIL because `createInteractionLock` is not exported.

- [x] **Step 3: Write minimal implementation**

```js
function createInteractionLock(onChange = () => {}) {
  let locked = false;
  let generation = 0;
  return {
    isLocked: () => locked,
    reset() {
      generation += 1;
      locked = false;
      onChange(false);
    },
    async run(task) {
      if (locked) return { accepted: false };
      const runGeneration = generation;
      locked = true;
      onChange(true);
      try {
        return { accepted: true, value: await task() };
      } finally {
        if (runGeneration === generation) {
          locked = false;
          onChange(false);
        }
      }
    }
  };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/proactive-target-selection.test.js`

Expected: all proactive target selection tests PASS.

### Task 2: 筛选区域 Loading 与统一加锁

**Files:**
- Modify: `public/console/index.html`
- Modify: `public/console/app.js`
- Modify: `public/console/styles.css`
- Test: `tests/console-proactive-scheduling-boundary.test.js`

**Interfaces:**
- Consumes: `createInteractionLock(onChange)` from Task 1.
- Produces: `runProactiveFilterAction(action)` and `setProactiveFilterLoading(loading)`.

- [x] **Step 1: Write the failing UI boundary test**

```js
test("proactive filters expose one loading surface controlled by the interaction lock", () => {
  assert.match(proactivePanel, /id="proactiveFilterControls"/);
  assert.match(proactivePanel, /id="proactiveFilterLoading"/);
  assert.match(app, /createInteractionLock\(setProactiveFilterLoading\)/);
  assert.match(app, /runProactiveFilterAction/);
  assert.match(css, /\.proactive-filter-loading/);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/console-proactive-scheduling-boundary.test.js`

Expected: FAIL because the loading surface and lock integration do not exist.

- [x] **Step 3: Add the loading surface and UI state**

Add a wrapper around the target toolbar/list and a sibling loading overlay:

```html
<div class="proactive-filter-shell">
  <div id="proactiveFilterControls">...</div>
  <div id="proactiveFilterLoading" class="proactive-filter-loading" role="status" aria-live="polite" hidden>
    <span class="loading-spinner" aria-hidden="true"></span>
    <strong>正在筛选</strong>
  </div>
</div>
```

`setProactiveFilterLoading(loading)` must close the tag menu, set `aria-busy`, toggle the overlay, and disable external filter controls and pagination without changing their selected states.

- [x] **Step 4: Route every asynchronous filter action through the lock**

Use:

```js
function runProactiveFilterAction(action) {
  return proactiveFilterLock.run(action);
}
```

Apply it to target type, debounced search, date, tag, sync, cross-page selection, and pagination callbacks. Bot-scoped reset must call `proactiveFilterLock.reset()`.

- [x] **Step 5: Run focused tests**

Run:

```bash
node --test tests/proactive-target-selection.test.js
node --test tests/console-proactive-scheduling-boundary.test.js
```

Expected: both files PASS.

- [x] **Step 6: Run full verification**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 7: Commit and push UI changes**

```bash
git add public/console/proactive-target-selection.js public/console/index.html public/console/app.js public/console/styles.css tests/proactive-target-selection.test.js tests/console-proactive-scheduling-boundary.test.js docs/superpowers/plans/2026-07-30-proactive-filter-loading-lock.md
git commit -m "Lock proactive filters while loading"
git push origin HEAD:main
```
