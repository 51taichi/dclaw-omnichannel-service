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

test("proactive panel exposes tag selection and one-time schedule controls", () => {
  const proactivePanel = sectionHtml("proactivePanel");

  assert.match(proactivePanel, /id="targetTagSelect"/);
  assert.match(proactivePanel, /id="proactiveScheduleEnabled"/);
  assert.match(proactivePanel, /id="proactiveScheduledAt"/);
  assert.match(proactivePanel, /type="datetime-local"/);
  assert.match(css, /\.proactive-schedule/);
});

test("existing proactive target bulk controls remain in the same panel", () => {
  const proactivePanel = sectionHtml("proactivePanel");

  assert.match(proactivePanel, /id="selectPrivateTargetsButton"[\s\S]*全选私聊/);
  assert.match(proactivePanel, /id="selectGroupTargetsButton"[\s\S]*全选群组/);
  assert.match(proactivePanel, /id="clearTargetsButton"[\s\S]*清空/);
  assert.match(proactivePanel, /id="targetPagination"/);
});

test("proactive task cancellation style is scoped to proactive rows", () => {
  assert.match(css, /\.proactive-task-cancel/);
});

test("proactive app loads tags and selects matching targets across every page", () => {
  assert.match(app, /loadProactiveTargetTags/);
  assert.match(app, /fetchAllAddressBookTargetsByTag/);
  assert.match(app, /tagFilters/);
  assert.match(app, /\/api\/proactive\/targets\/tags/);
});

test("proactive app submits one-time scheduledAt and can cancel a task", () => {
  assert.match(app, /proactiveScheduleEnabled/);
  assert.match(app, /proactiveScheduledAt/);
  assert.match(app, /scheduledAt/);
  assert.match(app, /data-proactive-task-cancel/);
  assert.match(app, /\/cancel/);
});
