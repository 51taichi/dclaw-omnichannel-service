import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

const routes = [
  ["get", "/api/groups/:groupId/automations"],
  ["post", "/api/groups/:groupId/automations"],
  ["get", "/api/groups/:groupId/automations/events"],
  ["get", "/api/groups/:groupId/automations/:taskId"],
  ["patch", "/api/groups/:groupId/automations/:taskId"],
  ["post", "/api/groups/:groupId/automations/:taskId/duplicate"],
  ["delete", "/api/groups/:groupId/automations/:taskId"],
  ["get", "/api/groups/:groupId/automations/:taskId/occurrences"],
  ["post", "/api/groups/:groupId/automation-occurrences/:occurrenceId/confirm-delivery"],
  ["post", "/api/groups/:groupId/automation-occurrences/:occurrenceId/confirm-not-delivered-and-retry"],
  ["get", "/api/groups/:groupId/automations/evidence/:messageId"]
];

test("exposes the complete authorized group automation API", () => {
  for (const [method, path] of routes) {
    const marker = `app.${method}(\n  \"${path}\"`;
    assert.equal(source.includes(marker), true, `${method.toUpperCase()} ${path}`);
    const routeSource = source.slice(source.indexOf(marker), source.indexOf(marker) + 1400);
    assert.match(routeSource, /assertBotAccess\(req, botId\)/);
  }
});

test("create and update validate recurrence, summary templates, and group role mentions without ledger refresh", () => {
  assert.match(source, /normalizeGroupAutomationSchedule\(\{/);
  assert.match(source, /parseGroupSummaryTemplate\(/);
  assert.match(source, /resolveGroupAutomationMentionNames\(\{/);
  assert.match(source, /nextGroupAutomationRunAt\(/);
  assert.doesNotMatch(source, /groupAutomationWorker\.enqueueReindex\(/);
  assert.doesNotMatch(source, /groupAutomationWorker\.enqueueLive\(/);
  assert.match(source, /minimumLeadMs:\s*600_000/);
  assert.match(source, /skippedImminentTarget/);
});

test("group automation responses expose operational runs and evidence anchors without ledger state", () => {
  assert.match(source, /serializeGroupAutomationTask\(/);
  assert.match(source, /latestOccurrence:\s*serializeGroupAutomationOccurrence\(/);
  assert.match(source, /executionAvailable:/);
  assert.match(source, /technicalReason:/);
  assert.doesNotMatch(source, /getGroupAutomationCycleState\(/);
  assert.doesNotMatch(source, /serializeGroupAutomationCurrentState\(/);
  assert.doesNotMatch(source, /listGroupAutomationEvidenceMessages\(/);
  assert.match(source, /listConversationMessagesAround\(\{[\s\S]*anchorMessageId:\s*messageId/);
});

test("server uses only the phased DClaw history worker for group task execution", () => {
  const workerStart = source.indexOf("createGroupAutomationWorker({");
  const workerSource = source.slice(workerStart, workerStart + 5000);
  assert.match(workerSource, /historySyncWorker:\s*groupHistorySyncWorker/);
  assert.match(workerSource, /listDclawHistory:/);
  assert.match(workerSource, /analyzeChunk:/);
  assert.match(workerSource, /mergeAnalyses:/);
  assert.match(workerSource, /finalizeConditional:/);
  assert.match(workerSource, /finalizeSummary:/);
  assert.match(source, /groupAutomationWorker\.recoverExpiredLeases\(/);
  assert.doesNotMatch(workerSource, /enqueueGroupLedgerJob/);
  assert.doesNotMatch(workerSource, /listGroupLedgerProjection/);
  assert.doesNotMatch(source, /groupAutomationWorker\.runLedgerTick\(/);
});

test("both WorkTool command callbacks reconcile group automation delivery and publish the result", () => {
  assert.equal((source.match(/updateGroupAutomationOccurrenceFromCommandCallback\(\{/g) || []).length, 2);
  assert.equal((source.match(/publishGroupAutomationCallbackResult\(/g) || []).length >= 3, true);
});

test("manual delivery resolution verifies group ownership and records the authenticated operator", () => {
  for (const path of [
    "/api/groups/:groupId/automation-occurrences/:occurrenceId/confirm-delivery",
    "/api/groups/:groupId/automation-occurrences/:occurrenceId/confirm-not-delivered-and-retry"
  ]) {
    const marker = `app.post(\n  "${path}"`;
    const routeSource = source.slice(source.indexOf(marker), source.indexOf(marker) + 1800);
    assert.match(routeSource, /assertBotAccess\(req, botId\)/);
    assert.match(routeSource, /occurrence\.groupId !== groupId/);
    assert.match(routeSource, /operatorId/);
  }
});

test("group history sync is startup-backed and wakes only from persisted group conversation writes", () => {
  assert.match(source, /createGroupHistorySyncWorker\(\{/);
  assert.match(source, /enqueueAllManagedGroupsForHistorySync\(/);
  assert.match(source, /function insertConversationMessageAndWakeGroupHistory\(/);
  assert.match(source, /getGroupByConversationKey\(\{[\s\S]*groupHistorySyncWorker\.wake\(\{/);
  assert.doesNotMatch(source, /groupHistorySyncWorker[\s\S]{0,300}listWorkToolGroups/);
});
