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

test("Config tab exposes a bounded historical customer text setting", () => {
  assert.match(html, /id="historyAnalysisPanel"/);
  assert.match(html, /历史智能分析/);
  assert.match(html, /id="historyAnalysisForm"/);
  assert.match(html, /class="history-text-limit-field"[\s\S]*历史客户发言加载上限/);
  assert.match(html, /name="historyCustomerTextMaxChars"/);
  assert.match(html, /min="1000"/);
  assert.match(html, /max="6000"/);
  assert.match(html, /step="100"/);
  assert.match(html, /value="4000"/);
  assert.match(html, /保存历史分析配置/);
  assert.match(css, /\.history-analysis-form\s*\{[^}]*grid-template-columns:\s*minmax\(320px,\s*420px\)\s+minmax\(0,\s*1fr\)/);
  assert.match(css, /\.history-text-limit-field\s*\{[^}]*grid-template-columns:\s*168px\s+minmax\(0,\s*1fr\)/);
});

test("history analysis configuration follows the selected Bot context", () => {
  assert.match(app, /historyAnalysisLoadVersion: 0/);
  assert.match(app, /historyAnalysisForm: document\.querySelector\("#historyAnalysisForm"\)/);
  assert.match(app, /async function loadHistoryAnalysis/);
  assert.match(app, /async function saveHistoryAnalysis/);
  assert.match(
    app,
    /\/api\/bots\/\$\{encodeURIComponent\(botId\)\}\/settings\/history-analysis/
  );
  assert.match(app, /isCurrentBotContext\(botId, contextVersion\)/);
  assert.match(app, /historyCustomerTextMaxChars: Number\(/);
  assert.match(app, /historyAnalysisForm\?\.addEventListener\("submit"/);
});
