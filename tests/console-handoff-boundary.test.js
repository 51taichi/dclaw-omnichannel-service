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

test("console exposes handoff toggles on session cards without the old status banner", () => {
  assert.equal(html.includes('id="handoffStatusBanner"'), false);
  assert.equal(app.includes("toggleSelectedConversationHandoff"), true);
  assert.equal(app.includes("data-flow-handoff"), true);
  assert.equal(app.includes("/handoff"), true);
  assert.equal(app.includes("handoffStatus"), true);
});

test("flow session cards use compact icon metadata for task, assets, time, and handoff", () => {
  assert.equal(app.includes("flow-session-icons"), true);
  assert.equal(app.includes("当前任务：${status}"), true);
  assert.equal(app.includes("资产：${assetSummary}"), true);
  assert.equal(app.includes("最近消息：${lastMessageAt}"), true);
  assert.equal(app.includes("data-tooltip="), true);
  assert.equal(app.includes("aria-label="), true);
  assert.equal(app.includes("AI接待中"), true);
  assert.equal(app.includes("flow-session-status"), true);
  assert.equal(css.includes(".flow-session-icons"), true);
  assert.equal(css.includes(".session-icon::after"), true);
  assert.equal(css.includes(".handoff-button"), true);
});

test("flow sessions can be filtered and human handoff sessions are pinned first", () => {
  assert.equal(html.includes('id="flowSessionDateFrom"'), false);
  assert.equal(html.includes('id="flowSessionDateTo"'), false);
  assert.equal(html.includes('id="flowSessionSearchInput"'), true);
  assert.equal(app.includes("flowSessionSearchInput"), true);
  assert.equal(app.includes("normalizedSessionSearch"), true);
  assert.equal(html.includes('id="flowSessionAssetFilter"'), true);
  assert.equal(html.includes('id="flowSessionNodeFilter"'), true);
  assert.equal(html.includes('id="flowSessionHandoffFilter"'), false);
  assert.equal(html.includes("接手状态"), false);
  assert.equal(app.includes("getVisibleFlowSessions"), true);
  assert.equal(app.includes("sortFlowSessions"), true);
  assert.equal(app.includes('handoffStatus === "human"'), true);
  assert.equal(css.includes(".flow-session-filters"), true);
  assert.doesNotMatch(css, /\.flow-session-filters\s*\{[^}]*border-bottom:/);
  assert.equal(css.includes(".handoff-status-banner"), false);
});

test("human handoff session cards have a clear pulsing highlight", () => {
  assert.equal(css.includes("@keyframes handoffPulse"), true);
  assert.equal(css.includes("animation: handoffPulse"), true);
  assert.equal(css.includes("@media (prefers-reduced-motion: reduce)"), true);
  assert.equal(css.includes(".flow-session-card.is-handoff .flow-session-status"), true);
});

test("conversation assets open as a popover without affecting chat layout", () => {
  assert.match(css, /\.chat-view\s*\{[\s\S]*position:\s*relative/);
  assert.match(css, /\.assets-panel\s*\{[\s\S]*position:\s*absolute/);
  assert.match(css, /\.assets-panel\s*\{[\s\S]*z-index:\s*\d+/);
  assert.match(css, /\.assets-panel\s*\{[\s\S]*max-height:/);
});

test("conversation workspace keeps messages scrollable and reply composer visible", () => {
  assert.match(css, /#flowSessionsPanel\s*\{[\s\S]*height:\s*max\(560px,\s*calc\(100vh - 178px\)\)/);
  assert.match(css, /\.flow-workbench\s*\{[\s\S]*height:\s*100%[\s\S]*overflow:\s*hidden/);
  assert.match(css, /\.chat-view\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto[\s\S]*height:\s*100%/);
  assert.match(css, /\.chat-messages\s*\{[\s\S]*overflow:\s*auto/);
  assert.match(css, /\.manual-reply-composer\s*\{[\s\S]*align-self:\s*end/);
  assert.match(css, /\.flow-events-wrap\s*\{[\s\S]*display:\s*none/);
});

test("flow machine and proactive panels use compact title-free layouts", () => {
  const flowPanel = sectionHtml("flowMachinePanel");
  const proactivePanel = sectionHtml("proactivePanel");
  const proactiveTasksPanel = sectionHtml("proactiveTasksPanel");
  const sessionsPanel = sectionHtml("flowSessionsPanel");

  assert.doesNotMatch(flowPanel, /<h2 class="module-title"[\s\S]*任务状态机/);
  assert.equal(flowPanel.includes('class="flow-name-row"'), true);
  assert.match(flowPanel, /class="flow-name-row"[\s\S]*id="addFlowNodeButton"/);
  assert.doesNotMatch(proactivePanel, /<h2 class="module-title"[\s\S]*主动推送/);
  assert.match(proactiveTasksPanel, /<h2 class="module-title"[\s\S]*主动推送查询/);
  assert.doesNotMatch(sessionsPanel, /<h2 class="module-title"[\s\S]*客户会话/);
  assert.match(sessionsPanel, /class="section-head flow-session-head"[\s\S]*flowSessionSearchInput[\s\S]*refreshFlowSessionsButton/);
  assert.match(css, /#proactivePanel\s*\{[\s\S]*height:\s*clamp/);
  assert.match(css, /#proactivePanel\s+\.collapsible-content\s*\{[\s\S]*overflow:\s*auto/);
  assert.match(css, /#flowSessionsPanel\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\)/);
});

test("proactive push controls use standard button sizing", () => {
  assert.doesNotMatch(css, /\.target-actions button,\s*\.bulk-actions button\s*\{[^}]*height:\s*(?:28|30)px/);
  assert.doesNotMatch(css, /\.segmented button\s*\{[^}]*height:\s*28px/);
  assert.match(css, /\.target-actions button,\s*\.bulk-actions button\s*\{[^}]*height:\s*40px/);
  assert.match(css, /\.segmented button\s*\{[^}]*height:\s*40px/);
});

test("console has manual reply composer with AI takeover prompt and emoji tools", () => {
  assert.equal(html.includes('id="manualReplyComposer"'), true);
  assert.equal(html.includes("AI 正在和客户大大沟通中。。。"), true);
  assert.equal(html.includes("ai-chatting.png"), true);
  assert.equal(app.includes("sendManualReply"), true);
  assert.equal(app.includes("/manual-reply"), true);
  assert.equal(app.includes("manualReplyEmojis"), true);
  assert.equal(css.includes("@keyframes aiComposerBorderSpin"), true);
  assert.equal(css.includes(".manual-reply-composer.is-ai"), true);
  assert.match(css, /\.manual-reply-composer\.is-ai\s*\{[\s\S]*min-height:\s*86px/);
  assert.match(css, /\.ai-takeover-card\s*\{[\s\S]*min-height:\s*66px/);
  assert.match(css, /\.ai-takeover-card img\s*\{[\s\S]*max-height:\s*78px/);
  assert.match(css, /\.ai-takeover-card span\s*\{[\s\S]*font-size:\s*clamp/);
  assert.match(css, /\.ai-takeover-card span\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.equal(html.includes("handoffStatusBanner"), false);
});
