import assert from "node:assert/strict";
import test from "node:test";
import {
  historySourceKey,
  listApiCommandPage,
  listCustomerHistory,
  normalizeApiCommandRow,
  normalizeCustomerHistoryRow,
  normalizeWorktoolTimestamp
} from "../src/worktool-history.js";

function worktoolResponse(data, code = 200, message = "操作成功") {
  return new Response(JSON.stringify({ code, message, data }), { status: 200 });
}

test("normalizes readable customer history and stable source keys", () => {
  const messages = normalizeCustomerHistoryRow({
    robotId: "bot_a",
    titleList: "魔兮-18570860666",
    sender: 0,
    type: 1,
    createTime: "2026-07-18 01:02:56",
    itemMsgList: JSON.stringify([
      { feature: 0, text: "1:02" },
      { feature: 2, text: "我是魔兮" }
    ])
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, "我是魔兮");
  assert.equal(messages[0].title, "魔兮-18570860666");
  assert.equal(messages[0].direction, "inbound");
  assert.equal(messages[0].createdAt, "2026-07-17T17:02:56.000Z");
  assert.equal(historySourceKey(messages[0]), messages[0].sourceKey);
  assert.notEqual(
    historySourceKey(messages[0]),
    historySourceKey({ ...messages[0], title: "其他人" })
  );
});

test("normalizes timezone-free WorkTool timestamps as Beijing time", () => {
  assert.equal(
    normalizeWorktoolTimestamp("2026-07-18 01:02:56"),
    "2026-07-17T17:02:56.000Z"
  );
  assert.equal(
    normalizeWorktoolTimestamp("2026-07-24T17:35:04"),
    "2026-07-24T09:35:04.000Z"
  );
  assert.equal(normalizeWorktoolTimestamp("invalid"), "");
});

test("paginates customer history and returns remark aliases", async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.WORKTOOL_BASE_URL;
  process.env.WORKTOOL_BASE_URL = "https://worktool.test";
  const requestedPages = [];
  globalThis.fetch = async (url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    requestedPages.push(page);
    return worktoolResponse({
      pageNum: page,
      pageSize: 1,
      totalPage: 2,
      total: 2,
      list: [{
        robotId: "bot_a",
        titleList: page === 1 ? "魔兮" : "魔兮-18570860666",
        sender: 0,
        type: 1,
        createTime: page === 1 ? "2026-07-10 11:00:00" : "2026-07-18 01:00:00",
        itemMsgList: JSON.stringify([{ feature: 2, text: page === 1 ? "在吗" : "你好" }])
      }]
    });
  };

  try {
    const result = await listCustomerHistory({
      robotId: "bot_a",
      title: "魔兮",
      pageSize: 1
    });
    assert.deepEqual(requestedPages, [1, 2]);
    assert.deepEqual(result.titles, ["魔兮", "魔兮-18570860666"]);
    assert.equal(result.messages.length, 2);
    assert.equal(result.rawCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.WORKTOOL_BASE_URL;
    else process.env.WORKTOOL_BASE_URL = originalBaseUrl;
  }
});

test("customer history ignores rows belonging to another bot", async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.WORKTOOL_BASE_URL;
  process.env.WORKTOOL_BASE_URL = "https://worktool.test";
  globalThis.fetch = async () => worktoolResponse({
    pageNum: 1,
    pageSize: 10,
    totalPage: 1,
    total: 2,
    list: [
      {
        robotId: "bot_a",
        titleList: "阿三",
        sender: 0,
        type: 1,
        createTime: "2026-07-18 01:00:00",
        itemMsgList: JSON.stringify([{ feature: 2, text: "正确记录" }])
      },
      {
        robotId: "bot_b",
        titleList: "同名客户",
        sender: 0,
        type: 1,
        createTime: "2026-07-18 01:01:00",
        itemMsgList: JSON.stringify([{ feature: 2, text: "其他 Bot 记录" }])
      }
    ]
  });

  try {
    const result = await listCustomerHistory({ robotId: "bot_a", title: "阿三" });
    assert.deepEqual(result.messages.map((message) => message.content), ["正确记录"]);
    assert.deepEqual(result.titles, ["阿三"]);
    assert.equal(result.rawCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.WORKTOOL_BASE_URL;
    else process.env.WORKTOOL_BASE_URL = originalBaseUrl;
  }
});

test("normalizes one API command per target", () => {
  const commands = normalizeApiCommandRow({
    robotId: "bot_a",
    messageId: "2080",
    createTime: "2026-07-24T17:35:04",
    body: JSON.stringify({
      list: [{
        type: 203,
        titleList: ["阿三", "魔兮"],
        receivedContent: "在吗"
      }]
    })
  });

  assert.deepEqual(commands.map((item) => item.targetName), ["阿三", "魔兮"]);
  assert.equal(commands[0].content, "在吗");
  assert.equal(commands[0].createdAt, "2026-07-24T09:35:04.000Z");
  assert.equal(commands[1].commandIndex, 0);
});

test("rejects WorkTool business errors", async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.WORKTOOL_BASE_URL;
  process.env.WORKTOOL_BASE_URL = "https://worktool.test";
  globalThis.fetch = async () => worktoolResponse({}, 500, "失败");

  try {
    await assert.rejects(
      listCustomerHistory({ robotId: "bot_a", title: "阿三" }),
      /WorkTool business error: 500 失败/
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.WORKTOOL_BASE_URL;
    else process.env.WORKTOOL_BASE_URL = originalBaseUrl;
  }
});

test("customer history timeout covers the complete pagination run", async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.WORKTOOL_BASE_URL;
  process.env.WORKTOOL_BASE_URL = "https://worktool.test";
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      await new Promise((resolve) => setTimeout(resolve, 12));
    }
    return worktoolResponse({
      pageNum: calls,
      pageSize: 1,
      totalPage: 2,
      total: 2,
      list: []
    });
  };

  try {
    await assert.rejects(
      listCustomerHistory({ robotId: "bot_a", title: "阿三", timeoutMs: 5 }),
      /customer history timed out/
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.WORKTOOL_BASE_URL;
    else process.env.WORKTOOL_BASE_URL = originalBaseUrl;
  }
});

test("lists a normalized API command page", async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.WORKTOOL_BASE_URL;
  process.env.WORKTOOL_BASE_URL = "https://worktool.test";
  globalThis.fetch = async () => worktoolResponse({
    pageNum: 1,
    pageSize: 10,
    totalPage: 1,
    total: 1,
    list: [{
      robotId: "bot_a",
      messageId: "m1",
      createTime: "2026-07-24T17:35:04",
      body: JSON.stringify({
        list: [{ type: 203, titleList: ["阿三"], receivedContent: "在吗" }]
      })
    }]
  });

  try {
    const page = await listApiCommandPage({ robotId: "bot_a" });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].messageId, "m1");
    assert.deepEqual(page.pagination, {
      pageNum: 1,
      pageSize: 10,
      totalPage: 1,
      total: 1
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.WORKTOOL_BASE_URL;
    else process.env.WORKTOOL_BASE_URL = originalBaseUrl;
  }
});
