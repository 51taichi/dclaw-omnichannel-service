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
  assert.equal(app.includes("activationIntervalMinutes"), true);
  assert.equal(app.includes("activationMaxTimes"), true);
  assert.equal(app.includes("activationPolishByAgent"), true);
  assert.equal(app.includes("activationMessages"), true);
  assert.equal(app.includes("data-add-activation-message"), true);
  assert.equal(app.includes("data-remove-activation-message"), true);
  assert.equal(css.includes(".activation-editor"), true);
  assert.equal(css.includes(".activation-toolbar"), true);
});

test("flow config preserves node activation JSON through console and server normalization", () => {
  assert.equal(app.includes("activation: normalizeActivationDraft"), true);
  assert.equal(app.includes("node.activation || defaultActivationConfig()"), true);
  assert.equal(db.includes("activation: normalizeActivationConfig(node.activation)"), true);
});

test("adding an activation message keeps an editable blank draft row", () => {
  assert.equal(app.includes("activation.messages.push(\"\")"), false);
  assert.equal(app.includes("activation.messages = [...activation.messages, \"\"]"), true);
  assert.equal(app.includes("activationDraftForEditor(node.activation)"), true);
});
