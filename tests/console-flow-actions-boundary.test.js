import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("console flow drafts preserve node and activation actions", () => {
  assert.equal(app.includes("defaultFlowAction"), true);
  assert.equal(app.includes("normalizeFlowActionDrafts"), true);
  assert.equal(app.includes("actionsOnComplete: normalizeFlowActionDrafts(node.actionsOnComplete || [])"), true);
  assert.equal(app.includes("const actionsAfterSend = normalizeFlowActionDrafts(source.actionsAfterSend || [])"), true);
  assert.equal(app.includes("actionsOnComplete: normalizeFlowActionDrafts(node.actionsOnComplete)"), true);
});

test("console renders action chips outside node and activation textareas", () => {
  assert.equal(app.includes("renderFlowActionChips"), true);
  assert.equal(app.includes('data-add-node-action="${index}"'), true);
  assert.equal(app.includes('data-add-activation-action="${index}:${messageIndex}"'), true);
  assert.equal(app.includes("data-node-action-group-name"), true);
  assert.equal(app.includes("data-activation-action-group-name"), true);
  assert.equal(app.includes("data-remove-node-action"), true);
  assert.equal(app.includes("data-remove-activation-action"), true);
  assert.equal(css.includes(".flow-action-chips"), true);
  assert.equal(css.includes(".flow-action-editor"), true);
  assert.equal(css.includes(".flow-action-chip"), true);
});

test("console action editors use structured invite-to-group fields", () => {
  assert.equal(app.includes('type: "invite_to_group"'), true);
  assert.equal(app.includes('target: "current_contact"'), true);
  assert.equal(app.includes("showMessageHistory"), true);
  assert.equal(app.includes("带聊天记录"), true);
  assert.equal(app.includes("群名"), true);
  assert.equal(app.includes("拉入群"), true);
});
