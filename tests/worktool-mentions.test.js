import assert from "node:assert/strict";
import test from "node:test";

import { sendTextMessage } from "../src/worktool.js";

function successResponse() {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({ code: 0, messageId: "worktool-message-1" });
    }
  };
}

test("sends deduplicated native group mentions in a type-203 command", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (...args) => {
    calls.push(args);
    return successResponse();
  });

  await sendTextMessage({
    robotId: "bot-1",
    targets: ["服务群"],
    content: "今晚八点上课",
    atList: ["家长", "授课老师", "家长", "  "]
  });

  assert.deepEqual(JSON.parse(calls[0][1].body).list[0], {
    type: 203,
    titleList: ["服务群"],
    receivedContent: "今晚八点上课",
    atList: ["家长", "授课老师"]
  });
});

test("legacy text sends omit atList and preserve the existing payload", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (...args) => {
    calls.push(args);
    return successResponse();
  });

  await sendTextMessage({
    robotId: "bot-legacy",
    targets: ["客户A"],
    content: "您好"
  });

  assert.deepEqual(JSON.parse(calls[0][1].body), {
    socketType: 2,
    list: [{
      type: 203,
      titleList: ["客户A"],
      receivedContent: "您好"
    }]
  });
});

test("rejects @所有人 because v1 only supports named roles", async () => {
  await assert.rejects(() => sendTextMessage({
    robotId: "bot-1",
    targets: ["服务群"],
    content: "通知",
    atList: ["@所有人"]
  }), /at everyone is not supported/);
});
