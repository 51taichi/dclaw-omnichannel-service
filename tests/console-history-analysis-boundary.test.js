import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("history analysis settings are stored per Bot and normalized by the server", () => {
  assert.match(server, /function getHistoryAnalysisSettingKey\(botId\)/);
  assert.match(server, /history_analysis:\$\{String\(botId \|\| ""\)\.trim\(\)\}/);
  assert.match(server, /function getHistoryAnalysisConfig\(botId\)/);
  assert.match(server, /normalizeHistoryAnalysisConfig\(/);
  assert.match(server, /"\/api\/bots\/:botId\/settings\/history-analysis"/);
  assert.match(
    server,
    /assertAdminForBot\(req, req\.params\.botId\)[\s\S]*getHistoryAnalysisConfig\(req\.params\.botId\)/
  );
  assert.match(
    server,
    /setSetting\(getHistoryAnalysisSettingKey\(req\.params\.botId\), config\)/
  );
});

test("reply wait panel exposes the bounded historical customer text setting", () => {
  assert.doesNotMatch(html, /id="historyAnalysisPanel"/);
  assert.doesNotMatch(html, /id="historyAnalysisForm"/);
  assert.match(
    html,
    /id="replyWaitForm"[\s\S]*class="reply-wait-detail-row"[\s\S]*失败兜底话术[\s\S]*历史客户发言加载上限/
  );
  assert.match(html, /name="historyCustomerTextMaxChars"/);
  assert.match(html, /min="1000"/);
  assert.match(html, /max="6000"/);
  assert.match(html, /step="100"/);
  assert.match(html, /value="4000"/);
  assert.doesNotMatch(html, /保存历史分析配置/);
  assert.match(css, /\.reply-wait-detail-row\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
});

test("history analysis configuration follows the selected Bot context", () => {
  assert.match(app, /historyAnalysisLoadVersion: 0/);
  assert.match(app, /async function loadHistoryAnalysis/);
  assert.doesNotMatch(app, /async function saveHistoryAnalysis/);
  assert.match(
    app,
    /\/api\/bots\/\$\{encodeURIComponent\(botId\)\}\/settings\/history-analysis/
  );
  assert.match(app, /isCurrentBotContext\(botId, contextVersion\)/);
  assert.match(app, /historyCustomerTextMaxChars: Number\(/);
  assert.match(app, /els\.replyWaitForm\.historyCustomerTextMaxChars/);
});
