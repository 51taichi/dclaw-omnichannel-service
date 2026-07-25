import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

function asyncFunctionBody(name, nextName) {
  const start = source.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} is defined`);
  const end = nextName
    ? source.indexOf(`async function ${nextName}`, start)
    : source.length;
  assert.ok(end > start, `${name} has a boundary`);
  return source.slice(start, end);
}

test("captures legacy eligibility before persisting the first inbound message", () => {
  const body = asyncFunctionBody("processIncomingMessage", "processCoalescedIncomingBatch");
  const capture = body.indexOf("isLegacyCustomerCandidate({");
  const persist = body.indexOf("persistInboundConversation({");
  assert.ok(capture >= 0 && capture < persist);
  assert.match(body, /const hadConversation = Boolean\(getConversation\(conversationKey\)\)/);
  assert.match(body, /const hadFlowSession = Boolean\(getFlowSession\(conversationKey\)\)/);
  assert.match(body, /hadConversation,\n\s+hadFlowSession/);
  assert.match(body, /skipFirstSeenDateTag: legacyCandidate/);
});

test("legacy preparation completes before the inbound batch is queued", () => {
  const body = asyncFunctionBody("processIncomingMessage", "processCoalescedIncomingBatch");
  const prepare = body.indexOf("await legacyCustomerHistory.prepareLegacyCustomer({");
  const push = body.indexOf("inboundCoalescer.push");
  assert.ok(prepare >= 0 && prepare < push);
  assert.match(body, /historySyncStatus === "loading"/);
});

test("coalesced legacy requests forward one bounded customer history analysis", () => {
  const body = asyncFunctionBody("processCoalescedIncomingBatch");
  assert.match(body, /const shouldAnalyzeLegacyHistory =/);
  assert.match(body, /customerOrigin === "legacy"/);
  assert.match(body, /historySyncStatus === "success"/);
  assert.match(body, /!flow\.session\.historyContextSentAt/);
  assert.match(body, /getHistoryAnalysisConfig\(botId\)/);
  assert.match(body, /buildStoredLegacyAnalysis\(\{/);
  assert.match(body, /const tagContext = isPrivateMessage\(message\)/);
  assert.match(body, /legacyHistoryAnalysis,/);
  assert.match(body, /tagContext,/);
  assert.match(body, /tagEvidenceCandidates,/);
  assert.match(body, /markLegacyHistoryContextSent\(\{/);
});

test("bot-wide API history cache refreshes in the background only", () => {
  assert.match(source, /createWorktoolHistoryCache\(\{/);
  assert.match(source, /listBotBindings\(\)[\s\S]*refreshBot\(\{ robotId: binding\.botId \}\)/);
  assert.match(source, /WORKTOOL_HISTORY_CACHE_INTERVAL_MINUTES/);
  const incoming = asyncFunctionBody("processIncomingMessage", "processCoalescedIncomingBatch");
  assert.doesNotMatch(incoming, /worktoolHistoryCache\.refreshBot/);
});

test("flow session list does not expose raw legacy history errors", () => {
  const routeStart = source.indexOf('"/api/flow-sessions"');
  const routeEnd = source.indexOf('"/api/flow-sessions/:conversationKey"', routeStart);
  const route = source.slice(routeStart, routeEnd);
  assert.match(route, /historySyncError: _historySyncError/);
  assert.match(route, /return publicSession/);
});

test("flow session detail does not expose raw legacy history errors", () => {
  const routeStart = source.indexOf('"/api/flow-sessions/:conversationKey"');
  const routeEnd = source.indexOf('"/api/flow-sessions/:conversationKey/tags/manual"', routeStart);
  const route = source.slice(routeStart, routeEnd);
  assert.match(route, /historySyncError: _historySyncError/);
  assert.match(route, /session: session \? publicSession : null/);
});
