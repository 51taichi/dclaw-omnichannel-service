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
  const sessionsPanel = sectionHtml("flowSessionsPanel");

  assert.equal(html.includes('id="flowSessionDateFrom"'), false);
  assert.equal(html.includes('id="flowSessionDateTo"'), false);
  assert.equal(html.includes('id="flowSessionSearchInput"'), true);
  assert.equal(html.includes('data-flow-session-type="all"'), true);
  assert.equal(html.includes('data-flow-session-type="private"'), true);
  assert.equal(html.includes('data-flow-session-type="group"'), true);
  assert.equal(app.includes("flowSessionSearchInput"), true);
  assert.equal(app.includes("normalizedSessionSearch"), true);
  assert.equal(app.includes("flowSessionType(session) !== typeFilter"), true);
  assert.equal(app.includes("[data-flow-session-type].active"), true);
  assert.equal(html.includes('id="flowSessionAssetFilter"'), true);
  assert.equal(html.includes('id="flowSessionNodeFilter"'), true);
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
  assert.match(css, /\.flow-session-type-tabs\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.equal(css.includes(".flow-session-sidebar"), true);
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
  assert.match(css, /#proactivePanel\s*\{[\s\S]*height:\s*max\(560px,\s*calc\(100vh - 178px\)\)/);
  assert.match(css, /#proactivePanel\s+\.collapsible-content\s*\{[\s\S]*overflow:\s*hidden/);
  assert.match(css, /#flowSessionsPanel\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\)/);
});

test("proactive panel keeps send action pinned while content scrolls", () => {
  const proactivePanel = sectionHtml("proactivePanel");

  assert.match(proactivePanel, /class="proactive-form-body"[\s\S]*class="actions proactive-actions"/);
  assert.match(css, /#proactivePanel\s*\{[\s\S]*height:\s*max\(560px,\s*calc\(100vh - 178px\)\)/);
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

test("proactive targets do not render redundant selected chips", () => {
  const proactivePanel = sectionHtml("proactivePanel");

  assert.doesNotMatch(proactivePanel, /id="selectedTargets"/);
  assert.doesNotMatch(app, /target-chip/);
  assert.doesNotMatch(css, /\.selected-targets/);
  assert.doesNotMatch(css, /\.target-chip/);
  assert.match(app, /function renderSelectedTargets\(\)\s*\{\s*updateBulkActionButtons\(\);\s*\}/);
});

test("proactive target list keeps a fixed scrollable height", () => {
  const targetListRule = cssRule(".target-list");

  assert.match(targetListRule, /height:\s*168px/);
  assert.match(targetListRule, /overflow-y:\s*auto/);
  assert.doesNotMatch(targetListRule, /max-height/);
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
  assert.match(css, /\.upload-dropzone\s*\{[\s\S]*cursor:\s*pointer/);
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
  assert.match(proactivePanel, /id="proactiveSubmitButton"[\s\S]*创建并发送/);
  assert.match(app, /function setProactiveSubmitting\(submitting\)/);
  assert.match(app, /els\.proactiveSubmitButton\.disabled = submitting/);
  assert.match(app, /els\.proactiveUploadOverlay\.hidden = !submitting/);
  assert.match(app, /setProactiveSubmitting\(true\)[\s\S]*finally[\s\S]*setProactiveSubmitting\(false\)/);
  assert.match(css, /\.proactive-message-fields\.is-uploading\s*\{[\s\S]*pointer-events:\s*none/);
  assert.match(css, /\.proactive-upload-overlay\s*\{[\s\S]*position:\s*absolute/);
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

test("chat bubbles can show agent reply sources without sending them to customers", () => {
  assert.equal(app.includes("renderChatSources"), true);
  assert.equal(app.includes("message.rawPayload?.sources"), true);
  assert.equal(app.includes("chat-sources"), true);
  assert.equal(app.includes("sourceTypeIcon"), true);
  assert.equal(app.includes("sourceTypeShortLabel"), true);
  assert.equal(app.includes("chat-source-chip"), true);
  assert.equal(app.includes("icon(sourceTypeIcon(source.type))"), true);
  assert.equal(app.includes("sourceTypeShortLabel(source.type)"), true);
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
