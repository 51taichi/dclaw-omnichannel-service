import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("console exposes a handoff toggle in the active conversation header", () => {
  assert.equal(html.includes('id="handoffButton"'), true);
  assert.equal(app.includes("toggleSelectedConversationHandoff"), true);
  assert.equal(app.includes("/handoff"), true);
  assert.equal(app.includes("handoffStatus"), true);
});

test("flow session cards use compact icon metadata for task, assets, time, and handoff", () => {
  assert.equal(app.includes("flow-session-icons"), true);
  assert.equal(app.includes('title="当前任务：'), true);
  assert.equal(app.includes('title="资产：'), true);
  assert.equal(app.includes('title="最近消息：'), true);
  assert.equal(app.includes('title="人工接手中"'), true);
  assert.equal(css.includes(".flow-session-icons"), true);
  assert.equal(css.includes(".handoff-button"), true);
});
