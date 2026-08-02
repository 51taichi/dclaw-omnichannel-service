import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const adminApp = fs.readFileSync(new URL("../public/admin/app.js", import.meta.url), "utf8");
const consoleApp = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const consoleHtml = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");

test("administrator debug auto-reply ignores stale Bot responses", () => {
  assert.match(adminApp, /debugReplyLoadVersion: 0/);

  const start = adminApp.indexOf("async function loadBotMaintenance");
  const end = adminApp.indexOf("async function saveBotAccessKey", start);
  const body = adminApp.slice(start, end);

  assert.match(body, /const requestVersion = \+\+state\.debugReplyLoadVersion;/);
  assert.match(
    body,
    /requestVersion !== state\.debugReplyLoadVersion \|\|\s+state\.selectedBotId !== botId/
  );
});

test("workspace console no longer owns debug auto-reply configuration", () => {
  assert.doesNotMatch(consoleHtml, /id="debugPanel"|id="debugReplyForm"/);
  assert.doesNotMatch(consoleApp, /settings\/debug-reply|loadDebugReply|saveDebugReply/);
});
