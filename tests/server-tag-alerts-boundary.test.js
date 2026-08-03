import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

function routeBody(route, nextRoute) {
  const start = source.indexOf(route);
  assert.notEqual(start, -1, `${route} exists`);
  const end = source.indexOf(nextRoute, start + route.length);
  assert.ok(end > start, `${route} has a boundary`);
  return source.slice(start, end);
}

test("tag alert stream is authenticated and starts from persisted unread state", () => {
  const body = routeBody('"/api/tag-alerts/stream"', '"/api/tag-alerts"');
  assert.match(body, /const botId = String\(req\.query\.botId \|\| ""\)\.trim\(\)/);
  assert.match(body, /assertBotAccess\(req, botId\)/);
  assert.match(body, /listUnreadTagAlerts\(\{ botId \}\)/);
  assert.match(body, /tagAlertStreamHub\.subscribe\(\{[\s\S]*botId,[\s\S]*req,[\s\S]*res,[\s\S]*snapshot/);
  assert.doesNotMatch(body, /token/i);
});

test("unread tag alert list is scoped to the selected Bot", () => {
  const body = routeBody('"/api/tag-alerts"', '"/api/tag-alerts/:alertId/read"');
  assert.match(body, /assertBotAccess\(req, botId\)/);
  assert.match(body, /status[\s\S]*unread/);
  assert.match(body, /listUnreadTagAlerts\(\{ botId \}\)/);
});

test("marking a tag alert read commits with Bot scope before broadcasting", () => {
  const body = routeBody('"/api/tag-alerts/:alertId/read"', '"/api/flow-machines"');
  const commitIndex = body.indexOf("markTagAlertRead({");
  const publishIndex = body.indexOf("tagAlertStreamHub.publishRead({");
  assert.match(body, /assertBotAccess\(req, botId\)/);
  assert.match(body, /markTagAlertRead\(\{ botId, alertId \}\)/);
  assert.ok(commitIndex >= 0 && publishIndex > commitIndex);
});

test("created alerts publish only after the tag transaction returns", () => {
  const helperStart = source.indexOf("function publishCommittedTagAlerts");
  assert.ok(helperStart >= 0);
  const helperEnd = source.indexOf("\n}", helperStart);
  const helper = source.slice(helperStart, helperEnd);
  assert.match(helper, /tagResult\?\.alerts/);
  assert.match(helper, /tagAlertStreamHub\.publishCreated\(\{/);

  const normalStart = source.indexOf("async function processCoalescedIncomingBatch");
  const normalEnd = source.indexOf("function applyManualConversationTagChange", normalStart);
  const normal = source.slice(normalStart, normalEnd);
  assert.ok(normal.indexOf("applyAgentTagDecision({") < normal.indexOf("publishCommittedTagAlerts({"));

  const handoffStart = source.indexOf("if (isHumanHandoff)");
  const handoffEnd = source.indexOf('status: "human_handoff"', handoffStart);
  const handoff = source.slice(handoffStart, handoffEnd);
  assert.ok(handoff.indexOf("applyAgentTagDecision({") < handoff.indexOf("publishCommittedTagAlerts({"));
});

test("conversation detail can return an anchored evidence window without changing normal history", () => {
  const start = source.indexOf('"/api/flow-sessions/:conversationKey"');
  const end = source.indexOf('"/api/flow-sessions/:conversationKey/tags/manual"', start);
  const body = source.slice(start, end);

  assert.match(body, /const anchorMessageId = Number\(req\.query\.anchorMessageId \|\| 0\)/);
  assert.match(body, /listConversationMessagesAround\(\{[\s\S]*botId,[\s\S]*conversationKey,[\s\S]*anchorMessageId/);
  assert.match(body, /evidenceFound/);
  assert.match(body, /listConversationMessages\(\{[\s\S]*limit:\s*Number\(req\.query\.limit \|\| 300\)/);
});
