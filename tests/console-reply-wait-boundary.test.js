import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");

test("reply wait configuration is loaded and saved per selected Bot", () => {
  assert.match(app, /replyWaitLoadVersion: 0/);
  assert.match(app, /async function loadReplyWait/);
  assert.match(app, /async function saveReplyWait/);
  assert.match(app, /\/api\/bots\/\$\{encodeURIComponent\(botId\)\}\/settings\/reply-wait/);
  assert.match(app, /isCurrentBotContext\(botId, contextVersion\)/);
  assert.match(app, /fallbackReply/);
  assert.match(app, /fallbackReply:\s*els\.replyWaitForm\.fallbackReply\.value/);
});

test("reply wait panel explains the growing quiet-window formula", () => {
  assert.match(html, /消息\/等待回复/);
  assert.match(html, /name="fallbackReply"/);
  assert.match(html, /刚刚这边有点忙，我稍后回复你哈/);
  assert.match(html, /回复等待间隔（秒）/);
  assert.match(html, /累计秒数/);
  assert.match(html, /当前等待时间 = 回复等待间隔 \+（当前批次消息数 - 1）× 累计秒数/);
  assert.match(html, /第 2 条后重新等待 15 秒/);
  assert.match(html, /第 3 条后重新等待 20 秒/);
});
