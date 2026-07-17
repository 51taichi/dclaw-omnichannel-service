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
