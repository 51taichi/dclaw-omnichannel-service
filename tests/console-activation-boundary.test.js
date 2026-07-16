import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");
const db = fs.readFileSync(new URL("../src/db.js", import.meta.url), "utf8");

test("flow node editor supports activation settings", () => {
  assert.equal(app.includes("defaultActivationConfig"), true);
  assert.equal(app.includes("activationDraftForEditor"), true);
  assert.equal(app.includes("activationEnabled"), true);
  assert.equal(app.includes("activationPolishByAgent"), true);
  assert.equal(app.includes("activationMessages"), true);
  assert.equal(app.includes("activationMessage.content"), true);
  assert.equal(app.includes("data-activation-message-interval"), true);
  assert.equal(app.includes("data-activation-message-max-times"), true);
  assert.equal(app.includes("data-add-activation-message"), true);
  assert.equal(app.includes("data-remove-activation-message"), true);
  assert.equal(app.includes("activation-help-icon"), true);
  assert.equal(app.includes("每条话术独立设置间隔和次数"), true);
  assert.equal(css.includes(".activation-editor"), true);
  assert.equal(css.includes(".activation-toolbar"), true);
  assert.equal(css.includes(".activation-help-icon::after"), true);
  assert.equal(css.includes(".activation-message-card {"), true);
  assert.equal(css.includes("border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--line));"), true);
});

test("flow config preserves node activation JSON through console and server normalization", () => {
  assert.equal(app.includes("activation: normalizeActivationDraft"), true);
  assert.equal(app.includes("node.activation || defaultActivationConfig()"), true);
  assert.equal(db.includes("activation: normalizeActivationConfig(node.activation)"), true);
});

test("legacy console string scripts inherit their activation timing defaults", () => {
  assert.equal(app.includes("normalizeActivationMessageDraft(item, defaults)"), true);
  assert.equal(app.includes("intervalMinutes: Math.max(1, Number(source.intervalMinutes ?? defaults.intervalMinutes))"), true);
  assert.equal(app.includes("maxTimes: Math.max(1, Number(source.maxTimes ?? defaults.maxTimes))"), true);
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
  assert.equal(app.includes("后续计时以最后一条有效机器人消息的发送时间为准"), true);
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
