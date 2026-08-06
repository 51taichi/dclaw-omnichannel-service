import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const productionSources = [
  "../src/db.js",
  "../src/server.js",
  "../src/group-automation-worker.js",
  "../src/group-automation-agent.js",
  "../src/dclaw.js"
].map((file) => fs.readFileSync(new URL(file, import.meta.url), "utf8")).join("\n");

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

test("server executes group tasks from the existing conversation without full-history analysis", () => {
  const workerStart = source.indexOf("createGroupAutomationWorker({");
  const workerSource = source.slice(workerStart, workerStart + 5000);
  assert.match(workerSource, /executeAgentTask:/);
  assert.match(workerSource, /executeGroupAutomationAgentTask\(\{/);
  assert.match(workerSource, /claimDueGroupAutomationOccurrences/);
  assert.match(workerSource, /validateGroupAutomationEvidenceMessageIds/);
  assert.match(source, /groupAutomationWorker\.recoverExpiredLeases\(/);
  assert.doesNotMatch(workerSource, /historySyncWorker|listDclawHistory|analyzeChunk|mergeAnalyses/);
});

test("Whapi status callbacks reconcile group automation delivery and publish the result", () => {
  assert.equal((source.match(/updateGroupAutomationOccurrenceFromChannelStatus\(\{/g) || []).length, 1);
  assert.equal((source.match(/publishGroupAutomationCallbackResult\(/g) || []).length >= 1, true);
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

test("server has no full-history synchronization runtime or obsolete modules", () => {
  assert.match(source, /finalizeObsoleteGroupHistoryRemoval\(\)/);
  assert.doesNotMatch(source, /createGroupHistorySyncWorker|groupHistorySyncWorker/);
  assert.doesNotMatch(source, /enqueueAllManagedGroupsForHistorySync|probeDclawGroupHistoryCapability/);
  assert.doesNotMatch(source, /analyzeGroupHistoryChunk|mergeGroupHistoryAnalyses|listDclawGroupHistory/);
  assert.doesNotMatch(source, /insertConversationMessageAndWakeGroupHistory/);
  for (const file of [
    "../src/dclaw-group-history.js",
    "../src/group-history-sync-worker.js",
    "../src/group-history-transcript.js"
  ]) {
    assert.equal(fs.existsSync(new URL(file, import.meta.url)), false, file);
  }
});

test("production no longer contains the legacy group business ledger runtime or schema", () => {
  assert.doesNotMatch(productionSources, /group-ledger/);
  assert.doesNotMatch(productionSources, /enqueueLive|enqueueReindex|runLedgerTick/);
  assert.doesNotMatch(
    productionSources,
    /managed_group_(?:facts|fact_aggregates|fact_evidence|fact_revisions|ledger_states|ledger_jobs|automation_cycle_states)/
  );
  assert.doesNotMatch(productionSources, /variable_values_json|fact_ids_json/);
  assert.match(source, /finalizeObsoleteGroupHistoryRemoval\(\)/);
});
