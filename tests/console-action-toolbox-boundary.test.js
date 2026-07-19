import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("console exposes a fixed universal action toolbox", () => {
  assert.equal(app.includes("actionToolboxOpen"), true);
  assert.equal(app.includes("renderActionToolbox"), true);
  assert.equal(app.includes("openActionToolbox"), true);
  assert.equal(app.includes("insertActionIntoFocusedTarget"), true);
  assert.equal(app.includes('icon("tool")'), true);
  assert.equal(app.includes("插入拉群动作 chip"), false);
  assert.equal(app.includes("插入到激活话术"), false);
  assert.equal(app.includes("data-action-toolbox-tool"), false);
  assert.equal(app.includes("data-action-toolbox-group-name"), true);
  assert.equal(app.includes("邀请入群"), true);
  assert.equal(app.includes('class="field-label">${icon("users")}邀请入群</span>'), true);
  assert.equal(app.includes("showMessageHistory: true"), true);
  assert.equal(css.includes(".action-toolbox"), true);
  assert.equal(css.includes("position: fixed"), true);
  assert.match(css, /\.action-toolbox-toggle\s*\{[\s\S]*background:\s*linear-gradient\(90deg,\s*var\(--danger\),\s*var\(--orange\)\)/);
  assert.match(css, /\.action-toolbox-toggle:hover\s*\{[\s\S]*background:\s*linear-gradient\(90deg,\s*var\(--danger-dark\),\s*var\(--danger\),\s*var\(--orange\)\)/);
});

test("toolbox targets activation textareas without rendering node completion action panels", () => {
  assert.equal(app.includes("focusedActionTarget"), true);
  assert.equal(app.includes('kind: "node_complete"'), false);
  assert.equal(app.includes('kind: "activation_message"'), true);
  assert.equal(app.includes("data-action-target-node"), false);
  assert.equal(app.includes("data-action-target-activation"), true);
  assert.equal(app.includes("完成动作"), false);
  assert.equal(app.includes("点击后从右侧工具箱插入动作"), false);
});

test("activation toolbox insertion uses textual action chips and save strips them", () => {
  assert.equal(app.includes("serializeActionChipForEditor"), true);
  assert.equal(app.includes("extractActionChipsFromEditorText"), true);
  assert.equal(app.includes("stripActionChipsFromEditorText"), true);
  assert.equal(app.includes("formatActivationMessageForEditor"), true);
  assert.equal(app.includes("[动作：拉入 "), true);
  assert.equal(app.includes("setRangeText"), true);
});

test("local action add buttons are removed in favor of the toolbox", () => {
  assert.equal(app.includes("data-add-node-action"), false);
  assert.equal(app.includes("data-add-activation-action"), false);
  assert.equal(app.includes("activation-message-flow-actions"), false);
});
