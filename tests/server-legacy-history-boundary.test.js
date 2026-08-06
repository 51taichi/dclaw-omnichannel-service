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

test("coalesced legacy requests reply first and schedule bounded history analysis after send", () => {
  const body = asyncFunctionBody("processCoalescedIncomingBatch");
  assert.match(body, /const shouldScheduleLegacyHistoryAnalysis =/);
  assert.match(
    body,
    /shouldAnalyzeLegacyHistoryForSession\(\s*flow\?\.session\s*\)/
  );
  assert.match(body, /getHistoryAnalysisConfig\(botId\)/);
  assert.match(body, /buildStoredLegacyAnalysis\(\{/);
  assert.match(body, /const managedGroup = isPrivateMessage\(message\)/);
  assert.match(body, /const tagContext = buildTagContext\(\{/);
  assert.match(body, /legacyHistoryAnalysis:\s*null,/);
  assert.match(body, /tagContext,/);
  const sendIndex = body.indexOf("sendTextReplyParts");
  const scheduleIndex = body.indexOf("scheduleLegacyHistoryAnalysis({");
  assert.ok(sendIndex >= 0 && scheduleIndex > sendIndex);
  assert.doesNotMatch(
    body.slice(0, scheduleIndex),
    /markLegacyHistoryContextSent\(\{/
  );
});

test("legacy history persists a valid tag audit before applying decisions", () => {
  const start = source.indexOf("async function runLegacyHistoryAnalysis");
  const end = source.indexOf("function scheduleLegacyHistoryAnalysis", start);
  const body = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  const auditIndex = body.indexOf("persistAgentTagAudit({");
  const decisionIndex = body.indexOf("applyAgentTagDecision({");
  assert.ok(auditIndex >= 0);
  assert.ok(decisionIndex > auditIndex);
});

test("legacy history analysis uses background Agent queue priority", () => {
  const start = source.indexOf("async function runLegacyHistoryAnalysis");
  const end = source.indexOf("function scheduleLegacyHistoryAnalysis", start);
  const body = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(
    body,
    /invokeStrictAgentReply\(\{[\s\S]*queuePriority:\s*"background",\s*queueKey:\s*conversationKey/
  );
});

test("legacy asset rollout reopens old analysis exactly once", () => {
  assert.match(
    source,
    /legacy_history_dynamic_assets_v1_rollout_at/
  );
  assert.match(
    source,
    /getSetting\(legacyHistoryDynamicAssetsRolloutKey/
  );
  assert.match(
    source,
    /setSetting\(legacyHistoryDynamicAssetsRolloutKey,\s*rolloutAt\)/
  );
  assert.match(
    source,
    /function shouldAnalyzeLegacyHistoryForSession\(session\)[\s\S]*customerOrigin !== "legacy"[\s\S]*historySyncStatus !== "success"[\s\S]*!historyContextSentAt[\s\S]*historyContextTime < rolloutTime/
  );
});

test("production no longer refreshes WorkTool history", () => {
  assert.doesNotMatch(source, /createWorktoolHistoryCache\(\{/);
  assert.doesNotMatch(source, /WORKTOOL_HISTORY_CACHE_INTERVAL_MINUTES/);
  assert.doesNotMatch(source, /worktoolHistoryCache\.refreshBot/);
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
