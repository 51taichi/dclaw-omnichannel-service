import assert from "node:assert/strict";
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
  assert.match(app, /syncMarkName/);
  assert.match(app, /groups-list-item-main/);
  assert.match(app, /groups-list-item-meta/);
  assert.match(app, /groups-tag-card/);
  assert.match(app, /groups-role-columns/);
  assert.match(app, /data-role-label=/);
  assert.ok((app.match(/<svg class="icon"/g) || []).length >= 10);
});
