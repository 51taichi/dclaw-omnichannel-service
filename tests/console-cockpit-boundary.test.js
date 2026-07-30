import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");
const cockpit = fs.readFileSync(new URL("../public/console/cockpit.js", import.meta.url), "utf8");

test("cockpit is the first workspace tab and config is last", () => {
  const names = [...html.matchAll(/data-workspace-tab="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(names, [
    "cockpit",
    "sessions",
    "flow",
    "groups",
    "tags",
    "push",
    "logs",
    "config"
  ]);
});

test("unlocked Bot contexts default to the cockpit", () => {
  const fallbackStart = app.indexOf("function updateWorkspaceTabAccess");
  const fallbackEnd = app.indexOf("\n}\n\nfunction tabForPanel", fallbackStart);
  const fallbackSource = app.slice(fallbackStart, fallbackEnd);
  assert.match(fallbackSource, /switchWorkspaceTab\("cockpit",\s*\{\s*force:\s*true\s*\}\)/);
  assert.doesNotMatch(fallbackSource, /"config"\s*:\s*"sessions"/);
});

test("cockpit exposes an icon, Bot-themed shell, and dedicated client", () => {
  assert.match(html, /<symbol id="icon-cockpit"/);
  assert.match(html, /data-tab-panel="cockpit"/);
  assert.match(html, /id="cockpitLoadingState"/);
  assert.match(html, /id="cockpitContent"/);
  assert.match(html, /src="\.\/cockpit\.js"/);
  assert.match(css, /\.cockpit-shell/);
  assert.match(css, /var\(--bot-accent/);
});

test("cockpit renders fixed cards with icons and responsive hierarchy", () => {
  for (const id of [
    "cockpitPeriodSwitcher",
    "cockpitMetricGrid",
    "cockpitProblems",
    "cockpitActions",
    "cockpitFunnels",
    "cockpitTags",
    "cockpitReportHistory"
  ]) {
    assert.equal(cockpit.includes(id), true, id);
  }
  assert.match(cockpit, /cockpit-card-icon/);
  assert.match(cockpit, /\/api\/cockpit\/\$\{encodeURIComponent\(state\.botId\)\}\/overview/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.cockpit-dashboard/);
  assert.match(css, /\.cockpit-card:focus-within/);
});

test("cockpit top metrics stay universal across sales and service Bots", () => {
  assert.match(cockpit, /\["customerMessages", "客户消息"/);
  assert.match(cockpit, /\["replyMessages", "回复消息"/);
  assert.doesNotMatch(cockpit, /\["successfulInvitations", "成功邀约"/);
  assert.doesNotMatch(cockpit, /\["invitationRate", "邀约转化率"/);
  assert.doesNotMatch(cockpit, /<span>邀约 /);
  assert.match(cockpit, /<span>回复 /);
});

test("cockpit keeps the first screen compact", () => {
  assert.doesNotMatch(cockpit, /id="cockpitAiSummary"/);
  assert.match(css, /\.cockpit-metric-card\s*\{[\s\S]*grid-template-columns:/);
  assert.match(css, /\.cockpit-content\s*\{[\s\S]*overflow-y:\s*auto/);
  const shellStart = css.indexOf(".cockpit-shell {");
  const shellEnd = css.indexOf("\n}", shellStart);
  const shellRule = css.slice(shellStart, shellEnd);
  assert.match(shellRule, /height:\s*100%/);
  assert.doesNotMatch(shellRule, /max-height/);
});

test("cockpit selects an exact date week or month and keeps period controls right aligned", () => {
  assert.match(cockpit, /type="date"/);
  assert.match(cockpit, /type="week"/);
  assert.match(cockpit, /type="month"/);
  assert.match(cockpit, /anchor=\$\{encodeURIComponent\(state\.anchor\)\}/);
  assert.match(cockpit, /defaultAnchorForPeriod/);
  assert.match(css, /\.cockpit-period-controls/);
  assert.match(css, /margin-left:\s*auto/);
  assert.doesNotMatch(cockpit, /完整统计：/);
  assert.doesNotMatch(cockpit, /cockpitFreshnessHelp/);
  assert.match(cockpit, /所选周期尚未生成报告/);
  assert.doesNotMatch(cockpit, /当前展示最近一次统计结果/);
});

test("charts come before problems and actions, with report history last", () => {
  const chart = cockpit.indexOf('class="cockpit-chart-grid"');
  const priority = cockpit.indexOf('class="cockpit-priority-grid"');
  const history = cockpit.indexOf('id="cockpitReportHistory"');
  assert.ok(chart > 0 && priority > chart && history > priority);
});

test("switching Bots clears the old cockpit before loading the new context", () => {
  const start = app.indexOf("async function applyBotContext");
  const end = app.indexOf("\n}\n\nfunction", start);
  const source = app.slice(start, end);
  assert.ok(source.indexOf("clearBotScopedContent()") >= 0);
  assert.ok(source.indexOf("window.cockpitConsole?.setBotContext") > source.indexOf("clearBotScopedContent()"));
});

test("report recipients and schedules live in the final config tab", () => {
  const configStart = html.indexOf('id="configTab"');
  const cockpitConfigStart = html.indexOf('id="cockpitConfigForm"');
  assert.ok(cockpitConfigStart > configStart);
  for (const field of [
    "dailyRecipients",
    "weeklyRecipients",
    "monthlyRecipients",
    "dailyEnabled",
    "weeklyEnabled",
    "monthlyEnabled"
  ]) {
    assert.match(html, new RegExp(`name="${field}"`));
  }
  assert.match(app, /\/api\/cockpit\/\$\{encodeURIComponent\(state\.selectedBotId\)\}\/config/);
});

test("cockpit uses real chart canvases with visible zero-data states", () => {
  assert.match(cockpit, /cockpit-funnel-chart/);
  assert.match(cockpit, /cockpit-tag-group/);
  assert.match(cockpit, /<svg[\s\S]*role="img"/);
  assert.match(cockpit, /cockpit-chart-empty/);
  assert.match(css, /\.cockpit-funnel-chart/);
  assert.match(css, /\.cockpit-tag-group/);
  assert.doesNotMatch(cockpit, /\{ nodeId: "Node 1"/);
  assert.doesNotMatch(cockpit, /\{ tagId: "标签数据"/);
  assert.doesNotMatch(cockpit, /cockpit-tag-total/);
});

test("node distribution totals exactly one hundred percent and hides internal ids", () => {
  assert.match(cockpit, /function distributionPercentages/);
  assert.match(cockpit, /100 - assigned/);
  assert.match(cockpit, /toFixed\(1\)/);
  assert.match(cockpit, /__conversation__/);
  assert.match(cockpit, /其他（未进入任务）/);
});

test("cockpit status messages use the shared top toast instead of an inline warning", () => {
  assert.doesNotMatch(html, /id="cockpitStaleState"/);
  assert.doesNotMatch(cockpit, /current\.stale/);
  assert.match(cockpit, /state\.notify/);
  assert.match(app, /notify:\s*\(message,\s*type\)\s*=>\s*toast\(message,\s*type\)/);
});
