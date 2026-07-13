import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");

test("clearing Bot-scoped content does not reference a removed proactive URL default", () => {
  assert.doesNotMatch(app, /DEFAULT_FILE_URL/);
  assert.match(app, /els\.proactiveForm\.fileUrl\.value = "";/);
});

test("expired Bot sessions are cleared when a scoped request is unauthorized", () => {
  assert.match(app, /function expireBotSession\(botId\)/);
  assert.match(app, /response\.status === 401 && usedBotSession/);
  assert.match(app, /expireBotSession\(effectiveBotId\)/);
  assert.match(app, /throw new Error\("Bot 解锁已失效，请重新解锁"\)/);
});
