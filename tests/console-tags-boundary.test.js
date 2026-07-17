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
  assert.match(html, /id="icon-tag"/);
  assert.match(js, /icon\("tag"\)/);
  assert.match(js, /flowSessionTagFilter/);
  assert.match(html, /id="flowSessionDateTagFilter"/);
  assert.match(html, /添加日期/);
  assert.match(js, /function renderFlowSessionDateTagFilter\(\)/);
  assert.match(js, /tag\.tagType === "date" && tagFilterKey\(tag\) === dateTagFilter/);
  assert.match(js, /if \(tag\.tagType === "date"\) continue/);
  assert.match(js, /els\.flowSessionDateTagFilter\.disabled = !dateTagEnabled/);
  assert.match(css, /\.tag-chip/);
  assert.match(css, /\.tag-chip \.icon\s*\{[\s\S]*width:\s*12px[\s\S]*height:\s*12px/);
});

test("tag editor supports collapsible groups with always-expanded tag cards", () => {
  assert.match(js, /collapsedTagGroups/);
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

test("tag item name and condition icons are swapped for clearer editing", () => {
  assert.match(js, /icon\("terminal"\)\}标签/);
  assert.match(js, /icon\("check"\)\}达标条件/);
});

test("tag activation message controls stay on one row beside the text", () => {
  assert.match(css, /\.tag-activation-editor \.activation-message-card\s*\{[\s\S]*grid-template-columns: minmax\(140px, 1fr\) max-content;/);
  assert.match(css, /\.tag-activation-editor \.activation-message-actions\s*\{[\s\S]*flex-wrap: nowrap;/);
  assert.doesNotMatch(css, /\.tag-row-card \.activation-message-card\s*\{[\s\S]*grid-template-columns: 1fr;/);
});
