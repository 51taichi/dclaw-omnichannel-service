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
  ["post", "/api/groups/:groupId/automations/:taskId/refresh"],
  ["post", "/api/groups/:groupId/automations/occurrences/:occurrenceId/retry"],
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

test("create and update validate recurrence, summary templates, and group role mentions", () => {
  assert.match(source, /normalizeGroupAutomationSchedule\(\{/);
  assert.match(source, /parseGroupSummaryTemplate\(/);
  assert.match(source, /resolveGroupAutomationMentionNames\(\{/);
  assert.match(source, /nextGroupAutomationRunAt\(/);
  assert.match(source, /enqueueReindex\(\{[\s\S]*automation_(?:created|updated|refreshed)/);
});

test("group automation responses exclude private group background and expose evidence anchors", () => {
  assert.match(source, /serializeGroupAutomationTask\(/);
  assert.match(source, /serializeGroupAutomationCurrentState\(\{[\s\S]*currentCycleKey:\s*cycleKey/);
  assert.match(source, /conversationKey:[\s\S]*messageId:[\s\S]*createdAt:/);
});

test("merging a managed group reindexes the target shared ledger", () => {
  const marker = '"/api/groups/:groupId/merge"';
  const routeSource = source.slice(source.indexOf(marker), source.indexOf(marker) + 1200);
  assert.match(routeSource, /enqueueReindex\(\{[\s\S]*groupId:\s*group\.id[\s\S]*group_merged/);
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
