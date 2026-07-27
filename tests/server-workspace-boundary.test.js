import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("server exposes admin workspace and public phrase routes", () => {
  for (const route of [
    '"/api/admin/workspaces"',
    '"/api/admin/workspaces/:id"',
    '"/api/admin/workspaces/:id/bots"',
    '"/api/admin/workspaces/:id/bots/:botId"',
    '"/api/admin/workspaces/:id/bots/:botId/transfer"',
    '"/api/admin/workspaces/:id/session"',
    '"/api/workspaces/:slug/challenge"',
    '"/api/workspaces/:slug/unlock"',
    '"/api/workspaces/:slug/logout"',
    '"/api/workspaces/:slug/bots"'
  ]) {
    assert.equal(source.includes(route), true, `missing ${route}`);
  }
  assert.equal(source.includes("x-workspace-session-token"), true);
  assert.match(source, /listWorkspaceBots\([^)]*\)\.map\(publicBotView\)/);
});

test("workspace routes do not invalidate existing Bot sessions", () => {
  const routeStart = source.indexOf('"/api/admin/workspaces"');
  const routeEnd = source.indexOf('"/api/bots/:botId/unlock"', routeStart);
  const workspaceRoutes = source.slice(routeStart, routeEnd);

  assert.equal(workspaceRoutes.includes("deleteBotSession("), false);
  assert.equal(workspaceRoutes.includes("deleteBotSessionsForBot("), false);
});

test("server serves independent admin and slug-scoped console entries", () => {
  assert.equal(source.includes('app.use("/admin", express.static'), true);
  assert.equal(source.includes('app.use("/shared", express.static'), true);
  assert.equal(source.includes('app.get("/console"'), true);
  assert.equal(source.includes('app.get("/console/:slug"'), true);
  assert.equal(source.includes('path.join(publicDir, "console", "index.html")'), true);
  assert.match(source, /res\.type\("html"\)\.send\(fs\.readFileSync\(consoleIndexPath,\s*"utf8"\)\)/);
});
