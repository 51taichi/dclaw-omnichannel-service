import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("flow session detail reads session data through the selected Bot boundary", () => {
  assert.match(serverSource, /getFlowSessionForBot\(\{ botId, conversationKey \}\)/);
  assert.match(serverSource, /listConversationMessages\(\{\s*botId,\s*conversationKey/);
  assert.match(serverSource, /listFlowStateEvents\(\{\s*botId,\s*conversationKey/);
});

test("command callbacks scope delivery correlation to their callback Bot", () => {
  const scopedCallbackCalls = serverSource.match(/updateOutgoingMessageFromCommandCallback\(\{[\s\S]{0,140}?botId/g) || [];
  assert.equal(scopedCallbackCalls.length, 2);
  const scopedTargetCalls = serverSource.match(/updateProactiveTargetFromCommandCallback\(\{[\s\S]{0,140}?botId/g) || [];
  assert.equal(scopedTargetCalls.length, 2);
  const legacyRoute = serverSource.slice(
    serverSource.indexOf('app.post("/worktool/command-callback"'),
    serverSource.indexOf('app.get(\n  "/api/public/bots"')
  );
  assert.match(legacyRoute, /assertCallbackSecret\(req\)/);
});

test("console upload requires and preserves selected Bot ownership", () => {
  const uploadRoute = serverSource.slice(
    serverSource.indexOf('app.post(\n  "/api/uploads"'),
    serverSource.indexOf('app.post("/worktool/:botId/message-callback"')
  );
  assert.match(uploadRoute, /const botId = String\(req\.query\.botId \|\| ""\)\.trim\(\)/);
  assert.match(uploadRoute, /assertBotAccess\(req, botId\)/);
  assert.match(uploadRoute, /req\.uploadBotId = botId/);
  assert.match(uploadRoute, /buildPublicFileUrl\(req\.uploadBotId, req\.file\.filename\)/);
});

test("missing service secrets fail closed instead of granting cross-Bot access", () => {
  const callbackStart = serverSource.indexOf("function assertCallbackSecret");
  const callbackEnd = serverSource.indexOf("function assertAdmin", callbackStart);
  const callbackBody = serverSource.slice(callbackStart, callbackEnd);
  assert.match(callbackBody, /callback secret is not configured/);
  assert.doesNotMatch(callbackBody, /if \(!expected\) \{\s*return;\s*\}/);

  const adminStart = serverSource.indexOf("function isAdminKey");
  const adminEnd = serverSource.indexOf("function getRequestBotSession", adminStart);
  const adminBody = serverSource.slice(adminStart, adminEnd);
  assert.match(adminBody, /if \(!expected\) return false;/);
});
