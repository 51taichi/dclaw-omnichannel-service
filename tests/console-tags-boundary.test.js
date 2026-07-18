import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("console has customer tags workspace tab", () => {
  assert.match(html, /data-workspace-tab="tags"/);
  assert.match(html, /data-workspace-tab="tags"[\s\S]*href="#icon-tag"[\s\S]*标签/);
  assert.match(html, /id="tagSchemaPanel"/);
  assert.doesNotMatch(html, /<h2 class="module-title">[\s\S]*客户标签[\s\S]*<\/h2>/);
  assert.match(html, /启用客户添加日期标签/);
});

test("console loads and saves tag schemas", () => {
  assert.match(js, /loadTagSchema/);
  assert.match(js, /saveTagSchema/);
  assert.match(js, /\/api\/tag-schemas\//);
});

test("console renders tag chips and tag filters", () => {
  assert.match(js, /renderConversationTags/);
  assert.match(js, /function sortConversationTagsForDisplay\(tags = \[\]\)/);
  assert.match(js, /const aDate = a\?\.tagType === "date" \? 0 : 1/);
  assert.match(js, /const visibleTags = sortConversationTagsForDisplay/);
  assert.match(html, /id="icon-tag"/);
  assert.match(js, /icon\("tag"\)/);
  assert.match(js, /flowSessionTagFilter/);
  assert.match(html, /id="flowSessionTagFilterButton"[\s\S]*全部/);
  assert.match(html, /id="flowSessionTagFilterMenu" class="tag-multi-select-menu"[\s\S]*role="listbox"/);
  assert.match(html, /id="flowSessionTagFilter" multiple hidden/);
  assert.match(js, /function selectedFlowSessionTagFilterValues\(\)/);
  assert.match(js, /const tagFilters = new Set\(selectedFlowSessionTagFilterValues\(\)\)/);
  assert.match(js, /tagFilters\.size && !\(session\.tags \|\| \[\]\)\.some\(\(tag\) => tagFilters\.has\(tagFilterKey\(tag\)\)\)/);
  assert.match(js, /function positionFlowSessionTagFilterMenu\(\)/);
  assert.match(js, /getBoundingClientRect\(\)/);
  assert.match(js, /function toggleFlowSessionTagFilterMenu\(\)/);
  assert.match(js, /if \(willOpen\) positionFlowSessionTagFilterMenu\(\)/);
  assert.match(js, /function setFlowSessionTagFilterValues\(values\)/);
  assert.match(js, /flowSessionTagFilterMenu\?\.addEventListener\("change"/);
  assert.match(css, /\.tag-multi-select-menu\s*\{[\s\S]*position:\s*fixed[\s\S]*z-index:\s*1000/);
  assert.match(css, /\.tag-multi-select-option\s*\{[\s\S]*grid-template-columns:\s*18px minmax\(0,\s*1fr\)/);
  assert.match(html, /id="flowSessionDateTagFilter"/);
  assert.match(html, /id="flowSessionSearchInput"[\s\S]*添加日期[\s\S]*id="flowSessionDateTagFilter"[^>]*type="date"[\s\S]*任务状态/);
  assert.doesNotMatch(html, /id="flowSessionDatePicker"/);
  assert.match(html, /添加日期/);
  assert.match(js, /function renderFlowSessionDateTagFilter\(\)/);
  assert.match(js, /function compactDateTagInputValue\(value\)/);
  assert.match(js, /function dateTagFilterKeyFromInput\(value\)/);
  assert.match(js, /tag\.tagType === "date" && tagFilterKey\(tag\) === dateTagFilterKey/);
  assert.match(js, /if \(tag\.tagType === "date"\) continue/);
  assert.match(js, /els\.flowSessionDateTagFilter\.disabled = !dateTagEnabled/);
  assert.match(js, /els\.flowSessionDateTagFilter\.value = nativeDateValueFromCompactDate\(compactValue\)/);
  assert.doesNotMatch(js, /openFlowSessionDatePicker/);
  assert.match(css, /\.flow-session-filters\s*\{[\s\S]*minmax\(208px,\s*220px\)/);
  assert.match(css, /\.flow-session-filters \.flow-session-date-filter\s*\{[\s\S]*minmax\(122px,\s*1fr\)/);
  assert.match(css, /\.tag-chip/);
  assert.match(css, /\.tag-chip \.icon\s*\{[\s\S]*width:\s*12px[\s\S]*height:\s*12px/);
});

test("conversation cards expose a right click manual tag menu", () => {
  assert.match(html, /id="flowSessionTagMenu" class="flow-session-tag-menu"/);
  assert.match(js, /flowSessionTagMenu: document\.querySelector\("#flowSessionTagMenu"\)/);
  assert.match(js, /function renderFlowSessionManualTagMenu\(\{ session, x, y \}\)/);
  assert.match(js, /const sessionName = flowSessionDisplayName\(session\)/);
  assert.match(js, /<strong>给\$\{escapeHtml\(sessionName\)\}打上标签：<\/strong>/);
  assert.match(js, /button\.addEventListener\("contextmenu"/);
  assert.match(js, /function enabledManualTagGroups\(\)/);
  assert.match(js, /group\.enabled !== false[\s\S]*tag\.enabled !== false/);
  assert.match(js, /function applyManualConversationTag\(\{ conversationKey, groupId, tagId, action \}\)/);
  assert.match(js, /\/api\/flow-sessions\/\$\{encodeURIComponent\(conversationKey\)\}\/tags\/manual/);
  assert.match(js, /hideFlowSessionManualTagMenu/);
  assert.match(css, /\.flow-session-tag-menu\s*\{[\s\S]*position:\s*fixed/);
  assert.match(css, /\.flow-session-manual-tag-option\s*\{[\s\S]*grid-template-columns:\s*18px minmax\(0,\s*1fr\)/);
});

test("tag editor supports collapsible groups with always-expanded tag cards", () => {
  assert.match(js, /collapsedTagGroups/);
  assert.match(js, /if \(tabName === "tags"\) \{[\s\S]*collapseAllTagCards\(\);[\s\S]*renderTagSchemaEditor\(\);[\s\S]*\}/);
  assert.doesNotMatch(js, /collapsedTags/);
  assert.match(js, /data-toggle-tag-group/);
  assert.doesNotMatch(js, /data-toggle-tag="/);
  assert.match(css, /\.tag-row-list/);
  assert.match(css, /repeat\(auto-fit, minmax\(220px, 1fr\)\)/);
  assert.match(css, /calc\(\(100% - 10px\) \/ 2\)/);
  assert.match(css, /\.tag-row-card:only-child/);
  assert.doesNotMatch(css, /\.tag-row-card\.is-collapsed/);
  assert.doesNotMatch(css, /calc\(\(100% - 40px\) \/ 5\)/);
});

test("tag editor keeps import export save controls at the bottom and collapses after saving", () => {
  assert.match(html, /导入配置/);
  assert.match(html, /导出配置/);
  assert.match(html, /tag-schema-footer/);
  assert.match(js, /collapseAllTagCards/);
  assert.match(js, /collapseAllTagCards\(\);\s*renderTagSchemaEditor\(\);\s*renderFlowSessionDateTagFilter\(\);\s*toast\("标签配置已保存"\)/);
});

test("tag groups do not render collapsed summary descriptions", () => {
  assert.doesNotMatch(js, /tag-group-summary/);
  assert.doesNotMatch(js, /已启用/);
  assert.doesNotMatch(js, /已停用/);
  assert.doesNotMatch(js, /\$\{tagCount\} 个标签/);
  assert.doesNotMatch(css, /\.tag-group-summary/);
});

test("tag group enabled switch sits before the group name while option checkboxes stay regular", () => {
  assert.match(js, /class="toggle switch-toggle tag-group-enabled-toggle"[\s\S]*data-tag-group-field="enabled"[\s\S]*class="tag-name-field"/);
  assert.match(js, /data-tag-group-field="exclusive"/);
  assert.match(js, /data-tag-group-field="oneWay"/);
  assert.doesNotMatch(js, /class="toggle switch-toggle"[\s\S]*data-tag-group-field="exclusive"/);
  assert.doesNotMatch(js, /class="toggle switch-toggle"[\s\S]*data-tag-group-field="oneWay"/);
  assert.match(css, /\.switch-toggle/);
  assert.match(css, /\.switch-toggle input\[type="checkbox"\]/);
  assert.match(css, /\.switch-slider/);
});

test("tag group and tag item labels use the unified tag icon", () => {
  assert.match(js, /icon\("tag"\)\}标签组/);
  assert.match(js, /icon\("tag"\)\}标签/);
  assert.doesNotMatch(js, /icon\("info"\)\}标签组/);
  assert.doesNotMatch(js, /icon\("terminal"\)\}标签/);
  assert.match(js, /icon\("check"\)\}达标条件/);
});

test("tag activation message controls stay on one row beside the text", () => {
  assert.match(css, /\.tag-activation-editor \.activation-message-card\s*\{[\s\S]*grid-template-columns: minmax\(140px, 1fr\) max-content;/);
  assert.match(css, /\.tag-activation-editor \.activation-message-actions\s*\{[\s\S]*flex-wrap: nowrap;/);
  assert.doesNotMatch(css, /\.tag-row-card \.activation-message-card\s*\{[\s\S]*grid-template-columns: 1fr;/);
});
