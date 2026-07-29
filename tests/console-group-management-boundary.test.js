import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("group management is a separate tab with a 30/70 configuration layout and no chat history", () => {
  assert.match(html, /data-workspace-tab="groups"/);
  const panel = html.slice(html.indexOf('id="groupsTab"'), html.indexOf('id="sessionsTab"'));
  assert.match(panel, /id="groupList"/);
  assert.match(panel, /id="groupConfigPane"/);
  assert.doesNotMatch(panel, /chatMessages|会话记录/);
  assert.doesNotMatch(panel, /这里只配置群|<h2[^>]*>.*群管理/s);
  assert.match(panel, /groups-toolbar/);
  assert.match(css, /grid-template-columns:\s*minmax\(240px,\s*30%\)\s+minmax\(0,\s*70%\)/);
});

test("external create and modify use dialogs and create selects private contacts", () => {
  assert.match(html, /id="createGroupDialog"/);
  assert.match(html, /id="modifyGroupDialog"/);
  assert.match(html, /id="createGroupContactList"/);
  assert.match(html, /groups-dialog-header/);
  assert.match(html, /groups-dialog-body/);
  assert.match(html, /groups-dialog-actions/);
  assert.match(
    css,
    /\.confirm-dialog\.groups-dialog\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s
  );
  assert.match(app, /targetType:\s*"private"/);
  assert.match(app, /\/api\/groups\/create/);
});

test("group configuration includes background, reply policy, roles, and tag-group binding", () => {
  assert.match(app, /群背景/);
  assert.match(app, /始终回复（重要客户/);
  assert.match(app, /群角色/);
  assert.match(app, /tagGroupIds/);
  assert.doesNotMatch(app, /data-role-field="syncMarkName"/);
  assert.doesNotMatch(app, />同步<\/span>/);
  assert.doesNotMatch(app, /groups-role-sync/);
  assert.match(app, /groups-list-item-main/);
  assert.doesNotMatch(app, /groups-list-item-meta/);
  assert.doesNotMatch(app, /未设置群公告/);
  assert.match(app, /groups-tag-card/);
  assert.match(app, /groups-role-columns/);
  assert.match(app, /data-role-label=/);
  assert.ok((app.match(/<svg class="icon"/g) || []).length >= 10);
});

test("group management reuses compact editors and supplied group identity", () => {
  const groupTab = html.slice(
    html.indexOf('data-workspace-tab="groups"'),
    html.indexOf('data-workspace-tab="flow"')
  );
  assert.match(groupTab, /<svg class="icon"[^>]*><use href="#icon-tool"><\/use><\/svg>/);
  assert.doesNotMatch(groupTab, /assets\/group\.png|workspace-tab-image/);
  assert.match(app, /groups-background-field[\s\S]*?expand-on-focus/);
  assert.doesNotMatch(app, /角色由你维护，用于识别发言人与回复策略/);
  assert.match(app, /group-asset-icon[\s\S]*?assets\/group\.png/);
});

test("group list uses avatar copy and a Beijing creation-date tag without reply badge", () => {
  const groupDateHelper = app.slice(
    app.indexOf("function groupDateTagLabel(group)"),
    app.indexOf("function renderGroupList()")
  );
  const renderGroupList = app.slice(
    app.indexOf("function renderGroupList()"),
    app.indexOf("async function loadGroupDetail")
  );
  const probe = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `const BEIJING_TIME_ZONE = "Asia/Shanghai";\n${groupDateHelper}\nconsole.log(groupDateTagLabel({ groupCreatedAt: "2026-07-29 20:00:00" }));`
  ], {
    encoding: "utf8",
    env: { ...process.env, TZ: "UTC" }
  });
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout.trim(), "20260729");
  assert.match(app, /function groupDateTagLabel\(group\)[\s\S]*?timeZone:\s*BEIJING_TIME_ZONE/);
  assert.match(renderGroupList, /groups-list-date-tag/);
  assert.match(renderGroupList, /groupDateTagLabel\(group\)/);
  assert.doesNotMatch(renderGroupList, /groups-list-item-meta|仅 @ 回复|始终回复|从不回复/);
  assert.match(
    css,
    /\.groups-list-item-main\s*\{[^}]*grid-template-columns:\s*44px\s+minmax\(0,\s*1fr\)\s+auto/s
  );
});

test("group workbench and role rows stay bounded inside the available viewport", () => {
  assert.match(css, /#groupsTab\s*\{[^}]*height:\s*100%/s);
  assert.match(css, /\.groups-panel\s*\{[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.groups-sidebar[\s\S]*?overflow-y:\s*auto/s);
  assert.match(css, /\.groups-config[\s\S]*?overflow-y:\s*auto/s);
  assert.match(css, /\.groups-role-row\s*\{[^}]*width:\s*100%/s);
});

test("role save action sits beside add role and still submits the role form", () => {
  assert.match(
    app,
    /groups-role-actions[\s\S]*?id="addGroupRoleButton"[\s\S]*?form="groupRolesForm"[\s\S]*?保存角色/
  );
  assert.doesNotMatch(app, /groups-role-list[\s\S]*?<\/div>\s*<button[^>]*groups-save-roles/);
});

test("external group contacts reuse push-style selectable cards", () => {
  assert.match(html, /id="createGroupContactPagination" class="pagination-bar groups-contact-pagination"/);
  assert.match(app, /groups-contact-card \$\{selected \? "selected" : ""\}/);
  assert.match(app, /targetTypeAvatar\("private"\)/);
  assert.match(app, /groups-contact-checkbox/);
  assert.match(app, /createGroupContactsPagination:\s*\{\s*page:\s*1,\s*pageSize:\s*20/);
  assert.match(app, /page:\s*String\(state\.createGroupContactsPagination\.page\)/);
  assert.match(app, /renderPaginationBar\(\{[\s\S]*?container:\s*els\.createGroupContactPagination/);
  assert.match(css, /\.groups-contact-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,/s);
  assert.match(css, /\.groups-contact-pagination\s*\{[^}]*justify-content:\s*flex-end/s);
});
