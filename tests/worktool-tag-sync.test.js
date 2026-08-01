import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFriendTagCommand,
  syncFriendTags
} from "../src/worktool.js";

test("friend tag command appends deduplicated tags without changing remarks", () => {
  const command = buildFriendTagCommand({
    targetName: "魔兮",
    tagNames: ["A类", "VIP", "A类", ""]
  });

  assert.deepEqual(command, {
    type: 213,
    friend: {
      name: "魔兮",
      tagList: ["A类", "VIP"]
    }
  });
  assert.equal("markName" in command.friend, false);
  assert.equal("markExtra" in command.friend, false);
});

test("friend tag command validates target tag count and tag content", () => {
  assert.throws(
    () => buildFriendTagCommand({ targetName: "", tagNames: ["VIP"] }),
    /targetName/
  );
  assert.throws(
    () => buildFriendTagCommand({ targetName: "魔兮", tagNames: [] }),
    /tagNames/
  );
  assert.throws(
    () => buildFriendTagCommand({
      targetName: "魔兮",
      tagNames: ["1", "2", "3", "4", "5", "6"]
    }),
    /five/
  );
});

test("syncFriendTags sends one verified type 213 WorkTool command", async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.WORKTOOL_BASE_URL;
  const calls = [];
  process.env.WORKTOOL_BASE_URL = "https://worktool.test";
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ code: 200, data: "wt-tag-1" }), {
      status: 200
    });
  };

  try {
    const result = await syncFriendTags({
      robotId: "bot_sync",
      targetName: "魔兮",
      tagNames: ["A类", "VIP"]
    });
    assert.equal(result.data, "wt-tag-1");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.WORKTOOL_BASE_URL;
    else process.env.WORKTOOL_BASE_URL = originalBaseUrl;
  }

  assert.equal(
    calls[0].url,
    "https://worktool.test/wework/sendRawMessage?robotId=bot_sync"
  );
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    socketType: 2,
    list: [{
      type: 213,
      friend: {
        name: "魔兮",
        tagList: ["A类", "VIP"]
      }
    }]
  });
});
