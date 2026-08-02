import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("reply wait configuration is loaded and saved per selected Bot", () => {
  assert.match(app, /replyWaitLoadVersion: 0/);
  assert.match(app, /async function loadReplyWait/);
  assert.match(app, /async function saveReplyWait/);
  assert.match(app, /\/api\/bots\/\$\{encodeURIComponent\(botId\)\}\/settings\/reply-wait/);
  assert.match(app, /isCurrentBotContext\(botId, contextVersion\)/);
  assert.match(app, /fallbackReply/);
  assert.match(app, /fallbackReply:\s*els\.replyWaitForm\.fallbackReply\.value/);
  assert.match(
    app,
    /async function saveReplyWait[\s\S]*settings\/reply-wait[\s\S]*settings\/history-analysis/
  );
  assert.match(app, /historyCustomerTextMaxChars:\s*Number\(/);
});

test("reply wait panel explains the growing quiet-window formula", () => {
  assert.match(html, /消息\/等待回复/);
  assert.match(html, /name="fallbackReply"/);
  assert.match(html, /刚刚这边有点忙，我稍后回复你哈/);
  assert.doesNotMatch(html, /回复等待间隔（秒）/);
  assert.doesNotMatch(html, /class="field-label"[^>]*>[^<]*累计秒数/);
  assert.match(
    html,
    /<label class="field-with-unit">[\s\S]*?<use href="#icon-clock"><\/use><\/svg>回复等待间隔[\s\S]*?name="baseSeconds"[\s\S]*?<span class="field-unit">秒<\/span>/
  );
  assert.match(
    html,
    /<label class="field-with-unit">[\s\S]*?<use href="#icon-history"><\/use><\/svg>累计等待时间[\s\S]*?name="incrementSeconds"[\s\S]*?<span class="field-unit">秒<\/span>/
  );
  assert.match(html, /当前等待时间 = 回复等待间隔 \+（当前批次消息数 - 1）× 累计秒数/);
  assert.match(html, /第 2 条后重新等待 15 秒/);
  assert.match(html, /第 3 条后重新等待 20 秒/);
  assert.match(html, /<span class="field-label reply-wait-fallback-label">\s*<svg class="icon"[^>]*><use href="#icon-message"><\/use><\/svg>失败兜底话术[\s\S]*?response-wait-help[\s\S]*?<\/span>\s*<input name="fallbackReply"/);
  assert.match(css, /\.field-with-unit\s*\{[^}]*grid-template-columns:\s*132px minmax\(0,\s*1fr\) auto/);
  assert.match(css, /\.field-unit\s*\{[^}]*background:\s*var\(--panel-strong\)[^}]*border-left:\s*1px solid var\(--line\)/);
  assert.match(css, /\.reply-wait-fallback-label\s*\{[^}]*gap:\s*4px[^}]*padding:\s*0 9px/);
  assert.match(css, /\.response-wait-help\s*\{[^}]*width:\s*22px[^}]*height:\s*22px/);
});

test("visible configuration labels and switches are icon-led", () => {
  const configStart = html.indexOf('id="configTab"');
  const configEnd = html.indexOf('id="flowTab"', configStart);
  const configMarkup = html.slice(configStart, configEnd);
  const fieldLabels = [...configMarkup.matchAll(/<span class="field-label[^"]*">([\s\S]*?)<\/span>/g)]
    .map((match) => match[1]);

  assert.ok(fieldLabels.length > 0);
  for (const body of fieldLabels) assert.match(body, /<svg\b/);
  for (const [icon, label] of [
    ["send", "发送日报"],
    ["send", "发送周报"],
    ["send", "发送月报"],
    ["refresh", "夜间自动同步"],
    ["calendar", "同步添加日期标签"]
  ]) {
    assert.match(
      configMarkup,
      new RegExp(`<span class="switch-label"><svg class="icon"[^>]*><use href="#icon-${icon}"></use></svg>${label}</span>`)
    );
  }
});
