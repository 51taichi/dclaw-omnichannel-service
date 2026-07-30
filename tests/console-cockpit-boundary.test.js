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
  assert.match(html, /<symbol id="icon-message"/);
  assert.match(cockpit, /\["customerMessages", "客户消息"/);
  assert.match(cockpit, /\["replyMessages", "回复消息"/);
  assert.doesNotMatch(cockpit, /\["successfulInvitations", "成功邀约"/);
  assert.doesNotMatch(cockpit, /\["invitationRate", "邀约转化率"/);
  assert.doesNotMatch(cockpit, /<span>邀约 /);
  assert.match(cockpit, /<span>回复 /);
});

test("effective conversations replace customer messages beside the outcome chart", () => {
  const definitionsStart = cockpit.indexOf("const metricDefinitions");
  const definitionsEnd = cockpit.indexOf("\n  ];", definitionsStart);
  const definitions = cockpit.slice(definitionsStart, definitionsEnd);
  const newCustomers = definitions.indexOf('["newCustomers", "新增客户"');
  const effective = definitions.indexOf('["effectiveConversations", "有效沟通"');
  const replies = definitions.indexOf('["replyMessages", "回复消息"');
  const customerMessages = definitions.indexOf('["customerMessages", "客户消息"');
  assert.ok(newCustomers < effective && effective < replies && replies < customerMessages);
  assert.match(cockpit, /\$\{index === 1 \? outcomeDonut/);
});

test("desktop metric labels remain fully visible", () => {
  assert.match(css, /\.cockpit-metric-card[\s\S]*grid-template-columns:\s*minmax\(5em,\s*1fr\) 58px/);
  assert.match(css, /\.cockpit-metric-label > span[\s\S]*flex:\s*0 0 auto/);
  const labelStart = css.indexOf(".cockpit-metric-label > span");
  const labelEnd = css.indexOf("\n}", labelStart);
  assert.doesNotMatch(css.slice(labelStart, labelEnd), /text-overflow:\s*ellipsis|overflow:\s*hidden/);
});

test("cockpit centers an exhaustive new-customer outcome donut in the metric grid", () => {
  assert.match(cockpit, /function outcomeDonut/);
  assert.match(cockpit, /cockpit-outcome-card/);
  assert.match(cockpit, /从未回复/);
  assert.match(cockpit, /中途未回复/);
  assert.match(cockpit, /有效沟通/);
  assert.match(cockpit, /新增客户/);
  assert.match(css, /\.cockpit-outcome-card[\s\S]*grid-row:\s*span 2/);
  assert.match(css, /\.cockpit-outcome-segment/);
});

test("outcome labels stay inside the donut card and tag names align beside bars", () => {
  assert.match(css, /\.cockpit-outcome-segment[\s\S]*transform:\s*rotate\(-90deg\)/);
  assert.doesNotMatch(css, /\.cockpit-outcome-donut svg[\s\S]{0,120}transform:\s*rotate\(-90deg\)/);
  assert.match(css, /\.cockpit-outcome-legend > div[\s\S]*grid-template-columns:\s*8px minmax\(4em,\s*1fr\) 5ch/);
  assert.match(css, /\.cockpit-tag-row > span[\s\S]*text-align:\s*right/);
});

test("outcome legend shows only percentages and reveals counts in hover tips", () => {
  const outcomeStart = cockpit.indexOf("function outcomeDonut");
  const outcomeEnd = cockpit.indexOf("\n  function funnelChart", outcomeStart);
  const outcomeSource = cockpit.slice(outcomeStart, outcomeEnd);
  assert.doesNotMatch(outcomeSource, /<strong/);
  assert.match(outcomeSource, /data-tooltip=/);
  assert.match(outcomeSource, /人 · /);
  assert.match(outcomeSource, /<title>\$\{tooltip\}/);
  assert.match(css, /\.cockpit-outcome-legend > div:hover::after/);
});

test("task node chart shows only percentages and keeps counts in row tips", () => {
  const funnelStart = cockpit.indexOf("function funnelChart");
  const funnelEnd = cockpit.indexOf("\n  function tagChart", funnelStart);
  const funnelSource = cockpit.slice(funnelStart, funnelEnd);
  assert.match(funnelSource, /class="cockpit-funnel-row"/);
  assert.match(funnelSource, /<title>\$\{escapeHtml\(tooltip\)\}<\/title>/);
  assert.match(funnelSource, /人数：\$\{Number\(node\.reached/);
  assert.match(funnelSource, />\$\{percentages\[index\]\.toFixed\(1\)\}%<\/text>/);
  assert.doesNotMatch(funnelSource, /formatDashboardNumber\(node\.reached\).*·/);
  assert.match(css, /\.cockpit-funnel-row[\s\S]*cursor:\s*help/);
});

test("large metric values use stable compact slots without changing the layout", () => {
  assert.match(cockpit, /function formatDashboardNumber/);
  assert.match(cockpit, /1000/);
  assert.match(cockpit, /千/);
  assert.match(cockpit, /10000/);
  assert.match(cockpit, /万/);
  assert.match(cockpit, /100000000/);
  assert.match(cockpit, /亿/);
  assert.match(cockpit, /title="\$\{fullNumber/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
  assert.match(css, /\.cockpit-metric-card strong[\s\S]*inline-size:\s*100%/);
  assert.match(css, /\.cockpit-metric-card strong[\s\S]*min-inline-size:\s*0/);
  assert.match(css, /\.cockpit-metric-card strong[\s\S]*white-space:\s*nowrap/);
  assert.match(css, /\.cockpit-tag-row[\s\S]*grid-template-columns:[^;]*40px 48px/);
});

test("all dashboard value columns reserve enough space for 999", () => {
  assert.match(css, /\.cockpit-metric-card[\s\S]*grid-template-columns:\s*minmax\(5em,\s*1fr\) 58px/);
  assert.match(css, /\.cockpit-outcome-legend > div[\s\S]*grid-template-columns:\s*8px minmax\(4em,\s*1fr\) 5ch/);
  assert.match(css, /\.cockpit-outcome-legend small[\s\S]*min-width:\s*5ch/);
  assert.match(css, /\.cockpit-tag-row[\s\S]*grid-template-columns:[^;]*40px 48px/);
  assert.match(cockpit, /text-anchor="end"/);
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

test("charts and recommendations use independent columns with report history last", () => {
  const insight = cockpit.indexOf('class="cockpit-insight-grid"');
  const task = cockpit.indexOf('id="cockpitFunnels"');
  const problem = cockpit.indexOf('id="cockpitProblems"');
  const tags = cockpit.indexOf('id="cockpitTags"');
  const action = cockpit.indexOf('id="cockpitActions"');
  const history = cockpit.indexOf('id="cockpitReportHistory"');
  assert.ok(insight > 0 && task > insight && problem > task);
  assert.ok(tags > problem && action > tags && history > action);
  assert.doesNotMatch(cockpit, /cockpit-chart-grid|cockpit-priority-grid/);
});

test("cockpit charts omit redundant explanatory captions", () => {
  assert.doesNotMatch(cockpit, /当前停留人数与全部任务会话占比/);
  assert.doesNotMatch(cockpit, /按标签配置顺序展示当前人数及本周期净变化/);
  assert.doesNotMatch(cockpit, /cockpit-chart-caption/);
});

test("cockpit chart panels use natural content height above aligned actions", () => {
  assert.doesNotMatch(cockpit, /function chartPanelHeight/);
  assert.doesNotMatch(cockpit, /--cockpit-chart-height/);
  assert.match(css, /\.cockpit-insight-grid[\s\S]*align-items:\s*start/);
  assert.match(css, /\.cockpit-insight-column[\s\S]*align-content:\s*start/);
  assert.match(css, /\.cockpit-funnel-chart,[\s\S]*\.cockpit-tag-groups[\s\S]*height:\s*auto/);
});

test("cockpit widens the outcome card and places tag group names vertically", () => {
  assert.match(css, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s*minmax\(280px,\s*1\.2fr\)/);
  assert.match(css, /\.cockpit-tag-group[\s\S]*grid-template-columns:\s*42px minmax\(0,\s*1fr\)/);
  assert.match(css, /\.cockpit-tag-group-name[\s\S]*writing-mode:\s*vertical-rl/);
  assert.match(css, /\.cockpit-tag-group-name[\s\S]*text-orientation:\s*upright/);
});

test("tag chart uses grouped comparison bands and local scales", () => {
  assert.match(cockpit, /const groupMaximum/);
  assert.match(cockpit, /current \/ groupMaximum/);
  assert.match(cockpit, /cockpit-tag-change/);
  assert.match(css, /\.cockpit-tag-group[\s\S]*background:/);
  assert.match(css, /\.cockpit-tag-group-name[\s\S]*border-radius:/);
  assert.match(css, /\.cockpit-tag-change\.positive/);
  assert.match(css, /\.cockpit-tag-change\.negative/);
  assert.match(css, /\.cockpit-metric-label[\s\S]*white-space:\s*nowrap/);
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
