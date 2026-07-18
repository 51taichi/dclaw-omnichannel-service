import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("server exposes tag schema routes by selected bot", () => {
  assert.match(source, /"\/api\/tag-schemas\/:botId"/);
  assert.match(source, /upsertAgentTagSchema/);
  assert.match(source, /getAgentTagSchema/);
  assert.match(source, /agentId: binding\.agentId/);
});

test("flow session APIs include tags", () => {
  assert.match(source, /tags: listConversationTags/);
  assert.match(source, /botId, agentId: binding\.agentId, conversationKey/);
});

test("flow session APIs support manual tag overrides from the console", () => {
  assert.match(source, /"\/api\/flow-sessions\/:conversationKey\/tags\/manual"/);
  assert.match(source, /function applyManualConversationTagChange\(\{/);
  assert.match(source, /source: "manual_tag"/);
  assert.match(source, /ignoreOneWay: true/);
  assert.match(source, /cancelTagTasksForAcceptedChanges\(\{/);
  assert.match(source, /scheduleTagActivationsForAcceptedChanges\(\{/);
  assert.match(source, /res\.json\(\{ ok: true, tags: result\.tags/);
});
