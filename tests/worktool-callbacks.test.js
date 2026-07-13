import assert from "node:assert/strict";
import test from "node:test";
import {
  unbindCommandCallback,
  unbindMessageCallback
} from "../src/worktool.js";

test("unbindMessageCallback disables WorkTool message callbacks", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  process.env.WORKTOOL_BASE_URL = "https://worktool.test";
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    await unbindMessageCallback({ robotId: "bot_delete" });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://worktool.test/robot/robotInfo/update?robotId=bot_delete");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    openCallback: 0,
    replyAll: 0,
    callbackUrl: ""
  });
});

test("unbindCommandCallback clears WorkTool command callback binding", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  process.env.WORKTOOL_BASE_URL = "https://worktool.test";
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    await unbindCommandCallback({ robotId: "bot_delete" });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://worktool.test/robot/robotInfo/callBack/bind?robotId=bot_delete");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    type: 0,
    callBackUrl: ""
  });
});
