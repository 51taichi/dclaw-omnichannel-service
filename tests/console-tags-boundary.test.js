import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("console has customer tags workspace tab", () => {
  assert.match(html, /data-workspace-tab="tags"/);
  assert.match(html, /id="tagSchemaPanel"/);
});

test("console loads and saves tag schemas", () => {
  assert.match(js, /loadTagSchema/);
  assert.match(js, /saveTagSchema/);
  assert.match(js, /\/api\/tag-schemas\//);
});

test("console renders tag chips and tag filters", () => {
  assert.match(js, /renderConversationTags/);
  assert.match(js, /flowSessionTagFilter/);
  assert.match(css, /\.tag-chip/);
});

test("tag editor supports collapsible groups and tag cards", () => {
  assert.match(js, /collapsedTagGroups/);
  assert.match(js, /collapsedTags/);
  assert.match(js, /data-toggle-tag-group/);
  assert.match(js, /data-toggle-tag="/);
  assert.match(css, /\.tag-row-list/);
  assert.match(css, /repeat\(auto-fit, minmax\(220px, 1fr\)\)/);
  assert.match(css, /calc\(\(100% - 10px\) \/ 2\)/);
  assert.match(css, /\.tag-row-card:only-child/);
  assert.doesNotMatch(css, /calc\(\(100% - 40px\) \/ 5\)/);
});

test("tag editor keeps import export save controls at the bottom and collapses after saving", () => {
  assert.match(html, /导入配置/);
  assert.match(html, /导出配置/);
  assert.match(html, /tag-schema-footer/);
  assert.match(js, /collapseAllTagCards/);
  assert.match(js, /collapseAllTagCards\(\);\s*renderTagSchemaEditor\(\);\s*toast\("标签配置已保存"\)/);
});
