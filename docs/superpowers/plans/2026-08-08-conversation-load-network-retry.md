# 会话详情网络失败重试实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 会话详情读取遇到一次浏览器网络失败时静默重试，避免可恢复的 `Failed to fetch` 直接占据聊天区域。

**Architecture:** 新增一个独立的浏览器重试助手，以现有控制台 IIFE 全局模块模式暴露纯函数，并在 Node 测试中直接执行。现有 `request` 负责标记原始 fetch 网络错误，只有 `openFlowSession` 通过重试助手调用它；其他请求路径不变。

**Tech Stack:** 浏览器 Fetch API、原生 JavaScript IIFE、Node.js test runner、`node:vm`。

## Global Constraints

- 仅会话详情 GET 重试一次。
- 只重试收到 HTTP 响应前的网络异常，不重试任何 HTTP/业务错误。
- 写操作与上传操作不得使用重试助手。
- 第二次失败保持现有错误界面。
- 直接使用当前 `main`，不创建分支。

---

### Task 1: 可测试的网络重试助手

**Files:**
- Create: `public/console/network-retry.js`
- Create: `tests/console-network-retry.test.js`

**Interfaces:**
- Produces: `global.DClawNetworkRetry.run(operation, { retries = 1 }) -> Promise<unknown>`。
- Contract: 仅当捕获的错误具有 `isNetworkError === true` 时消耗一次重试机会。

- [ ] **Step 1: 写失败测试**

使用 `node:vm` 加载浏览器脚本，覆盖三个行为：首次网络失败后成功、连续网络失败后抛出、非网络错误不重试。

```js
test("network retry retries one marked network failure", async () => {
  let attempts = 0;
  const result = await retry.run(async () => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new TypeError("Failed to fetch"), { isNetworkError: true });
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(attempts, 2);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `node --test tests/console-network-retry.test.js`

Expected: FAIL，因为 `public/console/network-retry.js` 尚不存在。

- [ ] **Step 3: 实现最小助手**

```js
(function attachNetworkRetry(global) {
  async function run(operation, { retries = 1 } = {}) {
    let remaining = Math.max(0, Number(retries) || 0);
    for (;;) {
      try {
        return await operation();
      } catch (error) {
        if (error?.isNetworkError !== true || remaining <= 0) throw error;
        remaining -= 1;
      }
    }
  }
  global.DClawNetworkRetry = Object.freeze({ run });
})(typeof window !== "undefined" ? window : globalThis);
```

- [ ] **Step 4: 运行助手测试**

Run: `node --test tests/console-network-retry.test.js`

Expected: 全部通过。

---

### Task 2: 接入会话详情加载

**Files:**
- Modify: `public/console/index.html:1070-1080`
- Modify: `public/console/app.js:413-435,4966-4990`
- Test: `tests/console-network-retry.test.js`

**Interfaces:**
- Consumes: `window.DClawNetworkRetry.run(operation, { retries: 1 })`。
- Keeps: 现有 `request(path, options)` 对 HTTP、JSON 与鉴权错误的处理语义。

- [ ] **Step 1: 写失败边界测试**

断言重试脚本在 `app.js` 前加载；`request` 只给原始 fetch rejection 标记 `isNetworkError`；`openFlowSession` 使用 `DClawNetworkRetry.run`；`sendManualReply`、`toggleSelectedConversationHandoff` 和重置函数不使用它。

- [ ] **Step 2: 运行并确认失败**

Run: `node --test tests/console-network-retry.test.js`

Expected: 边界断言失败，因为脚本尚未加载且会话详情尚未接入。

- [ ] **Step 3: 标记 fetch 网络异常**

仅包裹现有 `request` 内部的 fetch 调用：

```js
let response;
try {
  response = await fetch(path, { ...fetchOptions, headers: requestHeaders });
} catch (error) {
  error.isNetworkError = true;
  throw error;
}
```

- [ ] **Step 4: 仅接入会话详情**

在 `index.html` 中于 `app.js` 之前加载 `network-retry.js`，并把 `openFlowSession` 的详情请求替换为：

```js
const data = await window.DClawNetworkRetry.run(
  () => request(`/api/flow-sessions/${encodeURIComponent(conversationKey)}?${params.toString()}`),
  { retries: 1 }
);
```

- [ ] **Step 5: 运行聚焦测试**

Run: `node --test tests/console-network-retry.test.js tests/console-handoff-boundary.test.js tests/console-tag-alerts-boundary.test.js`

Expected: 全部通过。

- [ ] **Step 6: 全量验证并提交**

Run: `npm test`

Expected: 0 failed。

Run: `git diff --check`

Expected: 无输出并返回0。

```bash
git add public/console/network-retry.js public/console/index.html public/console/app.js tests/console-network-retry.test.js
git commit -m "fix: retry transient conversation loads"
git push origin main
```

