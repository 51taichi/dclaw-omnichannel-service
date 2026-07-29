import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

function sectionHtml(id) {
  const start = html.indexOf(`<section id="${id}"`);
  assert.notEqual(start, -1);
  const nextSection = html.indexOf("<section", start + 1);
  return html.slice(start, nextSection === -1 ? html.length : nextSection);
}

test("proactive panel exposes separate add-date, multi-tag, and one-time schedule controls", () => {
  const proactivePanel = sectionHtml("proactivePanel");

  assert.match(proactivePanel, /id="targetTagSelect"/);
  assert.match(proactivePanel, /id="targetTagSelectButton"/);
  assert.match(proactivePanel, /id="targetTagSelectMenu"/);
  assert.match(proactivePanel, /id="targetDateTagSelect"/);
  assert.match(proactivePanel, /id="proactiveScheduleEnabled"/);
  assert.match(proactivePanel, /class="toggle switch-toggle proactive-schedule proactive-schedule-toggle"/);
  assert.match(proactivePanel, /class="switch-slider"/);
  assert.match(proactivePanel, /id="proactiveScheduledAt"/);
  assert.match(proactivePanel, /type="datetime-local"/);
  assert.match(proactivePanel, /id="proactiveScheduledAtField"[\s\S]*>推送时间<\/span>/);
  assert.match(proactivePanel, /按添加日期选择/);
  assert.match(proactivePanel, /id="targetDateTagSelect"/);
  assert.match(css, /\.proactive-schedule/);
  assert.match(css, /#proactiveContent\s*\{[^}]*height:\s*80px;[^}]*min-height:\s*80px;/);
});

test("proactive schedule control sits left of the task name as one component", () => {
  const proactivePanel = sectionHtml("proactivePanel");
  const head = proactivePanel.slice(
    proactivePanel.indexOf('<div class="target-picker-head">'),
    proactivePanel.indexOf('<div class="target-toolbar">')
  );
  assert.match(head, /class="proactive-schedule-control"[\s\S]*id="proactiveScheduleEnabled"[\s\S]*id="proactiveScheduledAt"[\s\S]*class="proactive-title-field"/);
  const bulkActions = proactivePanel.slice(proactivePanel.indexOf('<div class="bulk-actions">'));
  assert.doesNotMatch(bulkActions, /id="proactiveScheduleEnabled"|id="proactiveScheduledAt"/);
});

test("proactive labels use icons without duplicating the schedule switch icon", () => {
  const proactivePanel = sectionHtml("proactivePanel");
  const scheduleControl = proactivePanel.slice(
    proactivePanel.indexOf('<div class="proactive-schedule-control">'),
    proactivePanel.indexOf('<label class="proactive-title-field">')
  );
  assert.match(scheduleControl, /<span class="switch-label">定时推送<\/span>/);
  assert.match(proactivePanel, /class="proactive-title-field"[\s\S]*href="#icon-edit"/);
  assert.match(proactivePanel, /id="proactiveScheduledAtField"[\s\S]*href="#icon-clock"/);
  assert.match(css, /\.target-selection-row \.target-pagination\s*\{[\s\S]*margin-left:\s*auto/);
  assert.match(css, /\.proactive-schedule-control\s*\{[^}]*align-items:\s*center;[^}]*align-self:\s*center;/);
});

test("proactive schedule toggle centers its content with symmetric vertical padding", () => {
  assert.match(
    css,
    /\.proactive-schedule-control \.proactive-schedule\s*\{[^}]*padding-block:\s*0;/
  );
});

test("existing proactive target bulk controls remain in the same panel", () => {
  const proactivePanel = sectionHtml("proactivePanel");

  assert.match(proactivePanel, /class="target-search-actions"[\s\S]*id="selectPrivateTargetsButton"[\s\S]*全选私聊/);
  assert.match(proactivePanel, /class="target-search-actions"[\s\S]*id="selectGroupTargetsButton"[\s\S]*全选群组/);
  assert.match(proactivePanel, /class="target-search-actions"[\s\S]*id="clearTargetsButton"[\s\S]*清空/);
  assert.match(proactivePanel, /id="targetPagination"/);
  const bulkActions = proactivePanel.slice(proactivePanel.indexOf('<div class="bulk-actions">'));
  assert.match(bulkActions, /id="targetDateTagSelect"[\s\S]*id="targetTagSelectButton"/);
  assert.match(proactivePanel, /class="target-selection-row"[\s\S]*id="selectedTargetsSummary"[\s\S]*id="targetPagination" class="pagination-bar target-pagination"[\s\S]*<div id="proactiveMessageFields"/);
  assert.doesNotMatch(bulkActions, /id="proactiveScheduleEnabled"|id="proactiveScheduledAt"/);
});

test("proactive task cancellation style is scoped to proactive rows", () => {
  assert.match(css, /\.proactive-task-cancel/);
});

test("empty proactive task state spans the full table as one compact row", () => {
  assert.match(
    app,
    /<tr class="proactive-task-empty-row"><td class="proactive-task-empty" colspan="6">暂无当前 Bot 的主动推送任务<\/td><\/tr>/
  );
  assert.match(
    css,
    /\.proactive-task-empty\s*\{[^}]*display:\s*table-cell;[^}]*height:\s*64px;[^}]*text-align:\s*center;[^}]*vertical-align:\s*middle;/
  );
});

test("proactive app loads tags and selects matching targets across every page", () => {
  assert.match(app, /loadProactiveTargetTags/);
  assert.match(app, /fetchAllAddressBookTargetsByTag/);
  assert.match(app, /tagFilters/);
  assert.match(app, /\/api\/proactive\/targets\/tags/);
  assert.match(app, /tag\.tagType !== "date"/);
  assert.match(app, /dedupeProactiveTargetTags/);
  assert.match(app, /targetDateTagSelect/);
  assert.match(app, /targetTagSelectMenu/);
  assert.match(app, /intersectTargetMaps/);
  assert.match(app, /reconcileProactiveTargetSelections/);
});

test("proactive app submits one-time scheduledAt and can cancel a task", () => {
  assert.match(app, /proactiveScheduleEnabled/);
  assert.match(app, /proactiveScheduledAt/);
  assert.match(app, /scheduledAt/);
  assert.match(app, /data-proactive-task-cancel/);
  assert.match(app, /\/cancel/);
});
