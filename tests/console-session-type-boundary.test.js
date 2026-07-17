import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");

test("console classifies flow sessions by conversation key before groupName fallback", () => {
  assert.match(app, /function flowSessionType\(session\)/);
  assert.match(app, /conversationKey\.includes\(":group:"\)/);
  assert.match(app, /conversationKey\.includes\(":private:"\)/);
  assert.equal(app.includes("session?.groupName || roomType === 1 || roomType === 3"), false);
});

test("console derives flow session display names by session type", () => {
  assert.match(app, /function flowSessionDisplayName\(session\)/);
  assert.match(app, /flowSessionType\(session\) === "group"/);
  assert.match(app, /conversationKey\.split\(":"\)\.pop\(\)/);
  assert.equal(app.includes("const name = session.receivedName || session.conversationKey"), false);
});

test("console only renders the card handoff switch for private flow sessions", () => {
  assert.match(app, /const handoffSwitch = sessionType === "private"/);
  assert.match(app, /data-flow-handoff-switch=/);
  assert.match(app, /querySelectorAll\("\[data-flow-handoff-switch\]"\)/);
  assert.doesNotMatch(app, /data-flow-handoff=/);
  assert.doesNotMatch(app, /const handoffControl = sessionType === "private"/);
});

test("console does not apply private flow filters to group sessions", () => {
  assert.match(app, /function sessionUsesFlowFilters\(session\)/);
  assert.match(app, /return flowSessionType\(session\) === "private"/);
  assert.match(app, /const appliesFlowFilters = sessionUsesFlowFilters\(session\)/);
  assert.match(app, /if \(appliesFlowFilters && nodeFilter !== "all"/);
  assert.match(app, /if \(appliesFlowFilters && assetFilter === "pending"/);
  assert.match(app, /if \(appliesFlowFilters && assetFilter === "complete"/);
});

test("empty chat title follows the selected session type tab", () => {
  assert.match(app, /function emptyFlowSessionTitle\(\)/);
  assert.match(app, /const typeFilter = currentFlowSessionTypeFilter\(\)/);
  assert.match(app, /typeFilter === "group"/);
  assert.match(app, /请选择一个群聊会话/);
});
