import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(
  new URL("../public/console/group-detail-tabs.js", import.meta.url),
  "utf8"
);
const context = {};
vm.runInNewContext(source, context);
const { normalizeGroupDetailTab, nextGroupDetailTab } = context.GroupDetailTabs;

test("group detail tabs normalize unknown values to the base config tab", () => {
  assert.equal(normalizeGroupDetailTab("config"), "config");
  assert.equal(normalizeGroupDetailTab("tasks"), "tasks");
  assert.equal(normalizeGroupDetailTab("unknown"), "config");
  assert.equal(normalizeGroupDetailTab(), "config");
});

test("group detail tabs support standard roving-tab keyboard navigation", () => {
  assert.equal(nextGroupDetailTab("config", "ArrowRight"), "tasks");
  assert.equal(nextGroupDetailTab("tasks", "ArrowRight"), "config");
  assert.equal(nextGroupDetailTab("config", "ArrowLeft"), "tasks");
  assert.equal(nextGroupDetailTab("tasks", "ArrowDown"), "config");
  assert.equal(nextGroupDetailTab("config", "ArrowUp"), "tasks");
  assert.equal(nextGroupDetailTab("tasks", "Home"), "config");
  assert.equal(nextGroupDetailTab("config", "End"), "tasks");
  assert.equal(nextGroupDetailTab("config", "Tab"), null);
});
