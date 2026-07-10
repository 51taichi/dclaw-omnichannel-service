import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("console exposes handoff toggles on session cards and a right-side status banner", () => {
  assert.equal(html.includes('id="handoffStatusBanner"'), true);
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
  assert.equal(app.includes('title="人工接手中"'), true);
  assert.equal(css.includes(".flow-session-icons"), true);
  assert.equal(css.includes(".session-icon::after"), true);
  assert.equal(css.includes(".handoff-button"), true);
});

test("flow sessions can be filtered and human handoff sessions are pinned first", () => {
  assert.equal(html.includes('id="flowSessionDateFrom"'), true);
  assert.equal(html.includes('id="flowSessionDateTo"'), true);
  assert.equal(html.includes('id="flowSessionAssetFilter"'), true);
  assert.equal(html.includes('id="flowSessionNodeFilter"'), true);
  assert.equal(html.includes('id="flowSessionHandoffFilter"'), true);
  assert.equal(app.includes("getVisibleFlowSessions"), true);
  assert.equal(app.includes("sortFlowSessions"), true);
  assert.equal(app.includes('handoffStatus === "human"'), true);
  assert.equal(css.includes(".flow-session-filters"), true);
  assert.equal(css.includes(".handoff-status-banner"), true);
});

test("human handoff session cards have a clear pulsing highlight", () => {
  assert.equal(css.includes("@keyframes handoffPulse"), true);
  assert.equal(css.includes("animation: handoffPulse"), true);
  assert.equal(css.includes("@media (prefers-reduced-motion: reduce)"), true);
  assert.equal(css.includes(".flow-session-card.is-handoff .flow-session-name-row em"), true);
});
