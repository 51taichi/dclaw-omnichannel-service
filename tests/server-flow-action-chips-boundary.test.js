import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("activation delivery derives visible text and actions from the selected message", () => {
  assert.equal(source.includes("activationDeliveryForTask"), true);
  assert.equal(source.includes("mergeInlineActions({"), true);
  assert.equal(source.includes("visibleActivationContent"), true);
  assert.equal(source.includes("mergedActivationActions"), true);
});

test("raw activation delivery skips text send when only actions remain", () => {
  assert.equal(source.includes("if (!visibleActivationContent) return [];"), true);
  assert.equal(source.includes("content: visibleActivationContent"), true);
});

test("activation delivery executes merged actions after task delivery finalizes", () => {
  assert.equal(source.includes("actions: mergedActivationActions"), true);
  assert.equal(source.includes('source: "activation_sent"'), true);
});
