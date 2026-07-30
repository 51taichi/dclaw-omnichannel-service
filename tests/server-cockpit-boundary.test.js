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

test("cockpit overview is read-only and never aggregates or invokes AI", () => {
  const start = source.indexOf('"/api/cockpit/:botId/overview"');
  const end = source.indexOf("\n);", start) + 3;
  const route = source.slice(start, end);
  assert.match(route, /assertBotAccess/);
  assert.doesNotMatch(route, /aggregate|rebuild|invokeDclaw|createCockpitReport/);
});

