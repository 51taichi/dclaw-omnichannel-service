import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("task tab appears before group management in the workspace navigation", () => {
  const tabBar = html.slice(
    html.indexOf('<div class="workspace-tabs"'),
    html.indexOf('<div class="current-bot-actions"')
  );
  assert.ok(tabBar.indexOf('data-workspace-tab="flow"') < tabBar.indexOf('data-workspace-tab="groups"'));
});

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

test("group sidebar uses the standard split-label search field", () => {
  const sidebar = html.slice(
    html.indexOf('<aside class="groups-sidebar">'),
    html.indexOf('<div id="groupList"')
  );

  assert.match(
    sidebar,
    /class="groups-search-field"[\s\S]*class="field-label"[\s\S]*<use href="#icon-search"><\/use><\/svg>搜索群/
  );
  assert.match(sidebar, /id="groupSearchInput"[^>]*placeholder="搜索群名"/);
  assert.match(
    css,
    /\.groups-search-field\s*\{[^}]*grid-template-columns:\s*max-content minmax\(0,\s*1fr\)/s
  );
  assert.doesNotMatch(css, /\.groups-search-field > \.icon/);
});

test("external create uses a dialog and selects private contacts without group remarks", () => {
  assert.match(html, /id="createGroupDialog"/);
  assert.doesNotMatch(html, /id="modifyGroupDialog"/);
  assert.doesNotMatch(html, /同时设置群备注|name="currentRemark"|群备注/);
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
  assert.doesNotMatch(app, /openModifyGroupButton|openModifyGroupDialog|modifyGroupForm/);
  assert.doesNotMatch(app, /\/api\/groups\/\$\{encodeURIComponent\(state\.selectedGroupId\)\}\/external/);
  assert.doesNotMatch(app, /modifyRemark|currentRemark:\s*form\.get\("currentRemark"\)/);
});

test("group dialogs keep pagination and footer actions inside fixed layout rows", () => {
  assert.match(
    css,
    /\.confirm-dialog\.groups-dialog\s*\{[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/s
  );
  assert.match(
    css,
    /\.groups-contact-pagination\s+\.pagination-size\s*\{[^}]*display:\s*inline-flex[^}]*grid-template-columns:\s*none[^}]*flex:\s*0\s+0\s+auto[^}]*white-space:\s*nowrap/s
  );
  assert.match(css, /\.groups-dialog-actions\s*\{[^}]*min-height:\s*66px/s);
});

test("group configuration includes background, reply policy, roles, and tag-group binding", () => {
  assert.match(app, /群背景/);
  assert.match(app, /始终回复（重要客户/);
  assert.match(app, /群角色/);
  assert.match(app, /tagGroupIds/);
  assert.doesNotMatch(app, /data-role-field="syncMarkName"/);
  assert.doesNotMatch(app, /data-role-field="desiredMarkName"|群成员备注|originalMarkName/);
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

test("group announcements and background use fixed-slot expanding editors", () => {
  const groupDialogs = html.slice(
    html.indexOf('id="createGroupDialog"'),
    html.indexOf('id="conversationResetLoadingDialog"')
  );
  assert.equal((groupDialogs.match(/class="expand-field-slot groups-announcement-slot"/g) || []).length, 1);
  assert.equal((groupDialogs.match(/textarea class="expand-on-focus" name="announcement" rows="1"/g) || []).length, 1);
  assert.match(
    app,
    /expand-field-slot groups-background-slot[\s\S]*?groups-background-field[\s\S]*?textarea class="expand-on-focus" name="background" rows="1"/
  );
  assert.match(css, /\.groups-announcement-slot,\s*\.groups-background-slot\s*\{[^}]*height:\s*40px/s);
});

test("group management reuses compact editors and supplied group identity", () => {
  const groupTabStart = html.indexOf('data-workspace-tab="groups"');
  const groupTab = html.slice(
    groupTabStart,
    html.indexOf("</button>", groupTabStart) + "</button>".length
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
  assert.match(renderGroupList, /<strong title="\$\{escapeHtml\(group\.currentName\)\}">/);
  assert.doesNotMatch(renderGroupList, /groups-list-item-meta|仅 @ 回复|始终回复|从不回复/);
  assert.match(
    css,
    /\.groups-list-item\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)[^}]*justify-content:\s*stretch[^}]*width:\s*100%/s
  );
  assert.match(
    css,
    /\.groups-list-item-main\s*\{[^}]*grid-template-columns:\s*44px\s+minmax\(0,\s*1fr\)[^}]*grid-template-rows:\s*auto\s+auto[^}]*width:\s*100%/s
  );
  assert.match(
    css,
    /\.groups-list-item-icon\s*\{[^}]*grid-row:\s*1\s*\/\s*3/s
  );
  assert.match(
    css,
    /\.groups-list-date-tag\s*\{[^}]*grid-column:\s*2[^}]*grid-row:\s*2[^}]*justify-self:\s*start/s
  );
  assert.doesNotMatch(css, /\.groups-list-date-tag\s*\{[^}]*min-width:\s*112px/s);
});

