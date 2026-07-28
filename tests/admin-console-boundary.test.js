import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/admin/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/admin/styles.css", import.meta.url), "utf8");

test("admin console exposes global management tabs without user management", () => {
  assert.equal(html.includes("/console/assets/deepmega-dclaw-logo-cropped.png"), true);
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
  assert.equal(app.includes("登录后维护工作区、Bots、Agents 和系统设置。"), false);
  assert.match(app, /prompt:\s*message,/);
  assert.match(app, /showSuccess\(\{[\s\S]*seconds:\s*3/);
});

test("admin workspace UI supports assignment transfer removal and direct opening", () => {
  assert.match(
    html,
    /<span>下半句口令<\/span><input name="response" type="text"/
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
});
