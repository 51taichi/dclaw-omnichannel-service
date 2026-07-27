import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");
const entryUrl = new URL("../public/console/workspace-entry.js", import.meta.url);

test("console loads the shared phrase shell before its business application", () => {
  assert.equal(fs.existsSync(entryUrl), true);
  assert.match(html, /href="\/shared\/auth-shell\.css"/);
  assert.match(html, /src="\/shared\/auth-shell\.js"/);
  assert.match(
    html,
    /src="\/shared\/auth-shell\.js"[\s\S]*src="\.\/workspace-entry\.js"[\s\S]*src="\.\/app\.js"/
  );
  assert.equal(html.includes('id="workspaceAuthRoot"'), true);
  assert.equal(html.includes('id="workspaceLogoutButton"'), true);
});

test("workspace entry requires an exact console slug and stores scoped sessions", () => {
  const entry = fs.readFileSync(entryUrl, "utf8");

  assert.match(entry, /location\.pathname\.match\(\/\^\\\/console\\\/\(\[a-z0-9-\]\{3,32\}\)\\\/\?\$\/\)/);
  assert.equal(entry.includes("worktool_workspace_sessions"), true);
  assert.equal(entry.includes("/api/workspaces/${encodeURIComponent(slug)}/challenge"), true);
  assert.equal(entry.includes("/api/workspaces/${encodeURIComponent(slug)}/unlock"), true);
  assert.equal(entry.includes("/api/workspaces/${encodeURIComponent(slug)}/bots"), true);
  assert.equal(entry.includes('"x-workspace-session-token"'), true);
  assert.equal(entry.includes("seconds: 3"), true);
  assert.equal(entry.includes("AuthShell.mount"), true);
  assert.equal(entry.includes("当前入口不可用"), true);
});

test("workspace context gates startup and only loads assigned Bots", () => {
  const entry = fs.readFileSync(entryUrl, "utf8");

  assert.match(entry, /(?:window|global)\.WorkspaceContext/);
  assert.equal(entry.includes("ready"), true);
  assert.equal(entry.includes("loadBots"), true);
  assert.equal(entry.includes("logout"), true);
  assert.equal(entry.includes("handleUnauthorized"), true);
  assert.equal(app.includes("await window.WorkspaceContext.ready"), true);
  assert.equal(app.includes("window.WorkspaceContext.loadBots()"), true);
  assert.equal(app.includes('request("/api/public/bots")'), false);
  assert.equal(app.includes("x-workspace-session-token"), false);
});

test("workspace entry supports direct Bot selection without bypassing Bot unlock", () => {
  assert.equal(app.includes('new URLSearchParams(window.location.search).get("bot")'), true);
  assert.equal(app.includes("openUnlockDialog"), true);
  assert.equal(app.includes("setBotSession(directBotId"), false);
});

test("employee console does not expose global Agent maintenance", () => {
  assert.equal(html.includes('id="agentManagementPanel"'), false);
  assert.equal(html.includes('id="agentForm"'), false);
  assert.equal(html.includes('id="agentsList"'), false);
  assert.equal(app.includes("saveAgent("), false);
  assert.equal(app.includes("deleteAgent("), false);
  assert.equal(app.includes("data-agent-edit"), false);
  assert.equal(app.includes("data-agent-delete"), false);

  assert.equal(app.includes("currentAgents"), true);
  assert.equal(app.includes("loadAgents"), true);
  assert.equal(app.includes("renderAgentOptions"), true);
  assert.match(html, /<select name="agentId" required>/);
});

test("employee-facing workspace shell avoids fixed organization terminology", () => {
  const entry = fs.readFileSync(entryUrl, "utf8");
  for (const label of ["部门", "组织", "工作区"]) {
    assert.equal(entry.includes(label), false, `workspace entry should not display ${label}`);
  }
  assert.match(css, /\.workspace-entry-logout/);
});
