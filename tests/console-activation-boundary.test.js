import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const db = fs.readFileSync(new URL("../src/db.js", import.meta.url), "utf8");

test("flow node editor supports activation settings", () => {
  assert.equal(app.includes("defaultActivationConfig"), true);
  assert.equal(app.includes("activationDraftForEditor"), true);
  assert.equal(app.includes("activationEnabled"), true);
  assert.equal(app.includes("activationPolishByAgent"), true);
  assert.equal(app.includes("activationMessages"), true);
  assert.equal(app.includes("formatActivationMessageForEditor(activationMessage)"), true);
  assert.equal(app.includes("data-activation-message-interval"), true);
  assert.equal(app.includes("data-activation-message-max-times"), true);
  assert.equal(app.includes("data-add-activation-message"), true);
  assert.equal(app.includes("data-remove-activation-message"), true);
  assert.equal(app.includes("activation-help-icon"), true);
  assert.equal(app.includes("例：10 分钟后发第 1 条"), true);
  assert.equal(app.includes("activation-message-control"), true);
  assert.equal(app.includes("activation-message-unit"), true);
  assert.equal(app.includes(">分钟<"), true);
  assert.equal(app.includes(">次<"), true);
  assert.equal(css.includes(".activation-editor"), true);
  assert.equal(css.includes(".activation-toolbar"), true);
  assert.equal(css.includes(".activation-help-icon::after"), false);
  assert.equal(html.includes("data-tooltip="), false);
  assert.equal(app.includes("data-tooltip="), false);
  assert.equal(html.includes('title="当前等待时间 = 回复等待间隔'), true);
  assert.match(app, /class="activation-help-icon"[^>]*title="\$\{escapeHtml\(/);
  assert.equal(css.includes(".activation-message-card {"), true);
  assert.equal(css.includes(".activation-message-actions"), true);
  assert.equal(css.includes(".activation-message-control"), true);
  assert.equal(css.includes("border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--line));"), true);
});

test("flow config preserves node activation JSON through console and server normalization", () => {
  assert.equal(app.includes("activation: normalizeActivationDraft"), true);
  assert.equal(app.includes("node.activation || defaultActivationConfig()"), true);
  assert.equal(db.includes("activation: normalizeActivationConfig(node.activation)"), true);
});

test("flow editor preserves the top-level general business rule", () => {
  assert.equal(app.includes('els.flowMachineForm.generalRule.value = config.generalRule || "";'), true);
  assert.equal(app.includes('generalRule: String(els.flowMachineForm.generalRule?.value || "").trim()'), true);
  assert.equal(app.includes('els.flowMachineForm.generalRule?.addEventListener("input", syncFlowJsonTextarea)'), true);
  assert.equal(db.includes('generalRule: String(config.generalRule || "").trim()'), true);
  assert.equal(html.includes('name="generalRule"'), true);
  assert.match(html, /<div class="expand-field-slot">\s*<label class="flow-general-rule">/);
  assert.match(html, /<textarea class="expand-on-focus" name="generalRule"/);
  assert.match(html, /field-label"><svg class="icon"[^>]*><use href="#icon-briefcase"><\/use><\/svg>任务名称/);
  assert.match(html, /field-label"><svg class="icon"[^>]*><use href="#icon-info"><\/use><\/svg>通用规则/);
  assert.match(css, /\.expand-field-slot\s*\{[\s\S]*height:\s*40px/);
  assert.match(css, /\.expand-field-slot > label\s*\{[\s\S]*position:\s*absolute/);
  assert.match(css, /\.expand-field-slot > label:focus-within\s*\{[\s\S]*height:\s*112px/);
  assert.equal(css.includes(".expand-on-focus"), true);
  assert.equal(css.includes(".expand-on-focus:focus"), true);
  assert.equal(css.includes("height: 112px;"), true);
  assert.equal(css.includes(".flow-general-rule:focus-within textarea"), false);
});

test("node text fields reuse the fixed-slot expanding textarea", () => {
  assert.equal(app.includes("function renderFlowNodeExpandableField(node, definition)"), true);
  assert.equal(app.includes('class="expand-field-slot" data-flow-node-expand-field="${escapeHtml(definition.field)}"'), true);
  assert.equal(app.includes('class="expand-on-focus" data-flow-node-field="${escapeHtml(definition.field)}"'), true);
  assert.equal(app.includes('flowNodeQuickFields.map((definition) => renderFlowNodeExpandableField(node, definition))'), true);
  for (const field of ["goal", "completionCriteria", "collectFields", "conversationTips"]) {
    assert.equal(app.includes(`field: "${field}"`), true);
  }
});

test("legacy console string scripts inherit their activation timing defaults", () => {
  assert.equal(app.includes("normalizeActivationMessageDraft(item, defaults)"), true);
  assert.equal(app.includes("intervalMinutes: normalizeActivationIntervalMinutes(source.intervalMinutes, defaults.intervalMinutes)"), true);
  assert.equal(app.includes("maxTimes: Math.max(1, Number(source.maxTimes ?? defaults.maxTimes))"), true);
});

test("flow and tag activation editors preserve zero minutes as a five-second delay", () => {
  assert.equal(app.includes("function normalizeActivationIntervalMinutes(value, fallback = 30)"), true);
  assert.equal(
    app.includes('data-tag-activation-message-interval type="number" min="0"'),
    true
  );
  assert.equal(
    app.includes('data-activation-message-interval type="number" min="0"'),
    true
  );
  assert.equal(
    app.includes("message.intervalMinutes = normalizeActivationIntervalMinutes(input.value, message.intervalMinutes)"),
    true
  );
  assert.equal(app.includes("填 0 则按 5 秒倒计时"), true);
});

test("adding an activation message keeps an editable blank draft row", () => {
  assert.equal(app.includes("defaultActivationMessage()"), true);
  assert.equal(app.includes("activation.messages = [...activation.messages, defaultActivationMessage()]"), true);
  assert.equal(app.includes("activationDraftForEditor(node.activation)"), true);
});

test("new flow nodes persist one default activation script", () => {
  assert.equal(app.includes("activation: { ...defaultActivationConfig(), messages: [defaultActivationMessage()] }"), true);
});

test("activation help explains the effective outbound-message timing anchor", () => {
  assert.equal(app.includes("例：10 分钟后发第 1 条"), true);
  assert.equal(app.includes("Agent 组织语言会先润色话术"), true);
});

test("activation editor hides trigger choice and does not preserve legacy trigger", () => {
  assert.equal(app.includes('data-flow-node-activation-field="trigger"'), false);
  assert.equal(app.includes('value="friend_added"'), false);
  assert.equal(app.includes("触发时机"), false);
  assert.equal(app.includes('trigger: source.trigger === "friend_added"'), false);
});

test("flow editor preserves a configured entry node that is not the first node", () => {
  assert.equal(app.includes("const configuredEntryNodeId = String(config.entryNodeId || \"\").trim();"), true);
  assert.equal(app.includes("renderFlowNodeEditor(configuredEntryNodeId);"), true);
  assert.equal(app.includes("const selectedEntryNodeId = String(els.flowMachineForm.entryNodeId.value || \"\").trim();"), true);
  assert.equal(app.includes("entryNodeId: nodes.some((node) => node.id === selectedEntryNodeId)"), true);
});

test("flow nodes can be reordered by dragging and then relink sequentially", () => {
  assert.equal(html.includes('id="icon-grip"'), true);
  assert.equal(app.includes("function relinkFlowDraftNodesSequentially()"), true);
  assert.match(app, /node\.nextNodeId = flowDraftNodes\[index \+ 1\]\?\.id \|\| ""/);
  assert.equal(app.includes("function swapFlowDraftNodes(fromIndex, toIndex)"), true);
  assert.equal(app.includes("[flowDraftNodes[fromIndex], flowDraftNodes[toIndex]] = [flowDraftNodes[toIndex], flowDraftNodes[fromIndex]]"), true);
  assert.equal(app.includes("data-flow-node-drag-handle"), true);
  assert.equal(app.includes("startFlowNodeDrag(event, handle)"), true);
  assert.equal(app.includes("flow-node-drag-ghost"), true);
  assert.equal(app.includes("is-drag-placeholder"), true);
  assert.equal(app.includes("is-swap-preview"), true);
  assert.equal(app.includes("findFlowNodeDragTarget(event.clientX, event.clientY)"), true);
  assert.equal(app.includes("swapFlowDraftNodes(sourceIndex, targetIndex)"), true);
  assert.match(css, /\.flow-node-card-head\s*\{[\s\S]*grid-template-columns:\s*28px minmax\(120px,\s*220px\) minmax\(0,\s*1fr\) auto/);
  assert.equal(css.includes(".flow-node-drag-handle"), true);
  assert.equal(css.includes(".flow-node-card.is-drag-placeholder"), true);
  assert.equal(css.includes(".flow-node-drag-ghost"), true);
});
