import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

function functionBody(name) {
  const start = js.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} is defined`);
  const signatureEnd = js.indexOf(") {", start);
  const open = signatureEnd + 2;
  let depth = 0;
  for (let index = open; index < js.length; index += 1) {
    if (js[index] === "{") depth += 1;
    if (js[index] === "}") depth -= 1;
    if (depth === 0) return js.slice(open + 1, index);
  }
  assert.fail(`${name} body is closed`);
}

test("console has customer tags workspace tab", () => {
  assert.match(html, /data-workspace-tab="tags"/);
  assert.match(html, /data-workspace-tab="tags"[\s\S]*href="#icon-tag"[\s\S]*标签/);
  assert.match(html, /id="tagSchemaPanel"/);
  assert.doesNotMatch(html, /<h2 class="module-title">[\s\S]*客户标签[\s\S]*<\/h2>/);
  assert.doesNotMatch(html, /启用客户添加日期标签/);
});

test("console loads and saves tag schemas", () => {
  assert.match(js, /loadTagSchema/);
  assert.match(js, /saveTagSchema/);
  assert.match(js, /\/api\/tag-schemas\//);
  assert.match(js, /state\.tagSchema = normalizeTagSchemaDraft\(data\.schema \|\| defaultTagSchema\(\)\);[\s\S]*collapseAllTagCards\(\);[\s\S]*renderTagSchemaEditor\(\)/);
});

test("date tags render as the fixed first special group with a cutoff time", () => {
  const specialGroup = functionBody("renderDateTagSpecialGroup");
  const editor = functionBody("renderTagSchemaEditor");

  assert.match(specialGroup, /class="tag-group-card date-tag-special-group"/);
  assert.match(specialGroup, /id="dateTagEnabled" type="checkbox"/);
  assert.match(specialGroup, /添加日期/);
  assert.match(specialGroup, /id="dateTagCutoffTime" type="time" step="60"/);
  assert.match(specialGroup, /日切时间/);
  assert.doesNotMatch(specialGroup, /切日时间/);
  assert.doesNotMatch(specialGroup, /data-add-tag/);
  assert.doesNotMatch(specialGroup, /data-remove-tag-group/);
  assert.doesNotMatch(specialGroup, /data-toggle-tag-group/);
  assert.doesNotMatch(specialGroup, /data-tag-group-field="exclusive"/);
  assert.doesNotMatch(specialGroup, /data-tag-group-field="oneWay"/);
  assert.match(editor, /renderDateTagSpecialGroup\(\)[\s\S]*renderNormalTagGroups/);
  assert.doesNotMatch(html, /id="dateTagEnabled"/);
  assert.match(css, /\.date-tag-special-group/);
});

test("date tag cutoff aligns beside the group name and explains the business-day boundary", () => {
  const specialGroup = functionBody("renderDateTagSpecialGroup");

  assert.match(specialGroup, /class="activation-help-icon date-tag-help"/);
  assert.match(specialGroup, /aria-label="日切时间说明"/);
  assert.match(specialGroup, /icon\("info"\)/);
  assert.match(specialGroup, /设置为 20:00/);
  assert.match(specialGroup, /19:59/);
  assert.match(specialGroup, /20:00 起/);
  assert.match(specialGroup, /设置为 00:00 时按自然日/);
  assert.match(
    css,
    /\.date-tag-special-group \.tag-group-head\s*\{[^}]*grid-template-columns:\s*max-content minmax\(240px,\s*1fr\) 300px 34px;/
  );
  assert.match(css, /\.date-tag-help\s*\{[^}]*justify-self:\s*end/);
});

test("date tag special group follows the selected Bot accent color", () => {
  assert.match(css, /\.date-tag-special-group\s*\{[^}]*--date-tag-accent:\s*var\(--bot-accent,\s*var\(--accent\)\)[^}]*border-color:\s*color-mix\(in srgb,\s*var\(--date-tag-accent\) 48%,\s*var\(--line\)\)[^}]*background:\s*color-mix\(in srgb,\s*var\(--date-tag-accent\) 7%,\s*#ffffff\)/);
  assert.match(css, /\.date-tag-special-group \.field-label\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--date-tag-accent\) 8%,\s*#ffffff\)/);
  assert.match(css, /\.date-tag-special-group \.field-label \.icon\s*\{[^}]*color:\s*var\(--date-tag-accent\)/);
  assert.match(css, /\.date-tag-special-group \.switch-toggle input\[type="checkbox"\]:checked \+ \.switch-slider\s*\{[^}]*background:\s*var\(--date-tag-accent\)/);
  assert.match(css, /\.date-tag-special-group \.date-tag-help\s*\{[^}]*border-color:\s*color-mix\(in srgb,\s*var\(--date-tag-accent\) 36%,\s*var\(--line\)\)[^}]*color:\s*var\(--date-tag-accent\)/);
});

test("date tag drafts normalize and export only editable rule fields", () => {
  assert.match(js, /dateTag:\s*\{\s*enabled: false,\s*cutoffTime: "00:00",\s*effectiveAt: ""\s*\}/);
  assert.match(js, /function normalizeDateTagCutoffTimeDraft/);
  assert.match(js, /cutoffTime: normalizeDateTagCutoffTimeDraft\(source\.dateTag\?\.cutoffTime\)/);
  assert.match(js, /effectiveAt: normalizeDateTagEffectiveAtDraft\(source\.dateTag\?\.effectiveAt\)/);
  assert.match(
    functionBody("editableDateTagRule"),
    /enabled: Boolean\(dateTagEnabledInput\(\)\?\.checked\)[\s\S]*cutoffTime: normalizeDateTagCutoffTimeDraft\(dateTagCutoffInput\(\)\?\.value\)/
  );
  assert.doesNotMatch(functionBody("editableDateTagRule"), /effectiveAt/);
  assert.match(functionBody("exportTagSchema"), /dateTag: editableDateTagRule\(\)/);
});

test("console renders tag chips and tag filters", () => {
  assert.match(js, /renderConversationTags/);
  assert.match(js, /function renderConversationDateTag\(tags = \[\]\)/);
  assert.match(js, /\.find\(\(tag\) => tag\?\.tagType === "date"\)/);
  assert.match(js, /if \(!dateTag\) return ""/);
  assert.match(js, /includeDate \|\| tag\?\.tagType !== "date"/);
  assert.match(js, /function sortConversationTagsForDisplay\(tags = \[\]\)/);
  assert.match(js, /const aDate = a\?\.tagType === "date" \? 0 : 1/);
  assert.match(js, /const visibleTags = sortConversationTagsForDisplay/);
  assert.match(html, /id="icon-tag"/);
  assert.match(js, /icon\("tag"\)/);
  assert.match(js, /flowSessionTagFilter/);
  assert.match(
    html,
    /<label class="flow-session-tag-filter tag-multi-select">[\s\S]*href="#icon-tag"[\s\S]*按标签选择[\s\S]*id="flowSessionTagFilterButton"[\s\S]*选择标签/
  );
  assert.match(html, /id="flowSessionTagFilterMenu" class="tag-multi-select-menu"[\s\S]*role="listbox"/);
  assert.match(html, /id="flowSessionTagFilter" multiple hidden/);
  assert.match(js, /function selectedFlowSessionTagFilterValues\(\)/);
  assert.match(js, /const tagFilters = new Set\(selectedFlowSessionTagFilterValues\(\)\)/);
  assert.match(js, /tagFilters\.size && !\(session\.tags \|\| \[\]\)\.some\(\(tag\) => tagFilters\.has\(tagFilterKey\(tag\)\)\)/);
  assert.match(js, /function positionTagMultiSelectMenu\(button, menu\)/);
  assert.match(js, /getBoundingClientRect\(\)/);
  assert.match(js, /function toggleTagMultiSelectMenu\(button, menu\)/);
  assert.match(js, /if \(willOpen\) positionTagMultiSelectMenu\(button, menu\)/);
  assert.match(js, /function renderTagMultiSelectControl\(\{[\s\S]*select,[\s\S]*button,[\s\S]*menu/);
  assert.match(js, /renderTagMultiSelectControl\(\{[\s\S]*flowSessionTagFilter/);
  assert.doesNotMatch(js, /function positionProactiveTagSelectMenu\(\)/);
  assert.doesNotMatch(js, /function positionFlowSessionTagFilterMenu\(\)/);
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
  assert.match(js, /els\.flowSessionDateTagFilter\.disabled = !dateTagEnabled/);
  assert.match(js, /els\.flowSessionDateTagFilter\.value = nativeDateValueFromCompactDate\(compactValue\)/);
  assert.doesNotMatch(js, /openFlowSessionDatePicker/);
  assert.match(js, /for \(const group of enabledManualTagGroups\(\)\)/);
  assert.match(js, /const key = `\$\{group\.id\}:\$\{tag\.id\}`/);
  assert.match(js, /label: tag\.name/);
  assert.match(js, /groupLabel: group\.name \|\| "未分组标签"/);
  assert.match(js, /emptyLabel: "选择标签"/);
  assert.match(
    css,
    /\.flow-session-filters\s*\{[^}]*grid-template-columns:\s*minmax\(260px,\s*1fr\) minmax\(208px,\s*220px\) minmax\(132px,\s*170px\) minmax\(208px,\s*220px\)/
  );
  assert.match(css, /\.flow-session-filters \.flow-session-date-filter\s*\{[\s\S]*minmax\(122px,\s*1fr\)/);
  assert.match(css, /\.tag-chip/);
  assert.match(css, /\.tag-chip \.icon\s*\{[\s\S]*width:\s*12px[\s\S]*height:\s*12px/);
});

test("multi-tag menus expose a persistent vertical scrollbar", () => {
  const menuRule = css.match(/\.tag-multi-select-menu\s*\{[^}]*\}/)?.[0] || "";
  assert.match(
    css,
    /\.tag-multi-select-menu\s*\{[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*scroll[^}]*scrollbar-gutter:\s*stable/
  );
  assert.doesNotMatch(menuRule, /scrollbar-(?:width|color)/);
  assert.match(css, /\.tag-multi-select-menu::-webkit-scrollbar\s*\{[^}]*width:\s*8px/);
  assert.match(css, /\.tag-multi-select-menu::-webkit-scrollbar-thumb\s*\{[^}]*background:/);
  assert.match(
    js,
    /function closeTagMultiSelectMenusOnExternalScroll\(event\)\s*\{[\s\S]*event\.target instanceof Element[\s\S]*closest\("\.tag-multi-select-menu"\)[\s\S]*return/
  );
  assert.match(
    js,
    /window\.addEventListener\("scroll", closeTagMultiSelectMenusOnExternalScroll, true\)/
  );
});

test("opening a conversation refreshes its card after detail tags arrive", () => {
  const body = functionBody("openFlowSession");

  assert.match(
    body,
    /currentFlowSessions = currentFlowSessions\.map\([\s\S]*\);\s*renderFlowSessions\(\);\s*if \(els\.chatTagList\)/
  );
});

test("conversation cards expose click and right-click entry points for one manual tag menu", () => {
  assert.match(html, /id="flowSessionTagMenu" class="flow-session-tag-menu"/);
  assert.match(js, /flowSessionTagMenu: document\.querySelector\("#flowSessionTagMenu"\)/);
  assert.match(js, /function renderFlowSessionManualTagMenu\(\{ session, x, y \}\)/);
  assert.match(js, /const sessionName = flowSessionDisplayName\(session\)/);
  assert.match(js, /<strong>给\$\{escapeHtml\(sessionName\)\}打上标签：<\/strong>/);
  assert.match(js, /button\.addEventListener\("contextmenu"/);
  assert.match(js, /class="flow-session-manual-tag-trigger"[^>]*data-flow-manual-tag-trigger=/);
  assert.match(js, /title="手工打标签"/);
  assert.match(js, /querySelectorAll\("\[data-flow-manual-tag-trigger\]"\)/);
  assert.match(js, /renderFlowSessionManualTagMenu\(\{[\s\S]*session,[\s\S]*x: rect\.left,[\s\S]*y: rect\.bottom \+ 6/);
  assert.match(js, /function enabledManualTagGroups\(\)/);
  assert.match(js, /group\.enabled !== false[\s\S]*tag\.enabled !== false/);
  assert.match(js, /function applyManualConversationTag\(\{ conversationKey, groupId, tagId, action \}\)/);
  assert.match(js, /\/api\/flow-sessions\/\$\{encodeURIComponent\(conversationKey\)\}\/tags\/manual/);
  assert.match(js, /hideFlowSessionManualTagMenu/);
  assert.match(css, /\.flow-session-tag-menu\s*\{[\s\S]*position:\s*fixed/);
  assert.match(css, /\.flow-session-manual-tag-trigger\s*\{[\s\S]*grid-column:\s*1[\s\S]*grid-row:\s*2/);
  assert.match(css, /\.flow-session-tag-zone\s*\{[\s\S]*grid-column:\s*2 \/ 4/);
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

test("tag conditions reuse the fixed-slot expanding textarea", () => {
  assert.match(js, /<div class="expand-field-slot" data-tag-expand-field="condition">/);
  assert.match(js, /<textarea class="expand-on-focus" data-tag-field="condition"/);
  assert.match(css, /\.expand-field-slot > label\s*\{[\s\S]*position:\s*absolute/);
  assert.match(css, /\.expand-field-slot > label\s*\{[\s\S]*transition:[\s\S]*height 220ms/);
  assert.match(css, /\.expand-on-focus\s*\{[\s\S]*transition:[\s\S]*height 220ms[\s\S]*max-height 220ms/);
  assert.match(css, /\.expand-field-slot > label:focus-within\s*\{[\s\S]*height:\s*112px/);
});

test("normal tags preserve and render a voice alert switch after the condition", () => {
  const normalize = functionBody("normalizeTagSchemaDraft");
  const normalGroups = functionBody("renderNormalTagGroups");
  const specialGroup = functionBody("renderDateTagSpecialGroup");
  const updateTag = functionBody("updateTagDraft");

  assert.match(normalize, /voiceAlertEnabled:\s*Boolean\(tag\.voiceAlertEnabled\)/);
  assert.match(normalGroups, /class="tag-condition-row"[\s\S]*data-tag-field="condition"[\s\S]*data-tag-field="voiceAlertEnabled"/);
  assert.match(normalGroups, /class="toggle switch-toggle tag-voice-alert-toggle"/);
  assert.match(normalGroups, /语音提示/);
  assert.match(updateTag, /input\.dataset\.tagField === "voiceAlertEnabled"/);
  assert.match(updateTag, /tag\.voiceAlertEnabled = input\.checked/);
  assert.doesNotMatch(specialGroup, /voiceAlertEnabled|语音提示/);
  assert.match(css, /\.tag-condition-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) max-content/);
  assert.match(css, /\.tag-voice-alert-toggle\s*\{[^}]*min-height:\s*40px/);
});

test("tag activation message controls stay on one row beside the text", () => {
  assert.match(css, /\.tag-activation-editor \.activation-message-card\s*\{[\s\S]*grid-template-columns: minmax\(140px, 1fr\) max-content;/);
  assert.match(css, /\.tag-activation-editor \.activation-message-actions\s*\{[\s\S]*flex-wrap: nowrap;/);
  assert.doesNotMatch(css, /\.tag-row-card \.activation-message-card\s*\{[\s\S]*grid-template-columns: 1fr;/);
});
