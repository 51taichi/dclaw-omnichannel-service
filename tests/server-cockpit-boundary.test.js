import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("cockpit exposes Bot-authorized snapshot and report reads", () => {
  for (const route of [
    "/api/cockpit/:botId/overview",
    "/api/cockpit/:botId/reports",
    "/api/cockpit/:botId/reports/:reportId",
    "/api/cockpit/:botId/config",
    "/api/cockpit/:botId/rebuild"
  ]) {
    assert.equal(source.includes(route), true, route);
  }
});

test("cockpit supports queued manual report generation", () => {
  const start = source.indexOf('app.post(\\n  "/api/cockpit/:botId/reports"'.replace("\\n", "\n"));
  const end = source.indexOf("\n);", start) + 3;
  const route = source.slice(start, end);
  assert.match(route, /assertBotAccess/);
  assert.doesNotMatch(route, /assertAdminForBot/);
  assert.match(route, /stage:\s*"generate"/);
  assert.match(route, /status:\s*"queued"/);
});

test("cockpit overview is read-only and never aggregates or invokes AI", () => {
  const start = source.indexOf('"/api/cockpit/:botId/overview"');
  const end = source.indexOf("\n);", start) + 3;
  const route = source.slice(start, end);
  assert.match(route, /assertBotAccess/);
  assert.doesNotMatch(route, /aggregate|rebuild|invokeDclaw|createCockpitReport/);
});

test("cockpit overview uses canonical then legacy exact snapshots for an explicit anchor", () => {
  const start = source.indexOf('"/api/cockpit/:botId/overview"');
  const end = source.indexOf("\n);", start) + 3;
  const route = source.slice(start, end);
  assert.match(route, /hasExplicitAnchor/);
  assert.match(route, /cockpitPeriodCandidates/);
  assert.match(route, /periodCandidates\.map/);
  assert.match(route, /find\(Boolean\)/);
  assert.match(route, /selectedPeriod\.start/);
  assert.match(route, /report\.periodStart === candidate\.start/);
});

test("cockpit runtime configuration cannot change the system timezone", () => {
  const database = fs.readFileSync(new URL("../src/db.js", import.meta.url), "utf8");
  assert.match(database, /timezone:\s*COCKPIT_TIME_ZONE/);
  assert.doesNotMatch(database, /timezone:\s*Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/);
});

test("cockpit retries fallback AI reports without rebuilding statistics", () => {
  const start = source.indexOf("async function recoverCockpitReportAnalysis");
  const end = source.indexOf("\n}\n", start) + 3;
  const recovery = source.slice(start, end);
  assert.ok(start > 0);
  assert.match(recovery, /ready_with_ai_error|analysisStatus/);
  assert.match(recovery, /cockpitReportGenerator\.generate/);
  assert.doesNotMatch(recovery, /cockpitAggregator|aggregateBot|reconcileBot/);
  assert.match(source, /recover:\s*recoverCockpitReportAnalysis/);
});
