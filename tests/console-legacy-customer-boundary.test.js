import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("console provides a history icon for the legacy customer badge", () => {
  assert.match(html, /id="icon-history"/);
  assert.match(js, /icon\("history"\)/);
});

test("legacy badge is limited to private legacy sessions above the customer name", () => {
  assert.match(js, /function renderLegacyCustomerBadge\(session, sessionType\)/);
  assert.match(js, /sessionType !== "private"/);
  assert.match(js, /session\?\.customerOrigin !== "legacy"/);
  assert.match(js, /class="legacy-customer-badge"/);
  assert.match(js, /<span>老客户<\/span>/);
  assert.match(
    js,
    /class="flow-session-name-row">[\s\S]*renderLegacyCustomerBadge\(session, sessionType\)[\s\S]*flow-session-name/
  );
  assert.match(css, /\.flow-session-name-row\s*\{[^}]*flex-direction:\s*column;[^}]*align-items:\s*flex-start;[^}]*justify-content:\s*center;/);
  assert.match(css, /\.legacy-customer-badge\s*\{[^}]*min-height:\s*15px;/);
});

test("legacy badge tooltip explains every history sync result", () => {
  assert.match(js, /function legacyHistoryStatusText\(session\)/);
  assert.match(js, /正在加载历史记录/);
  assert.match(js, /已加载历史记录 \$\{Number\(session\?\.historyImportedCount \|\| 0\)\} 条/);
  assert.match(js, /未查到历史，已按老客户接入/);
  assert.match(js, /历史加载失败，已按老客户接入/);
});

test("legacy badge uses handoff gold without card highlighting or sorting", () => {
  assert.match(css, /\.legacy-customer-badge\s*\{[^}]*#f59e0b/);
  assert.match(css, /\.legacy-customer-badge \.icon\s*\{[^}]*width:\s*9px/);
  assert.doesNotMatch(css, /\.flow-session-card\.is-legacy/);
  assert.doesNotMatch(js, /customerOrigin === "legacy" \? 1 : 0/);
});
