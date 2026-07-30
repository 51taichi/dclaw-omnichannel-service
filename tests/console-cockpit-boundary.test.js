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
    "cockpitFreshness",
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

test("cockpit keeps the first screen compact and explains report timing with a help tip", () => {
  assert.doesNotMatch(cockpit, /id="cockpitAiSummary"/);
  assert.match(cockpit, /id="cockpitFreshnessHelp"/);
  assert.match(cockpit, /完整报告将在凌晨统计后生成/);
  assert.match(css, /\.cockpit-metric-card\s*\{[\s\S]*grid-template-columns:/);
  assert.match(css, /\.cockpit-content\s*\{[\s\S]*overflow-y:\s*auto/);
  const shellStart = css.indexOf(".cockpit-shell {");
  const shellEnd = css.indexOf("\n}", shellStart);
  const shellRule = css.slice(shellStart, shellEnd);
  assert.match(shellRule, /height:\s*100%/);
  assert.doesNotMatch(shellRule, /max-height/);
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
  assert.match(cockpit, /cockpit-tag-donut/);
  assert.match(cockpit, /<svg[\s\S]*role="img"/);
  assert.match(cockpit, /cockpit-chart-empty/);
  assert.match(css, /\.cockpit-funnel-chart/);
  assert.match(css, /\.cockpit-tag-donut/);
  assert.doesNotMatch(cockpit, /\{ nodeId: "Node 1"/);
  assert.doesNotMatch(cockpit, /\{ tagId: "标签数据"/);
});

test("cockpit status messages use the shared top toast instead of an inline warning", () => {
  assert.doesNotMatch(html, /id="cockpitStaleState"/);
  assert.doesNotMatch(cockpit, /current\.stale/);
  assert.match(cockpit, /state\.notify/);
  assert.match(app, /notify:\s*\(message,\s*type\)\s*=>\s*toast\(message,\s*type\)/);
});
