import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("server exposes public bot list and unified unlock routes", () => {
  assert.equal(serverSource.includes('"/api/public/bots"'), true);
  assert.equal(serverSource.includes('"/api/bots/:botId/unlock"'), true);
  assert.equal(serverSource.includes('"/api/bots/:botId/access-key"'), true);
  assert.equal(serverSource.includes('"/api/bots/:botId"'), true);
  assert.equal(serverSource.includes("deleteBotData"), true);
  assert.equal(serverSource.includes("getBotUploadDir(req.params.botId)"), true);
  assert.equal(serverSource.includes("unbindBotCallbacks(req.params.botId)"), true);
  assert.equal(serverSource.includes("bot.callback_unbind_failed"), true);
});

test("server supports bot scoped session authorization", () => {
  assert.equal(serverSource.includes("x-bot-session-token"), true);
  assert.equal(serverSource.includes("assertBotAccess"), true);
  assert.equal(serverSource.includes("assertAdminForBot"), true);
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
