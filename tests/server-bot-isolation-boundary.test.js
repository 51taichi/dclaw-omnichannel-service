import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("flow session detail reads session data through the selected Bot boundary", () => {
  assert.match(serverSource, /getFlowSessionForBot\(\{ botId, conversationKey \}\)/);
  assert.match(serverSource, /listConversationMessages\(\{\s*botId,\s*conversationKey/);
  assert.match(serverSource, /listFlowStateEvents\(\{\s*botId,\s*conversationKey/);
});

test("Whapi status delivery correlation is scoped to the webhook account Bot", () => {
  assert.match(serverSource, /updateOutgoingMessageChannelStatus\(\{[\s\S]{0,180}?channelAccountId: event\.channelAccountId/);
  assert.match(serverSource, /updateGroupAutomationOccurrenceFromChannelStatus\(\{[\s\S]{0,180}?botId: envelope\.botId/);
  assert.doesNotMatch(serverSource, /app\.post\("\/worktool\/command-callback"/);
});

test("console upload requires and preserves selected Bot ownership", () => {
  const uploadRoute = serverSource.slice(
    serverSource.indexOf('app.post(\n  "/api/uploads"'),
    serverSource.indexOf('app.post(\n  "/api/groups/create"')
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
  assert.match(adminBody, /verifyAdminPassword\(getRequestAdminKey\(req\)\)/);
  assert.doesNotMatch(adminBody, /return true/);
});
