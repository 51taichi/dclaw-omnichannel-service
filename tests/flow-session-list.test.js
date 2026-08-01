import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

globalThis.window = {};

const utilityUrl = new URL("../public/console/flow-session-list.js", import.meta.url);
if (fs.existsSync(utilityUrl)) {
  await import(utilityUrl);
}

test.after(() => {
  delete globalThis.window;
});

test("prepends a detailed session that is absent from the loaded page", () => {
  const loaded = [{ conversationKey: "bot:private:old", receivedName: "旧客户" }];
  const incoming = {
    conversationKey: "bot:private:new",
    receivedName: "新客户",
    tags: []
  };

  assert.deepEqual(window.upsertFlowSession(loaded, incoming), [incoming, ...loaded]);
  assert.deepEqual(loaded, [
    { conversationKey: "bot:private:old", receivedName: "旧客户" }
  ]);
});

test("merges an existing session in place without duplication", () => {
  const loaded = [
    { conversationKey: "bot:private:first", receivedName: "旧名称", marker: 1 },
    { conversationKey: "bot:private:second", marker: 2 }
  ];

  assert.deepEqual(window.upsertFlowSession(loaded, {
    conversationKey: "bot:private:first",
    receivedName: "新名称",
    tags: [{ tagId: "urgent" }]
  }), [
    {
      conversationKey: "bot:private:first",
      receivedName: "新名称",
      marker: 1,
      tags: [{ tagId: "urgent" }]
    },
    loaded[1]
  ]);
  assert.equal(loaded.length, 2);
});
