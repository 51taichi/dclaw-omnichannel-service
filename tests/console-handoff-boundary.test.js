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

function cssRule(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1);
  const end = css.indexOf("}", start);
  assert.notEqual(end, -1);
  return css.slice(start, end + 1);
}

function functionBody(name) {
  const start = app.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} is defined`);
  const signatureEnd = app.indexOf(") {", start);
  const open = signatureEnd + 2;
  let depth = 0;
  for (let index = open; index < app.length; index += 1) {
    if (app[index] === "{") depth += 1;
    if (app[index] === "}") depth -= 1;
    if (depth === 0) return app.slice(open + 1, index);
  }
  assert.fail(`${name} body is closed`);
}

test("console shell keeps the bot rail fixed while giving more width to content", () => {
  const layoutRule = cssRule(".layout");
  const shellRule = cssRule(".console-shell");

  assert.match(layoutRule, /width:\s*min\(1440px,\s*calc\(100% - 16px\)\)/);
  assert.match(layoutRule, /gap:\s*10px/);
  assert.match(shellRule, /grid-template-columns:\s*300px minmax\(0,\s*1fr\)/);
});

test("console exposes a per-session handoff switch without redundant status labels", () => {
  const switchRule = cssRule(".handoff-switch");

  assert.equal(html.includes('id="handoffStatusBanner"'), false);
  assert.equal(app.includes("toggleSelectedConversationHandoff"), true);
  assert.equal(app.includes("data-flow-handoff-switch"), true);
  assert.doesNotMatch(app, /data-flow-handoff=/);
  assert.equal(app.includes("handoffControl"), false);
  assert.equal(app.includes("els.handoffSwitch"), false);
  assert.equal(app.includes("/handoff"), true);
  assert.equal(app.includes("handoffStatus"), true);
  assert.equal(css.includes(".handoff-button"), false);
  assert.doesNotMatch(functionBody("renderFlowSessions"), /const handoffSwitch = sessionType === "private"/);
  assert.match(functionBody("renderFlowSessions"), /class="flow-session-switch handoff-switch/);
  assert.doesNotMatch(app, /class="flow-session-status/);
  assert.doesNotMatch(app, /els\.chatStatusBadge\.innerHTML = statusBadgeHtml/);
  assert.match(css, /\.flow-session-switch\.handoff-switch\s*\{[\s\S]*position:\s*relative[\s\S]*right:\s*auto[\s\S]*bottom:\s*auto[\s\S]*grid-column:\s*4[\s\S]*grid-row:\s*1/);
  assert.match(switchRule, /grid-template-columns:\s*repeat\(2,\s*30px\)/);
  assert.match(switchRule, /gap:\s*2px/);
  assert.match(switchRule, /width:\s*max-content/);
  assert.match(switchRule, /height:\s*auto/);
  assert.match(switchRule, /border-radius:\s*8px/);
  assert.doesNotMatch(switchRule, /width:\s*74px/);
  assert.doesNotMatch(switchRule, /height:\s*38px/);
  assert.match(css, /\.handoff-switch-option\s*\{[\s\S]*width:\s*30px[\s\S]*height:\s*30px/);
  assert.match(css, /\.handoff-switch-thumb\s*\{[\s\S]*width:\s*30px[\s\S]*height:\s*30px[\s\S]*border-radius:\s*6px/);
  assert.match(css, /\.handoff-switch \.icon\s*\{[\s\S]*width:\s*16px[\s\S]*height:\s*16px/);
  assert.match(css, /\.handoff-switch-option\.is-ai \.icon\s*\{[\s\S]*width:\s*20px[\s\S]*height:\s*20px/);
  assert.match(css, /\.handoff-switch\.is-human \.handoff-switch-thumb\s*\{[\s\S]*transform:\s*translateX\(32px\)/);
});

test("flow session cards show the current task inline without metadata icons", () => {
  assert.equal(app.includes("flow-session-current-task"), true);
  assert.equal(app.includes('class="flow-session-current-task" title="${escapeHtml(status)}">${escapeHtml(statusLabel)}'), true);
  assert.equal(app.includes("当前任务："), false);
  assert.match(app, /const privateSessionTools = sessionType === "private"/);
  assert.doesNotMatch(functionBody("renderFlowSessions"), /const manualTagTrigger = sessionType === "private"/);
  assert.match(app, /class="flow-session-tag-zone"[\s\S]*renderConversationTags\(session\.tags \|\| \[\], \{ includeDate: false \}\)/);
  assert.equal(app.includes('最近消息：${formatDisplayDateTime(lastMessageAt) || "暂无"}'), false);
  assert.doesNotMatch(app, /timeTooltip/);
  assert.doesNotMatch(app, /title="\$\{escapeHtml\(timeTooltip\)\}"/);
  assert.doesNotMatch(app, /class="session-icon"/);
  assert.doesNotMatch(app, /assetTooltip/);
  assert.doesNotMatch(app, /taskTooltip/);
  assert.equal(app.includes("aria-label="), true);
  assert.equal(html.includes('id="icon-robot"'), true);
  assert.equal(app.includes("AI接待中"), false);
  assert.equal(app.includes("人工接手中"), false);
  assert.equal(app.includes("flow-session-status"), false);
  assert.equal(css.includes(".flow-session-icons"), false);
  assert.match(css, /\.flow-session-current-task\s*\{[\s\S]*width:\s*68px[\s\S]*min-width:\s*68px[\s\S]*max-width:\s*68px/);
  assert.match(css, /\.flow-session-current-task\s*\{[\s\S]*white-space:\s*nowrap[\s\S]*text-overflow:\s*ellipsis/);
  assert.match(app, /class="flow-session-current-task" title="\$\{escapeHtml\(status\)\}"/);
  assert.match(css, /\.flow-session-current-task::before\s*\{[\s\S]*animation:\s*flow-current-node-pulse/);
  assert.match(css, /@keyframes flow-current-node-pulse/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.flow-session-current-task::before\s*\{[\s\S]*animation:\s*none/);
  assert.match(css, /\.flow-session-card\.is-legacy \.flow-session-current-task\s*\{/);
});

test("current task labels show four characters before an ellipsis", () => {
  const functionSource = app.match(/function compactFlowNodeName\([\s\S]*?\n}\n/)[0];
  const compactFlowNodeName = Function(`${functionSource}; return compactFlowNodeName;`)();

  assert.equal(compactFlowNodeName("推送卡片"), "推送卡片");
  assert.equal(compactFlowNodeName("推送卡片节点"), "推送卡片…");
  assert.equal(compactFlowNodeName("咨询"), "咨询");
  assert.match(app, /const statusLabel = compactFlowNodeName\(status\)/);
  assert.match(app, />\$\{escapeHtml\(statusLabel\)\}<\/span>/);
  assert.match(css, /\.flow-session-current-task\s*\{[\s\S]*padding:\s*0 3px 0 13px[\s\S]*font-size:\s*10px/);
  assert.match(css, /\.flow-session-current-task::before\s*\{[\s\S]*left:\s*7px[\s\S]*width:\s*5px[\s\S]*height:\s*5px/);
});

test("current task labels never expose internal or unknown node ids", () => {
  const functionSource = app.match(/function flowNodeName\([\s\S]*?\n}\n/)[0];
  const machine = {
    config: {
      nodes: [{ id: "node_1", name: "首次沟通" }]
    }
  };
  const flowNodeName = Function(
    "currentFlowMachine",
    `${functionSource}; return flowNodeName;`
  )(machine);

  assert.equal(flowNodeName("node_1"), "首次沟通");
  assert.equal(flowNodeName("__conversation__"), "未进入");
  assert.equal(flowNodeName("missing_node"), "未进入");
  assert.equal(flowNodeName(""), "未进入");
});

test("flow sessions redraw when the flow machine finishes loading", () => {
  const functionSource = app.match(/async function loadFlowMachine\([\s\S]*?\n}\n/)[0];

  assert.match(
    functionSource,
    /renderFlowSessionNodeFilter\(\);[\s\S]*!useDefault[\s\S]*currentFlowSessions\.length[\s\S]*renderFlowSessions\(\)/
  );
});

test("flow session status labels do not change card or chat header layout", () => {
  assert.match(css, /\.flow-session-card\s*\{[\s\S]*display:\s*grid/);
  assert.match(css, /\.flow-workbench\s*\{[\s\S]*grid-template-columns:\s*310px minmax\(0,\s*1fr\)/);
  assert.match(css, /\.flow-session-card\s*\{[\s\S]*grid-template-columns:\s*34px minmax\(0,\s*1fr\) max-content max-content/);
  assert.match(css, /\.flow-session-card\s*\{[\s\S]*grid-template-rows:\s*34px minmax\(28px,\s*auto\)/);
  assert.match(css, /\.flow-session-card\s*\{[\s\S]*gap:\s*10px 9px/);
  assert.match(css, /\.flow-session-card\s*\{[\s\S]*position:\s*relative[\s\S]*padding:\s*9px/);
  assert.doesNotMatch(css, /\.flow-session-card\s*\{[\s\S]*min-height:\s*78px/);
  assert.match(css, /\.flow-session-avatar-shell\s*\{[\s\S]*grid-column:\s*1[\s\S]*grid-row:\s*1/);
  assert.match(css, /\.flow-session-main\s*\{[\s\S]*display:\s*contents/);
  assert.match(css, /\.flow-session-name-row\s*\{[\s\S]*grid-column:\s*2[\s\S]*width:\s*auto[\s\S]*align-self:\s*center/);
  assert.match(app, /class="flow-session-name" title="\$\{escapeHtml\(name\)\}"/);
  assert.match(
    app,
    /class="conversation-metadata-flow"[\s\S]*renderConversationDateTag\(session\.tags \|\| \[\]\)[\s\S]*class="flow-session-tag-zone"[\s\S]*renderConversationTags\(session\.tags \|\| \[\], \{ includeDate: false \}\)[\s\S]*privateSessionTools/
  );
  assert.match(css, /\.conversation-metadata-flow\s*\{[\s\S]*grid-column:\s*2 \/ -1[\s\S]*grid-row:\s*2[\s\S]*display:\s*flex[\s\S]*flex-flow:\s*row wrap/);
  assert.match(css, /\.flow-session-date-tag\s*\{[\s\S]*min-width:\s*max-content[\s\S]*overflow:\s*visible/);
  assert.match(css, /\.flow-session-date-tag \.tag-chip\s*\{[\s\S]*max-width:\s*none/);
  assert.match(css, /\.flow-session-card \.tag-chip,\n\.flow-session-card \.tag-chip span\s*\{[\s\S]*overflow:\s*visible[\s\S]*text-overflow:\s*clip/);
  assert.match(css, /\.conversation-metadata-flow \.flow-session-date-tag,[\s\S]*\.conversation-metadata-flow \.flow-session-tag-zone,[\s\S]*\.conversation-metadata-flow \.flow-session-tools\s*\{[\s\S]*display:\s*contents/);
  assert.match(css, /\.conversation-metadata-flow \.conversation-tags\s*\{[\s\S]*display:\s*contents/);
  assert.doesNotMatch(css, /\.flow-session-tools\s*\{[^}]*grid-column:/);
  assert.doesNotMatch(css, /\.flow-session-card\.is-group \.flow-session-tag-zone/);
  assert.match(css, /\.flow-session-switch\.handoff-switch\s*\{[\s\S]*grid-column:\s*4[\s\S]*grid-row:\s*1/);
  assert.doesNotMatch(css, /\.flow-session-status\s*\{/);
  assert.match(css, /\.flow-session-name-row\s*\{[\s\S]*padding-right:\s*0/);
  assert.match(css, /\.chat-head\s*\{[\s\S]*grid-template-columns:\s*minmax\(180px,\s*1fr\) minmax\(112px,\s*180px\) auto/);
  assert.match(css, /\.chat-status-slot\s*\{[\s\S]*display:\s*flex[\s\S]*justify-content:\s*center/);
  assert.match(css, /\.chat-status-badge\s*\{[\s\S]*min-width:\s*48px/);
  assert.match(css, /\.chat-title-wrap\s*\{[\s\S]*grid-template-columns:\s*34px minmax\(0,\s*max-content\) minmax\(0,\s*1fr\)/);
  assert.match(css, /\.chat-tag-list\s*\{[\s\S]*display:\s*block[\s\S]*width:\s*100%/);
  assert.match(css, /\.chat-tag-list \.conversation-tags\s*\{[\s\S]*display:\s*flex[\s\S]*flex-flow:\s*row wrap[\s\S]*width:\s*100%[\s\S]*max-width:\s*none/);
  assert.match(css, /\.chat-tag-list \.tag-chip\s*\{[\s\S]*flex:\s*0 0 auto[\s\S]*max-width:\s*none/);
  assert.match(html, /class="chat-title-wrap"[\s\S]*id="chatStatusSlot" class="chat-status-slot"[\s\S]*class="chat-head-actions"/);
});

test("flow sessions can be filtered and human handoff sessions are pinned first", () => {
  const sessionsPanel = sectionHtml("flowSessionsPanel");

  assert.equal(html.includes('id="flowSessionDateFrom"'), false);
  assert.equal(html.includes('id="flowSessionDateTo"'), false);
  assert.equal(html.includes('id="flowSessionSearchInput"'), true);
  assert.equal(html.includes('data-flow-session-type="all"'), false);
  assert.match(html, /class="active" data-flow-session-type="private"[^>]*aria-selected="true"/);
  assert.equal(html.includes('data-flow-session-type="group"'), true);
  assert.equal(app.includes("flowSessionSearchInput"), true);
  assert.equal(app.includes("normalizedSessionSearch"), true);
  assert.equal(app.includes("flowSessionType(session) !== typeFilter"), true);
  assert.equal(app.includes("[data-flow-session-type].active"), true);
  assert.equal(html.includes("搜索客户/会话"), false);
  assert.equal(html.includes(">搜索客户</span>"), true);
  assert.equal(html.includes('placeholder="搜索客户/群名"'), true);
  assert.equal(html.includes('id="flowSessionAssetFilter"'), false);
  assert.equal(app.includes("flowSessionAssetFilter"), false);
  assert.equal(html.includes('id="flowSessionNodeFilter"'), true);
  assert.match(html, /id="flowSessionNodeFilterField" class="flow-session-node-filter"/);
  assert.equal(html.includes('id="flowSessionHandoffFilter"'), false);
  assert.equal(html.includes("接手状态"), false);
  assert.equal(app.includes("getVisibleFlowSessions"), true);
  assert.equal(app.includes("sortFlowSessions"), true);
  assert.equal(app.includes('handoffStatus === "human"'), true);
  assert.equal(app.includes('"./assets/group.png"'), true);
  assert.equal(app.includes('"./assets/ddeer.png"'), true);
  assert.equal(app.includes('sessionType === "group" ? "is-group" : ""'), true);
  assert.equal(css.includes(".flow-session-filters"), true);
  assert.equal(css.includes(".flow-session-avatar.is-group"), true);
  assert.match(sessionsPanel, /class="flow-session-sidebar"[\s\S]*class="segmented flow-session-type-tabs"[\s\S]*id="flowSessionList"/);
  assert.equal(css.includes(".flow-session-type-tabs"), true);
  assert.match(css, /\.flow-session-type-tabs\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(app, /function syncFlowSessionTypeUi\(\)/);
  assert.match(app, /els\.flowSessionNodeFilterField\.hidden = isGroup/);
  assert.match(app, /if \(currentFlowSessionTypeFilter\(\) === "private"[\s\S]*params\.set\("nodeId", nodeFilter\)/);
  assert.equal(css.includes(".flow-session-sidebar"), true);
  assert.doesNotMatch(css, /\.flow-session-filters\s*\{[^}]*border-bottom:/);
  assert.equal(css.includes(".handoff-status-banner"), false);
});

test("group conversation details suppress private assets while private details keep them", () => {
  assert.match(app, /function renderConversationAssetsForSession\(session, assets\)/);
  assert.match(app, /if \(flowSessionType\(session\) === "group"\)[\s\S]*renderConversationAssets\(\{ fields: \[\], totalCount: 0, collectedCount: 0 \}\)/);
  assert.match(app, /renderConversationAssetsForSession\([\s\S]*currentFlowSession,[\s\S]*data\.assets \|\| session\?\.assets/);
  assert.match(css, /\.asset-button\[hidden\]\s*\{[\s\S]*display:\s*none/);
  assert.match(css, /\.chat-head-actions\s*\{[\s\S]*display:\s*flex/);
});

test("human handoff session cards have a clear pulsing highlight", () => {
  assert.equal(css.includes("@keyframes handoffPulse"), true);
  assert.equal(css.includes("animation: handoffPulse"), true);
  assert.equal(css.includes("@media (prefers-reduced-motion: reduce)"), true);
  assert.equal(css.includes(".flow-session-card.is-handoff"), true);
  assert.equal(css.includes(".handoff-switch.is-human .handoff-switch-thumb"), true);
});

test("handoff reordering animates cards from their previous position", () => {
  assert.match(app, /function captureFlowSessionPositions\(\)/);
  assert.match(app, /getBoundingClientRect\(\)\.top/);
  assert.match(app, /function animateFlowSessionReorder\(previousPositions\)/);
  assert.match(app, /prefers-reduced-motion:\s*reduce/);
  assert.match(app, /card\.animate\(/);
  assert.match(app, /duration:\s*320/);
  assert.match(app, /cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)/);
  assert.match(app, /const previousPositions = captureFlowSessionPositions\(\)/);
  assert.match(app, /renderFlowSessions\(\{ animateFrom: previousPositions \}\)/);
  assert.match(css, /\.flow-session-card\.is-reordering\s*\{[\s\S]*will-change:\s*transform/);
});

test("conversation assets open as a popover without affecting chat layout", () => {
  assert.match(css, /\.chat-view\s*\{[\s\S]*position:\s*relative/);
  assert.match(css, /\.assets-panel\s*\{[\s\S]*position:\s*absolute/);
  assert.match(css, /\.assets-panel\s*\{[\s\S]*z-index:\s*\d+/);
  assert.match(css, /\.assets-panel\s*\{[\s\S]*max-height:/);
});

test("conversation workspace keeps messages scrollable and reply composer visible", () => {
  assert.match(css, /#flowSessionsPanel\s*\{[\s\S]*height:\s*max\(560px,\s*calc\(100vh - 108px\)\)/);
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
  assert.doesNotMatch(flowPanel, /高级：导入\/查看 JSON/);
  assert.doesNotMatch(flowPanel, /从 JSON 导入到表单/);
  assert.match(flowPanel, /id="importFlowFile"[\s\S]*hidden/);
  assert.match(flowPanel, /class="[^"]*\bflow-config-footer\b[^"]*"[\s\S]*id="applyFlowJsonButton"[\s\S]*导入配置[\s\S]*id="exportFlowButton"[\s\S]*导出配置[\s\S]*保存状态机/);
  assert.match(css, /\.flow-config-footer\s*\{[\s\S]*justify-content:\s*space-between/);
  assert.match(app, /importFlowConfigFile\(els\.importFlowFile\.files\?\.\[0\]\)/);
  assert.doesNotMatch(proactivePanel, /<h2 class="module-title"[\s\S]*主动推送/);
  assert.match(proactiveTasksPanel, /<h2 class="module-title"[\s\S]*主动推送查询/);
  assert.doesNotMatch(sessionsPanel, /<h2 class="module-title"[\s\S]*客户会话/);
  assert.match(sessionsPanel, /class="section-head flow-session-head"[\s\S]*flowSessionSearchInput[\s\S]*refreshFlowSessionsButton/);
  assert.match(css, /#proactivePanel\s*\{[\s\S]*height:\s*max\(560px,\s*calc\(100vh - 108px\)\)/);
  assert.match(css, /#proactivePanel\s+\.collapsible-content\s*\{[\s\S]*overflow:\s*hidden/);
  assert.match(css, /#flowSessionsPanel\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\)/);
});

test("task and tag workspaces keep their content scrollable above fixed footers", () => {
  assert.match(css, /\.workspace\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\)[\s\S]*height:\s*max\(560px,\s*calc\(100vh - 108px\)\)/);
  assert.match(css, /#flowMachinePanel #flowMachineForm\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto/);
  assert.match(css, /\.flow-node-list\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /#tagSchemaPanel \.tag-schema-editor\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto/);
  assert.match(css, /#tagSchemaPanel \.tag-group-list\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.flow-config-footer\s*\{[\s\S]*background:\s*#ffffff/);
  assert.match(css, /\.tag-schema-footer\s*\{[\s\S]*background:\s*#ffffff/);
  assert.match(css, /\.proactive-actions\s*\{[\s\S]*background:\s*#ffffff/);
});

test("task nodes animate and keep only one node expanded", () => {
  assert.match(css, /\.collapsible-panel > \.collapsible-content\s*\{[\s\S]*max-height:\s*10000px[\s\S]*transition:[\s\S]*max-height 1000ms/);
  assert.match(css, /\.collapsible-panel\.is-collapsed > \.collapsible-content\s*\{[\s\S]*max-height:\s*0[\s\S]*opacity:\s*0/);
  assert.doesNotMatch(css, /\.collapsible-panel\.is-collapsed \.collapsible-content\s*\{[\s\S]*display:\s*none/);
  assert.match(css, /\.collapsible-content\.is-slide-down[\s\S]*animation:\s*slideDown 1000ms/);
  assert.match(css, /\.collapsible-content\.is-slide-up[\s\S]*animation:\s*slideUp 1000ms/);
  assert.match(css, /\.flow-node-card-body\s*\{[\s\S]*max-height:\s*10000px[\s\S]*transition:[\s\S]*max-height 1000ms/);
  assert.match(css, /\.flow-node-card-body\.is-slide-down[\s\S]*animation:\s*slideDown 1000ms/);
  assert.match(css, /\.flow-node-card-body\.is-slide-up[\s\S]*animation:\s*slideUp 1000ms/);
  assert.match(css, /@keyframes slideDown[\s\S]*@keyframes slideUp/);
  assert.match(css, /\.flow-node-card\.is-collapsed \.flow-node-card-body\s*\{[\s\S]*(?:max-height:\s*0[\s\S]*grid-template-rows:\s*0fr|grid-template-rows:\s*0fr[\s\S]*max-height:\s*0)/);
  assert.match(css, /\.tag-group-body\s*\{[\s\S]*max-height:\s*10000px[\s\S]*transition:[\s\S]*max-height 1000ms/);
  assert.match(css, /\.tag-group-body\.is-slide-down[\s\S]*animation:\s*slideDown 1000ms/);
  assert.match(css, /\.tag-group-body\.is-slide-up[\s\S]*animation:\s*slideUp 1000ms/);
  assert.match(css, /\.tag-group-card\.is-collapsed \.tag-group-body\s*\{[\s\S]*(?:max-height:\s*0[\s\S]*grid-template-rows:\s*0fr|grid-template-rows:\s*0fr[\s\S]*max-height:\s*0)/);
  assert.match(app, /flowDraftNodes\.forEach\(\(node, index\) => \{[\s\S]*collapsedFlowNodes\.add\(flowNodeCollapseKey\(node, index\)\)/);
  assert.match(app, /function collapseAllFlowNodes\(\)[\s\S]*collapsedFlowNodes\.clear\(\)[\s\S]*flowDraftNodes\.forEach/);
  assert.match(app, /if \(collapsedFlowNodes\.has\(collapseKey\)\) \{[\s\S]*collapseAllFlowNodes\(\)[\s\S]*collapsedFlowNodes\.delete\(collapseKey\)/);
  assert.match(app, /function updateCollapseCardVisual\(card, isCollapsed/);
  assert.match(app, /function updateCollapsiblePanelVisual\(panel, isCollapsed/);
  assert.match(app, /updateCollapsiblePanelVisual\(panel, !panel\?\.classList\.contains\("is-collapsed"\)\)/);
  assert.match(app, /function toggleTagGroupCollapse\(groupIndex\)[\s\S]*collapsedTagGroups\.clear\(\)[\s\S]*updateCollapseCardVisual\(groupCard, isCollapsed/);
  assert.match(app, /updateCollapseCardVisual\(nodeCard, isCollapsed/);
});

test("task node textareas truncate to one line until focused", () => {
  assert.match(css, /\.expand-on-focus\s*\{[\s\S]*height:\s*40px[\s\S]*max-height:\s*40px[\s\S]*overflow:\s*hidden[\s\S]*white-space:\s*nowrap[\s\S]*text-overflow:\s*ellipsis[\s\S]*resize:\s*none/);
  assert.match(css, /\.expand-on-focus:focus\s*\{[\s\S]*height:\s*112px[\s\S]*max-height:\s*112px[\s\S]*overflow:\s*auto[\s\S]*white-space:\s*pre-wrap[\s\S]*text-overflow:\s*clip[\s\S]*resize:\s*vertical/);
});

test("focused task node textareas stay aligned with their expanding field slot", () => {
  assert.match(css, /\.expand-field-slot > label:focus-within\s*\{[\s\S]*height:\s*112px/);
  assert.match(css, /\.expand-on-focus:focus\s*\{[\s\S]*height:\s*112px[\s\S]*max-height:\s*112px/);
  assert.doesNotMatch(css, /\.flow-node-grid label:focus-within textarea\s*\{/);
});

test("proactive panel keeps send action pinned while content scrolls", () => {
  const proactivePanel = sectionHtml("proactivePanel");

  assert.match(proactivePanel, /class="proactive-form-body"[\s\S]*class="actions proactive-actions"/);
  assert.match(css, /#proactivePanel\s*\{[\s\S]*height:\s*max\(560px,\s*calc\(100vh - 108px\)\)/);
  assert.match(css, /#proactivePanel\s+\.collapsible-content\s*\{[\s\S]*overflow:\s*hidden/);
  assert.match(css, /\.proactive-form-body\s*\{[\s\S]*overflow:\s*auto/);
  assert.match(css, /\.proactive-actions\s*\{[\s\S]*align-self:\s*end/);
});

test("proactive push controls use standard button sizing", () => {
  assert.doesNotMatch(css, /\.target-actions button,\s*\.bulk-actions button\s*\{[^}]*height:\s*(?:28|30)px/);
  assert.doesNotMatch(css, /\.segmented button\s*\{[^}]*height:\s*28px/);
  assert.match(css, /\.target-actions button,\s*\.bulk-actions button\s*\{[^}]*height:\s*40px/);
  assert.match(css, /\.segmented button\s*\{[^}]*height:\s*40px/);
});

test("proactive target cards use private and group avatar images", () => {
  assert.equal(app.includes('targetTypeAvatar'), true);
  assert.equal(app.includes('"./assets/ddeer.png"'), true);
  assert.equal(app.includes('"./assets/group.png"'), true);
  assert.match(app, /<img class="target-avatar \$\{target\.targetType === "group" \? "group" : "private"\}" src="\$\{escapeHtml\(targetTypeAvatar\(target\.targetType\)\)\}"/);
  assert.match(css, /\.target-avatar\s*\{[\s\S]*object-fit:\s*cover/);
});

test("proactive targets render a fixed selected-target summary with overflow", () => {
  const proactivePanel = sectionHtml("proactivePanel");

  assert.match(proactivePanel, /class="target-selection-row"/);
  assert.match(proactivePanel, /id="selectedTargetsSummary"/);
  assert.match(proactivePanel, /id="selectedTargetsCount"[\s\S]*已选 0/);
  assert.match(proactivePanel, /id="selectedTargetsPreview"/);
  assert.match(proactivePanel, /id="selectedTargetsMoreButton"/);
  assert.match(proactivePanel, /id="selectedTargetsPopover"/);
  assert.match(app, /const SELECTED_TARGET_PREVIEW_LIMIT = 3/);
  assert.match(app, /function renderSelectedTargets\(\)[\s\S]*selectedTargetsCount\.textContent = `已选 \$\{targets\.length\}`/);
  assert.match(app, /selectedTargetsMoreButton\.textContent = `\+\$\{remainingCount\}`/);
  assert.match(css, /\.target-selection-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;[^}]*height:\s*40px/);
  assert.match(css, /\.selected-targets-summary\s*\{[^}]*height:\s*40px;[^}]*min-width:\s*0;[^}]*overflow:\s*visible/);
  assert.match(css, /\.selected-targets-preview\s*\{[^}]*overflow:\s*hidden;[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.selected-targets-popover\s*\{[^}]*position:\s*absolute;[^}]*max-height:\s*260px;[^}]*overflow-y:\s*auto/);
});

test("narrow proactive target summary hides previews and overflow count before pagination shifts", () => {
  assert.match(
    css,
    /@media \(max-width:\s*760px\)[\s\S]*\.selected-targets-preview\s*\{[^}]*display:\s*none;[\s\S]*\.selected-targets-more\s*\{[^}]*display:\s*none;/
  );
});

test("proactive target cards use checkbox indicators instead of choose text", () => {
  assert.doesNotMatch(app, /<span class="target-check">/);
  assert.doesNotMatch(app, /\$\{checked \? "已选" : "选择"\}/);
  assert.match(app, /<span class="target-checkbox \$\{checked \? "checked" : ""\}" aria-hidden="true">/);
  assert.match(app, /<use href="#icon-check"><\/use>/);
  assert.match(css, /\.target-checkbox\s*\{[\s\S]*border:\s*1px solid/);
  assert.match(css, /\.target-checkbox\.checked\s*\{[\s\S]*background:\s*var\(--accent\)/);
});

test("proactive target list keeps a fixed scrollable height", () => {
  const targetListRule = cssRule(".target-list");

  assert.match(targetListRule, /grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(targetListRule, /height:\s*168px/);
  assert.match(targetListRule, /overflow-y:\s*auto/);
  assert.doesNotMatch(targetListRule, /max-height/);
});

test("proactive target picker does not add a redundant outer frame", () => {
  const targetPickerRule = cssRule(".target-picker");

  assert.match(targetPickerRule, /border:\s*0/);
  assert.match(targetPickerRule, /background:\s*transparent/);
  assert.match(targetPickerRule, /padding:\s*12px/);
});

test("proactive form works without a message type dropdown", () => {
  const proactivePanel = sectionHtml("proactivePanel");

  assert.doesNotMatch(proactivePanel, /<select name="messageType"/);
  assert.match(app, /const type = els\.messageTypeInput\?\.value \|\| "text";/);
  assert.match(app, /field\.hidden = Boolean\(els\.messageTypeInput\) && !active;/);
  assert.match(app, /els\.messageTypeInput\?\.addEventListener\("change", syncMessageTypeFields\);/);
});

test("proactive upload uses a custom drag and click dropzone", () => {
  const proactivePanel = sectionHtml("proactivePanel");
  const uploadDropzoneRule = cssRule(".upload-dropzone");

  assert.match(proactivePanel, /class="proactive-attachment-row"[\s\S]*id="proactiveUploadDropzone"[\s\S]*id="proactiveAttachmentList"/);
  assert.match(proactivePanel, /class="upload-dropzone"[\s\S]*上传附件/);
  assert.match(proactivePanel, /id="proactiveUploadFile"[\s\S]*multiple/);
  assert.match(proactivePanel, /id="proactiveAttachmentList"/);
  assert.match(app, /const PROACTIVE_MAX_ATTACHMENTS = 5;/);
  assert.match(app, /proactiveUploadFiles:\s*\[\]/);
  assert.match(app, /function renderProactiveAttachments\(\)/);
  assert.match(app, /function bindProactiveUploadDropzone\(\)/);
  assert.match(app, /els\.proactiveUploadDropzone\.addEventListener\("drop"/);
  assert.match(app, /data-remove-proactive-attachment/);
  assert.match(app, /payload\.attachments = uploadedAttachments;/);
  assert.match(css, /\.proactive-attachment-row\s*\{[\s\S]*display:\s*flex/);
  assert.match(uploadDropzoneRule, /width:\s*86px/);
  assert.match(uploadDropzoneRule, /height:\s*86px/);
  assert.match(uploadDropzoneRule, /grid-template-columns:\s*1fr/);
  assert.match(uploadDropzoneRule, /cursor:\s*pointer/);
  assert.match(css, /\.upload-dropzone-icon\s*\{[\s\S]*place-self:\s*center/);
  assert.match(css, /\.upload-dropzone-icon\s*\{[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--cyan\) 14%,\s*#ffffff\)/);
  assert.match(css, /\.upload-dropzone-icon\s*\{[\s\S]*color:\s*color-mix\(in srgb,\s*var\(--accent\) 72%,\s*var\(--cyan\)\)/);
  assert.match(css, /\.proactive-attachment-list\s*\{/);
  assert.match(css, /\.proactive-attachment-list\s*\{[\s\S]*display:\s*flex/);
  assert.match(css, /\.proactive-attachment-card\s*\{[\s\S]*width:\s*86px[\s\S]*height:\s*86px[\s\S]*border:\s*1px solid/);
  assert.match(css, /\.proactive-attachment-card \.icon-button\s*\{[\s\S]*position:\s*absolute[\s\S]*opacity:\s*0/);
  assert.match(css, /\.proactive-attachment-card:hover \.icon-button/);
  assert.match(css, /\.upload-dropzone\.is-dragging\s*\{[\s\S]*border-color:\s*var\(--accent\)/);
});

test("proactive submit locks message fields while uploading attachments", () => {
  const proactivePanel = sectionHtml("proactivePanel");

  assert.match(proactivePanel, /id="proactiveMessageFields" class="wide proactive-message-fields"[\s\S]*id="proactiveUploadOverlay"/);
  assert.match(proactivePanel, /id="proactiveUploadOverlay"[\s\S]*src="assets\/sorry\.png"[\s\S]*请您稍后，正在上传/);
  assert.match(proactivePanel, /id="proactiveSubmitButton"[\s\S]*创建并发送/);
  assert.match(app, /function setProactiveSubmitting\(submitting\)/);
  assert.match(app, /els\.proactiveSubmitButton\.disabled = submitting/);
  assert.match(app, /els\.proactiveUploadOverlay\.hidden = !submitting/);
  assert.match(app, /setProactiveSubmitting\(true\)[\s\S]*finally[\s\S]*setProactiveSubmitting\(false\)/);
  assert.match(css, /\.proactive-message-fields\.is-uploading\s*\{[\s\S]*pointer-events:\s*none/);
  assert.match(css, /\.proactive-upload-overlay\s*\{[\s\S]*position:\s*absolute/);
  assert.match(css, /\.proactive-upload-overlay\s*\{[\s\S]*background:\s*linear-gradient\(/);
  assert.match(css, /\.proactive-upload-overlay\s*\{[\s\S]*box-shadow:\s*0 16px 30px rgba\(35,\s*42,\s*105,\s*0\.08\)/);
  assert.match(css, /\.proactive-upload-overlay::before\s*\{[\s\S]*animation:\s*aiTakeoverSheen 3\.8s ease-in-out infinite/);
  assert.match(css, /\.upload-overlay-image\s*\{[\s\S]*object-fit:\s*contain/);
});

test("conversation reset shows a non-dismissible loading dialog while local deletion runs", () => {
  assert.match(html, /id="conversationResetLoadingDialog"[\s\S]*src="assets\/sorry\.png"[\s\S]*正在删除会话/);
  assert.doesNotMatch(html, /正在删除会话并同步 Agent 记录/);
  assert.match(app, /function setConversationResetSubmitting\(submitting\)/);
  assert.match(app, /els\.conversationResetLoadingDialog\.hidden = !submitting/);
  assert.match(app, /setConversationResetSubmitting\(true\)[\s\S]*finally[\s\S]*setConversationResetSubmitting\(false\)/);
  assert.doesNotMatch(app, /conversationResetLoadingDialog[\s\S]*event\.target === els\.conversationResetLoadingDialog/);
  assert.match(css, /\.conversation-reset-loading-dialog\s*\{[\s\S]*grid-template-columns:\s*78px minmax\(0, max-content\)/);
  assert.match(css, /\.conversation-reset-loading-dialog::before\s*\{[\s\S]*animation:\s*aiTakeoverSheen 3\.8s ease-in-out infinite/);
});

test("conversation delete uses destructive delete wording in button and confirm dialog", () => {
  const chatHeadStart = html.indexOf('class="chat-head"');
  const chatHeadEnd = html.indexOf('<div id="assetsPanel"', chatHeadStart);
  assert.notEqual(chatHeadStart, -1);
  assert.notEqual(chatHeadEnd, -1);
  const chatHead = html.slice(chatHeadStart, chatHeadEnd);
  const confirmStart = html.indexOf('id="confirmDialog"');
  const confirmEnd = html.indexOf('id="conversationResetLoadingDialog"', confirmStart);
  assert.notEqual(confirmStart, -1);
  assert.notEqual(confirmEnd, -1);
  const confirmDialog = html.slice(confirmStart, confirmEnd);

  assert.match(chatHead, /删除会话/);
  assert.doesNotMatch(chatHead, /清空会话/);
  assert.match(confirmDialog, /<strong id="confirmTitle">删除会话？<\/strong>/);
  assert.match(confirmDialog, /确认后会删除并清空当前会话记录。/);
  assert.match(confirmDialog, /确认删除/);
  assert.doesNotMatch(confirmDialog, /确认后会清空当前会话记录，并让下一次 Agent 调用从头开始。/);
  assert.doesNotMatch(confirmDialog, /确认清空/);
  assert.match(app, /toast\("会话已删除"\)/);
});

test("conversation reset clears the selected session instead of reopening the deleted shell", () => {
  const start = app.indexOf("async function resetSelectedConversation()");
  const end = app.indexOf("\nfunction setConversationResetSubmitting", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = app.slice(start, end);

  assert.match(body, /state\.selectedFlowConversationKey = ""/);
  assert.match(body, /currentFlowSession = null/);
  assert.match(body, /els\.chatTitle\.textContent = emptyFlowSessionTitle\(\)/);
  assert.match(body, /await loadFlowSessions\(\)/);
  assert.equal(body.includes("openFlowSession(conversationKey)"), false);
});

test("conversation delete success is committed before a separately handled list refresh", () => {
  const start = app.indexOf("async function resetSelectedConversation()");
  const end = app.indexOf("\nfunction setConversationResetSubmitting", start);
  const body = app.slice(start, end);
  const success = body.indexOf('toast("会话已删除")');
  const refresh = body.indexOf("await loadFlowSessions()");

  assert.ok(success >= 0 && refresh > success);
  assert.match(
    body,
    /try \{[\s\S]*await loadFlowSessions\(\)[\s\S]*\} catch \(error\) \{[\s\S]*会话已删除，但列表刷新失败/
  );
});

test("opening a flow session shows a local mascot loading state in the chat pane", () => {
  assert.equal(app.includes("function renderChatLoadingState"), true);
  assert.match(app, /renderChatLoadingState\(session \|\| \{ conversationKey \}\)/);
  assert.match(app, /class="chat-loading-state"[\s\S]*src="\.\/assets\/sorry\.png"[\s\S]*正在加载会话记录/);
  assert.match(css, /\.chat-loading-state\s*\{[\s\S]*display:\s*grid/);
  assert.match(css, /\.chat-loading-state\s*\{[\s\S]*place-items:\s*center/);
  assert.match(css, /\.chat-loading-card\s*\{[\s\S]*animation:\s*chatLoadingFloat/);
  assert.match(css, /@keyframes chatLoadingFloat/);
});

test("console has manual reply composer with AI takeover prompt and emoji tools", () => {
  const aiTakeoverCardRule = cssRule(".ai-takeover-card");

  assert.equal(html.includes('id="manualReplyComposer"'), true);
  assert.equal(html.includes("AI 正在和客户大大沟通中</span>"), true);
  assert.equal(html.includes("AI 正在和客户大大沟通中。。。"), false);
  assert.equal(html.includes("AI is chatting with the customer</small>"), true);
  assert.equal(html.includes("AI is chatting with the customer..."), false);
  assert.equal(html.includes("ai-chatting.png"), true);
  assert.match(html, /class="ai-takeover-card"[\s\S]*ai-chatting\.png[\s\S]*class="ai-takeover-copy"/);
  assert.equal(app.includes("sendManualReply"), true);
  assert.equal(app.includes("/manual-reply"), true);
  assert.equal(app.includes("manualReplyEmojis"), true);
  assert.equal(css.includes("@keyframes aiComposerBorderSpin"), true);
  assert.equal(css.includes(".manual-reply-composer.is-ai"), true);
  assert.match(css, /\.manual-reply-composer\.is-ai\s*\{[\s\S]*min-height:\s*86px/);
  assert.match(css, /\.ai-takeover-card\s*\{[\s\S]*min-height:\s*66px/);
  assert.match(css, /\.ai-takeover-card\s*\{[\s\S]*grid-template-columns:\s*minmax\(96px,\s*148px\) max-content/);
  assert.match(css, /\.ai-takeover-card\s*\{[\s\S]*justify-content:\s*center/);
  assert.equal(aiTakeoverCardRule.includes("gap:"), false);
  assert.match(css, /\.ai-takeover-card img\s*\{[\s\S]*max-height:\s*78px/);
  assert.match(css, /\.ai-takeover-copy\s*\{[\s\S]*gap:\s*4px/);
  assert.doesNotMatch(css, /\.ai-takeover-copy\s*\{[\s\S]*margin-left:\s*50px/);
  assert.match(css, /\.ai-takeover-copy\s*\{[\s\S]*text-align:\s*left/);
  assert.match(css, /\.ai-takeover-card span\s*\{[\s\S]*font-size:\s*clamp/);
  assert.match(css, /\.ai-takeover-card span\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.match(css, /\.ai-takeover-card small\s*\{[\s\S]*font-size:\s*clamp/);
  assert.equal(html.includes("handoffStatusBanner"), false);
});

test("group conversations use the same handoff state and manual composer as private conversations", () => {
  const composer = functionBody("renderManualReplyComposer");
  const sessions = functionBody("renderFlowSessions");
  const sorting = functionBody("sortFlowSessions");

  assert.match(composer, /session[\s\S]*state\.selectedFlowConversationKey/);
  assert.doesNotMatch(composer, /flowSessionType\(session\) === "private"/);
  assert.match(sorting, /const aHuman = a\.handoffStatus === "human" \? 1 : 0/);
  assert.match(sorting, /const bHuman = b\.handoffStatus === "human" \? 1 : 0/);
  assert.match(sessions, /const isHandoff = session\.handoffStatus === "human"/);
  assert.doesNotMatch(sessions, /sessionType === "private" && session\.handoffStatus/);
});

test("chat bubbles can show agent reply sources without sending them to customers", () => {
  const shortLabelStart = app.indexOf("function sourceTypeShortLabel");
  const shortLabelEnd = app.indexOf("function shouldShowChatSource", shortLabelStart);
  const shortLabels = app.slice(shortLabelStart, shortLabelEnd);
  assert.equal(app.includes("renderChatSources"), true);
  assert.equal(app.includes("message.rawPayload?.sources"), true);
  assert.equal(app.includes("chat-sources"), true);
  assert.equal(app.includes("shouldShowChatSource"), true);
  assert.match(app, /return type !== "conversation"/);
  assert.equal(app.includes("sourceTypeIcon"), true);
  assert.equal(app.includes("sourceTypeShortLabel"), true);
  assert.equal(app.includes("chat-source-chip"), true);
  assert.equal(app.includes("icon(sourceTypeIcon(source.type))"), true);
  assert.equal(app.includes("sourceTypeShortLabel(source.type)"), true);
  assert.match(shortLabels, /enterprise_knowledge:\s*"智库"/);
  assert.match(shortLabels, /knowledge:\s*"智库"/);
  assert.match(shortLabels, /experience:\s*"经验"/);
  assert.doesNotMatch(shortLabels, /(?:enterprise_knowledge|knowledge):\s*"知识"/);
  assert.equal(app.includes("title=\"${escapeHtml(tooltip)}\""), true);
  assert.equal(app.includes("${escapeHtml(label)}：${escapeHtml(source.name)}"), false);
  assert.equal(css.includes(".chat-sources"), true);
  assert.equal(css.includes(".chat-source-chip"), true);
  assert.equal(css.includes(".chat-source-chip .icon"), true);
  assert.equal(css.includes(".chat-source-icon"), false);
});

test("chat bubbles can show agent attachment urls for audit logs", () => {
  assert.equal(app.includes("renderChatAttachments"), true);
  assert.equal(app.includes("message.rawPayload?.attachments"), true);
  assert.equal(app.includes("message.rawPayload?.agentReply?.attachments"), true);
  assert.equal(app.includes("chat-attachments"), true);
  assert.equal(app.includes("chat-attachment-link"), true);
  assert.equal(css.includes(".chat-attachments"), true);
  assert.equal(css.includes(".chat-attachment-link"), true);
});

test("live inbound image callbacks remain visible when WorkTool omits text content", () => {
  assert.equal(app.includes("function resolveInboundImageMessage"), true);
  assert.match(app, /Number\(rawPayload\.textType\)\s*===\s*2/);
  assert.match(app, /rawPayload\.(?:fileUrl|filePath)/);
  assert.equal(app.includes('class="chat-media-placeholder"'), true);
  assert.equal(app.includes('icon("image")'), true);
  assert.equal(app.includes("图片消息"), true);
  assert.equal(css.includes(".chat-media-placeholder"), true);
});
