import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");

test("debug auto-reply ignores stale bot configuration responses", () => {
  assert.match(app, /debugReplyLoadVersion: 0/);

  const start = app.indexOf("async function loadDebugReply");
  const end = app.indexOf("async function saveBot", start);
  const body = app.slice(start, end);

  assert.match(body, /const requestVersion = \+\+state\.debugReplyLoadVersion;/);
  assert.match(
    body,
    /requestVersion !== state\.debugReplyLoadVersion \|\|\s+state\.selectedBotId !== botId/
  );
});