test("group list supports browser-local pinned groups without opening group detail", () => {
  const renderGroupList = app.slice(
    app.indexOf("function renderGroupList()"),
    app.indexOf("async function loadGroupDetail")
  );
  assert.match(html, /<script src="\.\/group-pins\.js"><\/script>[\s\S]*?<script src="\.\/app\.js"><\/script>/);
  assert.match(renderGroupList, /GroupPins\.readPinnedGroupIds\(localStorage,\s*window\.WorkspaceContext\?\.slug,\s*state\.selectedBotId\)/);
  assert.match(renderGroupList, /GroupPins\.sortGroupsByPinned\(state\.groups,\s*pinnedGroupIds\)/);
  assert.match(renderGroupList, /data-group-pin=/);
  assert.match(renderGroupList, /aria-label="\$\{pinned \? "取消置顶" : "置顶群聊"\}"/);
  assert.match(renderGroupList, /title="\$\{pinned \? "取消置顶" : "置顶群聊"\}"/);
  assert.match(renderGroupList, /event\.preventDefault\(\)/);
  assert.match(renderGroupList, /event\.stopPropagation\(\)/);
  assert.match(renderGroupList, /GroupPins\.togglePinnedGroupId/);
  assert.match(css, /\.groups-list-pin\s*\{[^}]*width:\s*32px[^}]*height:\s*32px/s);
  assert.match(css, /\.groups-list-item\.is-pinned/);
});

test("group workbench and role rows stay bounded inside the available viewport", () => {
  assert.match(css, /#groupsTab\s*\{[^}]*height:\s*100%/s);
  assert.match(css, /\.groups-panel\s*\{[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.groups-sidebar[\s\S]*?overflow-y:\s*auto/s);
  assert.match(css, /\.groups-config[\s\S]*?overflow-y:\s*auto/s);
  assert.match(css, /\.groups-role-row\s*\{[^}]*width:\s*100%/s);
});

test("role actions share the standard fixed footer without a redundant heading", () => {
  assert.doesNotMatch(app, /class="groups-role-head"/);
  assert.match(
    app,
    /id="groupRolesForm"[\s\S]*?class="groups-panel-footer"[\s\S]*?id="addGroupRoleButton"[\s\S]*?groups-save-roles[\s\S]*?保存角色/
  );
  assert.match(
    css,
    /\.groups-config-form,\s*\.groups-roles-form,\s*\.group-automation-section\.groups-detail-panel\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto[^}]*overflow:\s*hidden/s
  );
  assert.match(css, /\.groups-panel-content,\s*\.group-automation-list\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(
    css,
    /\.groups-panel-footer\s*\{[^}]*background:\s*#ffffff[^}]*border-top:\s*1px solid var\(--line\)[^}]*position:\s*relative/s
  );
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

test("contact picker keeps a full-page viewport when the last page has fewer contacts", () => {
  assert.match(
    css,
    /\.groups-contact-list\s*\{[^}]*height:\s*242px[^}]*min-height:\s*242px[^}]*overflow-y:\s*auto/s
  );
  assert.match(
    css,
    /\.groups-contact-grid\s*\{[^}]*gap:\s*8px[^}]*grid-auto-rows:\s*42px[^}]*grid-template-columns:\s*repeat\(4,/s
  );
});
