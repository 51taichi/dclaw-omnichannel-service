import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/admin/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/admin/styles.css", import.meta.url), "utf8");

test("admin console exposes global management tabs without user management", () => {
  assert.equal(html.includes("/console/assets/deepmega-dclaw-logo-cropped.png"), true);
  assert.match(html, /<title>WhatsApp AI 销售客服管理后台<\/title>/);
  assert.match(html, /class="topbar admin-topbar"[\s\S]*class="topbar-inner"[\s\S]*class="brand"/);
  assert.match(html, /<h1>WhatsApp AI 销售客服管理后台<\/h1>/);
  assert.equal(html.includes('class="platform-logo whatsapp"'), true);
  for (const label of ["工作区", "Bots", "Agents", "系统设置", "退出"]) {
    assert.equal(html.includes(label), true, `missing ${label}`);
  }
  assert.equal(html.includes("管理员账号管理"), false);
  assert.equal(html.includes("/shared/auth-shell.js"), true);
  assert.equal(html.includes("/shared/auth-shell.css"), true);
});

test("admin console uses singleton session authentication", () => {
  assert.equal(app.includes("dclaw_omnichannel_admin_session"), true);
  assert.equal(app.includes('"x-admin-session-token"'), true);
  for (const path of [
    "/api/admin/login",
    "/api/admin/logout",
    "/api/admin/session",
    "/api/admin/password"
  ]) {
    assert.equal(app.includes(path), true, `missing ${path}`);
  }
  assert.equal(app.includes('accountLabel: "admin"'), true);
  assert.equal(app.includes('fieldLabel: "密码"'), true);
  assert.equal(app.includes("登录后维护工作区、Bots、Agents 和系统设置。"), false);
  assert.match(app, /prompt:\s*message,/);
  assert.match(app, /showSuccess\(\{[\s\S]*seconds:\s*3/);
});

test("admin workspace UI supports assignment transfer removal and direct opening", () => {
  assert.match(
    html,
    /<span><svg[\s\S]*?下半句口令<\/span><input name="response" type="text"/
  );
  assert.equal(app.includes("/api/admin/workspaces/unassigned-bots"), true);
  assert.equal(app.includes("selectedBotIds"), true);
  assert.equal(app.includes("/transfer"), true);
  assert.equal(app.includes("targetWorkspaceId"), true);
  assert.equal(app.includes("原入口"), true);
  assert.equal(app.includes("dclaw_omnichannel_workspace_sessions"), true);
  assert.equal(app.includes("?bot="), true);
  assert.match(app, /window\.open\("about:blank",\s*"_blank"\)/);
  assert.match(app, /workspaceTab\.location\.replace\(targetUrl\)/);
  assert.match(app, /catch \(error\) \{[\s\S]*workspaceTab\.close\(\);[\s\S]*throw error/);
  assert.equal(app.includes("window.location.href = `/console/"), false);
});

test("assigned workspace Bots use the same card layout as Agents", () => {
  const renderStart = app.indexOf("function renderWorkspaceBots(bots)");
  const renderEnd = app.indexOf("async function saveWorkspace", renderStart);
  const renderSource = app.slice(renderStart, renderEnd);

  assert.match(html, /id="workspaceBots" class="agent-card-grid admin-workspace-bot-grid"/);
  assert.match(renderSource, /class="agent-card admin-workspace-bot-card/);
  assert.match(renderSource, /class="agent-card-head"/);
  assert.match(renderSource, /class="agent-avatar" src="\/console\/assets\/bot-avatar\.png"/);
  assert.match(renderSource, /class="agent-summary"/);
  assert.match(renderSource, /class="agent-meta"/);
  assert.match(renderSource, /绑定 Agent：/);
  assert.match(renderSource, /class="row-actions admin-workspace-bot-actions"/);
  assert.doesNotMatch(renderSource, /<small>\$\{escapeHtml\(bot\.botId\)/);
});

test("admin workspace cards show only the name with a left icon and enabled switch", () => {
  const renderStart = app.indexOf("function renderWorkspaceList()");
  const renderEnd = app.indexOf("async function selectWorkspace", renderStart);
  const renderSource = app.slice(renderStart, renderEnd);

  assert.match(renderSource, /class="admin-workspace-card/);
  assert.match(renderSource, /class="admin-workspace-select"/);
  assert.match(renderSource, /adminIcon\("grid"\)[\s\S]*?<strong>\$\{escapeHtml\(workspace\.name\)\}<\/strong>/);
  assert.match(renderSource, /data-workspace-enabled="\$\{workspace\.id\}"/);
  assert.match(renderSource, /class="switch-slider"/);
  assert.equal(renderSource.includes("workspace.slug"), false);
  assert.equal(renderSource.includes("workspace.botCount"), false);
  assert.equal(app.includes("async function toggleWorkspaceEnabled"), true);
  assert.match(app, /JSON\.stringify\(\{ enabled \}\)/);
});

test("admin enabled fields consistently use switch controls", () => {
  const enabledFields = [
    ...html.matchAll(
      /<label class="toggle-line admin-switch-field switch-toggle">([\s\S]*?)<\/label>/g
    )
  ].map((match) => match[1]);

  assert.equal(enabledFields.length, 3);
  for (const field of enabledFields) {
    assert.match(field, /<svg\b/);
    assert.match(field, /type="checkbox"/);
    assert.match(field, /class="switch-slider"/);
  }
  assert.match(css, /\.admin-switch-field\s*\{[\s\S]*?align-self:\s*center/);
  assert.match(css, /\.admin-switch-field\s*\{[\s\S]*?justify-self:\s*start/);
  assert.match(css, /\.admin-switch-field\s*\{[\s\S]*?width:\s*min\(220px,\s*100%\)/);
  assert.match(css, /\.admin-switch-field \.switch-slider\s*\{[\s\S]*?margin-left:\s*auto/);
  assert.match(css, /\.admin-form \.admin-actions\s*\{[\s\S]*?grid-column:\s*2/);
  assert.equal((html.match(/class="admin-form-control-row"/g) || []).length, 2);
  assert.match(
    css,
    /\.admin-form-control-row\s*\{[\s\S]*?align-items:\s*center[\s\S]*?justify-content:\s*space-between/
  );
});

test("admin Bot table hides internal Bot IDs from the visible name column", () => {
  const renderStart = app.indexOf("function renderBotList()");
  const renderEnd = app.indexOf("async function saveBot", renderStart);
  const renderSource = app.slice(renderStart, renderEnd);

  assert.match(
    renderSource,
    /<span><strong>\$\{escapeHtml\(bot\.botName \|\| bot\.botId\)\}<\/strong><\/span>/
  );
  assert.doesNotMatch(renderSource, /<small>\$\{escapeHtml\(bot\.botId\)\}<\/small>/);
});

test("admin Agent list uses the console Agent card layout", () => {
  const renderStart = app.indexOf("function renderAgentList()");
  const renderEnd = app.indexOf("async function saveAgent", renderStart);
  const renderSource = app.slice(renderStart, renderEnd);

  assert.match(html, /id="agentList" class="agent-card-grid admin-agent-card-grid"/);
  assert.match(renderSource, /class="agent-card admin-agent-card/);
  assert.match(renderSource, /class="agent-card-head"/);
  assert.match(renderSource, /class="agent-avatar" src="\/console\/assets\/bot-avatar\.png"/);
  assert.match(renderSource, /class="agent-summary"/);
  assert.match(renderSource, /class="agent-meta"/);
  assert.match(renderSource, /Public ID：/);
  assert.match(renderSource, /已绑定 Bot：\$\{boundCount\}/);
  assert.match(renderSource, /class="row-actions admin-agent-actions"/);
  assert.doesNotMatch(renderSource, /agent\.dclawBaseUrl/);
  assert.doesNotMatch(renderSource, />启用<\/span>|>停用<\/span>/);
});

test("admin console owns Agent and Bot global maintenance", () => {
  assert.equal(app.includes("/api/agents"), true);
  assert.equal(app.includes("/api/bots"), true);
  assert.equal(html.includes("agentForm"), true);
  assert.equal(html.includes("botForm"), true);
  assert.equal(html.includes("workspaceColumn"), true);
});

test("administrator Bots page owns Bot key and debug reply maintenance", () => {
  assert.match(html, /id="botMaintenancePanel"[^>]*hidden/);
  assert.match(html, /<h2><span id="botMaintenanceName"><\/span><\/h2>/);
  assert.doesNotMatch(html, /系统维护 ·/);
  assert.doesNotMatch(html, /id="adminBotAccessKeyForm"/);
  assert.match(
    html,
    /id="botPasswordModal"[^>]*hidden[\s\S]*role="dialog"[\s\S]*id="botPasswordTitle"[\s\S]*id="botPasswordName"[\s\S]*id="botPasswordForm"[\s\S]*name="accessKey"[^>]*type="password"[\s\S]*id="botPasswordCancelButton"/
  );
  assert.match(html, /id="adminDebugReplyForm"[\s\S]*name="enabled"[^>]*type="checkbox"[\s\S]*name="trigger"[\s\S]*name="reply"/);
  assert.match(app, /selectedBotId:\s*""/);
  assert.match(app, /passwordBotId:\s*""/);
  assert.match(app, /passwordDialogVersion:\s*0/);
  assert.match(app, /passwordDialogTrigger:\s*null/);
  assert.match(app, /debugReplyLoadVersion:\s*0/);
  assert.match(app, /async function selectBotForEditing\(botId\)/);
  assert.match(app, /async function loadBotMaintenance\(botId\)/);
  assert.match(app, /function openBotPasswordDialog\(botId, trigger = null\)/);
  assert.match(app, /function closeBotPasswordDialog\(\{ force = false \} = \{\}\)/);
  assert.match(app, /if \(!force && els\.botPasswordForm\.classList\.contains\("is-busy"\)\) return/);
  assert.match(app, /const requestVersion = state\.passwordDialogVersion/);
  assert.match(app, /state\.passwordDialogVersion !== requestVersion \|\| state\.passwordBotId !== botId/);
  assert.match(app, /function trapBotPasswordFocus\(event\)/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /event\.key === "Tab"/);
  assert.match(app, /\/api\/bots\/\$\{encodeURIComponent\(botId\)\}\/access-key/);
  assert.match(app, /\/api\/bots\/\$\{encodeURIComponent\(botId\)\}\/settings\/debug-reply/);
  assert.match(css, /\.admin-bot-password-modal\s*\{[\s\S]*width:\s*min\(480px,\s*100%\)/);
});

test("Bot list exposes password and direct Bot actions", () => {
  const renderStart = app.indexOf("function renderBotList()");
  const renderEnd = app.indexOf("async function saveBot", renderStart);
  const renderSource = app.slice(renderStart, renderEnd);

  assert.match(renderSource, /data-password-bot="\$\{escapeHtml\(bot\.botId\)\}"[\s\S]*adminIcon\("key"\)\}修改密码/);
  assert.match(renderSource, /data-enter-bot="\$\{escapeHtml\(bot\.botId\)\}"[\s\S]*adminIcon\("open"\)\}进入 Bot/);
  assert.doesNotMatch(renderSource, /进入配置/);
  assert.match(renderSource, /openBotPasswordDialog\(button\.dataset\.passwordBot, button\)/);
  assert.match(renderSource, /await openWorkspace\(button\.dataset\.enterBot\)/);
  assert.match(app, /const suffix = botId \? `\?bot=\$\{encodeURIComponent\(botId\)\}` : ""/);
  assert.match(css, /\.admin-table-row\s*\{[\s\S]*grid-template-columns:[^;]*minmax\(300px/);
  assert.match(css, /\.admin-table-row > \.admin-actions\s*\{[\s\S]*flex-wrap:\s*wrap/);
});

test("admin console reuses platform styles with focused operational layout", () => {
  assert.equal(css.includes('@import url("/console/styles.css")'), true);
  assert.equal(css.includes(".admin-workspace-layout"), true);
  assert.equal(css.includes(".admin-assignment-modal"), true);
  assert.equal(css.includes("border-radius: 8px"), true);
  assert.match(css, /\.admin-page\s*\{[\s\S]*?width:\s*min\(1440px,\s*calc\(100% - 16px\)\)/);
  assert.match(css, /\.admin-tabs\s*\{[\s\S]*?padding:\s*5px/);
  assert.match(css, /\.admin-tabs button\s*\{[\s\S]*?height:\s*36px/);
  assert.match(css, /\.admin-tabs::after\s*\{[\s\S]*?border-width:\s*0 0 3px/);
  assert.match(css, /\.admin-topbar \.brand-copy h1\s*\{[\s\S]*?linear-gradient/);
  assert.match(css, /\.admin-workspace-select\s*\{[\s\S]*?justify-content:\s*flex-start/);
});

test("admin form labels share one width that keeps the longest label on one line", () => {
  assert.match(
    css,
    /\.admin-form label:not\(\.toggle-line\)\s*\{[\s\S]*?grid-template-columns:\s*190px minmax\(0,\s*1fr\)/
  );
  assert.match(
    css,
    /\.admin-form label:not\(\.toggle-line\) > span\s*\{[\s\S]*?white-space:\s*nowrap/
  );
  assert.doesNotMatch(css, /\.admin-form label > span\s*\{/);
  assert.match(css, /\.toggle-line\s*\{[\s\S]*?align-items:\s*center/);
});

test("admin fields and buttons consistently render semantic icons", () => {
  const buttonBodies = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)]
    .map((match) => match[1]);
  const labelBodies = [...html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)]
    .map((match) => match[1]);

  assert.ok(buttonBodies.length > 0);
  assert.ok(labelBodies.length > 0);
  for (const body of buttonBodies) assert.match(body, /<svg\b/);
  for (const body of labelBodies) assert.match(body, /<svg\b/);

  for (const icon of [
    "name",
    "link",
    "quote",
    "power",
    "id",
    "key",
    "search",
    "edit",
    "transfer",
    "unlink",
    "check",
    "close",
    "login"
  ]) {
    assert.equal(html.includes(`id="admin-icon-${icon}"`), true, `missing ${icon} icon`);
  }

  assert.match(html, /class="admin-search-field"[\s\S]*?<svg[\s\S]*?id="assignmentSearch"/);
  assert.match(app, /function adminIcon\(name\)/);
  for (const icon of ["grid", "open", "transfer", "unlink", "edit", "key", "trash"]) {
    assert.equal(app.includes(`adminIcon("${icon}")`), true, `dynamic controls missing ${icon} icon`);
  }
});

test("admin configuration labels remain icon-led and do not embed display units", () => {
  const formLabels = [...html.matchAll(/<form\b[^>]*class="[^"]*admin-form[^"]*"[^>]*>([\s\S]*?)<\/form>/g)]
    .flatMap((formMatch) => [...formMatch[1].matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)])
    .map((labelMatch) => labelMatch[1]);

  assert.ok(formLabels.length > 0);
  for (const body of formLabels) assert.match(body, /<svg\b/);
  assert.doesNotMatch(html, /（(?:秒|分钟|小时|字符)）/);
});
