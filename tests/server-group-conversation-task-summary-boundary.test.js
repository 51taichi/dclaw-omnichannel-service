import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("flow session detail exposes only stable managed group identity", () => {
  const marker = '"/api/flow-sessions/:conversationKey"';
  const start = source.indexOf(marker);
  const route = source.slice(start, start + 3600);

  assert.notEqual(start, -1);
  assert.match(route, /getGroupByConversationKey\(\{\s*botId,\s*conversationKey\s*\}\)/s);
  assert.match(
    route,
    /managedGroup:\s*managedGroup\s*\?\s*\{\s*id:\s*managedGroup\.id,\s*currentName:\s*managedGroup\.currentName\s*\}\s*:\s*null/s
  );
  assert.doesNotMatch(route, /managedGroup:\s*managedGroup\s*[,}]/);
});
