import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/admin/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/admin/styles.css", import.meta.url), "utf8");

test("admin console exposes global management tabs without user management", () => {
  assert.equal(html.includes("/console/assets/deepmega-dclaw-logo-cropped.png"), true);
  assert.match(html, /<title>微信AI销售客服管理后台<\/title>/);
  assert.match(html, /class="topbar admin-topbar"[\s\S]*class="topbar-inner"[\s\S]*class="brand"/);
  assert.match(html, /<h1>微信AI销售客服管理后台<\/h1>/);
  assert.equal(html.includes("/console/assets/wechat.png"), true);
  assert.equal(html.includes("/console/assets/compay_wechat.png"), true);
  for (const label of ["工作区", "Bots", "Agents", "系统设置", "退出"]) {
    assert.equal(html.includes(label), true, `missing ${label}`);
  }
  assert.equal(html.includes("管理员账号管理"), false);
  assert.equal(html.includes("/shared/auth-shell.js"), true);
  assert.equal(html.includes("/shared/auth-shell.css"), true);
});

test("admin console uses singleton session authentication", () => {
  assert.equal(app.includes("worktool_admin_session"), true);
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
  assert.equal(app.includes("worktool_workspace_sessions"), true);
  assert.equal(app.includes("?bot="), true);
  assert.match(app, /window\.open\("about:blank",\s*"_blank"\)/);
  assert.match(app, /workspaceTab\.location\.replace\(targetUrl\)/);
  assert.match(app, /catch \(error\) \{[\s\S]*workspaceTab\.close\(\);[\s\S]*throw error/);
  assert.equal(app.includes("window.location.href = `/console/"), false);
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

test("admin console owns Agent and Bot global maintenance", () => {
  assert.equal(app.includes("/api/agents"), true);
  assert.equal(app.includes("/api/bots"), true);
  assert.equal(html.includes("agentForm"), true);
  assert.equal(html.includes("botForm"), true);
  assert.equal(html.includes("workspaceColumn"), true);
});

test("admin console reuses platform styles with focused operational layout", () => {
  assert.equal(css.includes('@import url("/console/styles.css")'), true);
  assert.equal(css.includes(".admin-workspace-layout"), true);
  assert.equal(css.includes(".admin-assignment-modal"), true);
  assert.equal(css.includes("border-radius: 8px"), true);
  assert.match(css, /\.admin-page\s*\{[\s\S]*?width:\s*min\(1440px,\s*calc\(100% - 16px\)\)/);
  assert.match(css, /\.admin-tabs\s*\{[\s\S]*?padding:\s*5px/);
  assert.match(css, /\.admin-tabs button\s*\{[\s\S]*?height:\s*36px/);
  assert.match(css, /\.admin-topbar \.brand-copy h1\s*\{[\s\S]*?linear-gradient/);
  assert.match(css, /\.admin-workspace-select\s*\{[\s\S]*?justify-content:\s*flex-start/);
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
  for (const icon of ["grid", "open", "transfer", "unlink", "edit", "settings", "trash"]) {
    assert.equal(app.includes(`adminIcon("${icon}")`), true, `dynamic controls missing ${icon} icon`);
  }
});
