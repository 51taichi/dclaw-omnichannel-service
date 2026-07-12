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

test("console only renders handoff controls for private flow sessions", () => {
  assert.match(app, /const sessionType = flowSessionType\(session\)/);
  assert.match(app, /const handoffControl = sessionType === "private"/);
  assert.match(app, /\$\{handoffControl\}/);
});
