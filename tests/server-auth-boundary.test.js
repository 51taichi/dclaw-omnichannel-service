import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

function routeBody(method, route) {
  const start = serverSource.indexOf(`app.${method}(\n  "${route}"`);
  assert.notEqual(start, -1, `missing ${method.toUpperCase()} ${route}`);
  const end = serverSource.indexOf("\n);", start);
  return serverSource.slice(start, end + 3);
}

test("server exposes public bot list and unified unlock routes", () => {
  assert.equal(serverSource.includes('"/api/public/bots"'), true);
  assert.equal(serverSource.includes('"/api/agents"'), true);
  assert.equal(serverSource.includes('"/api/bots/:botId/unlock"'), true);
  assert.equal(serverSource.includes('"/api/bots/:botId/access-key"'), true);
  assert.equal(serverSource.includes('"/api/bots/:botId"'), true);
  assert.equal(serverSource.includes("deleteBotData"), true);
  assert.equal(serverSource.includes("getBotUploadDir(req.params.botId)"), true);
  assert.equal(serverSource.includes('"/api/bots/:botId/channel/health-check"'), true);
  assert.equal(serverSource.includes("unbindBotCallbacks(req.params.botId)"), false);
});

test("server supports bot scoped session authorization", () => {
  assert.equal(serverSource.includes("x-bot-session-token"), true);
  assert.equal(serverSource.includes("assertBotAccess"), true);
  assert.equal(serverSource.includes("assertAdminForBot"), true);
});

test("bot save validates a reusable agent binding", () => {
  assert.equal(serverSource.includes("getAgent(agentId)"), true);
  assert.equal(serverSource.includes("agent not found"), true);
  assert.equal(serverSource.includes("upsertAgent({"), true);
  assert.equal(serverSource.includes("agentId is required"), true);
});

test("server exposes guarded agent deletion", () => {
  assert.equal(serverSource.includes('"/api/agents/:agentId"'), true);
  assert.equal(serverSource.includes("deleteAgent(req.params.agentId)"), true);
  assert.equal(serverSource.includes("agent is bound"), true);
});

test("business routes are not protected only by global admin key", () => {
  const businessRouteChecks = [
    { route: '"/api/flow-machines/:botId"', guard: "assertBotAccess(req, req.params.botId)" },
    { route: '"/api/flow-sessions"', guard: "assertBotAccess(req, String(req.query.botId || \"\").trim())" },
    { route: '"/api/proactive/tasks"', guard: "assertBotAccess(req, botId)" },
    { route: '"/api/proactive/targets"', guard: "assertBotAccess(req, botId)" },
    { route: '"/api/logs/:name"', guard: "assertBotAccess(req, String(req.query.botId || \"\").trim())" }
  ];

  for (const check of businessRouteChecks) {
    assert.equal(serverSource.includes(check.route), true, `missing route ${check.route}`);
    assert.equal(serverSource.includes(check.guard), true, `missing guard ${check.guard}`);
  }
});

test("workspace business config and Bot password routes accept Bot sessions", () => {
  for (const [method, route] of [
    ["put", "/api/bots/:botId/access-key"],
    ["get", "/api/bots/:botId/settings/reply-wait"],
    ["put", "/api/bots/:botId/settings/reply-wait"],
    ["post", "/api/cockpit/:botId/reports"],
    ["put", "/api/cockpit/:botId/config"]
  ]) {
    const body = routeBody(method, route);
    assert.match(body, /assertBotAccess\(req, req\.params\.botId\)/, route);
    assert.doesNotMatch(body, /assertAdminForBot/, route);
  }

  assert.doesNotMatch(serverSource, /settings\/history-analysis/);

  assert.match(routeBody("put", "/api/bots/:botId"), /assertAdminForBot/);
  assert.match(routeBody("delete", "/api/bots/:botId"), /assertAdminForBot/);
});
