import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

function cssRule(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1);
  const end = css.indexOf("}", start);
  assert.notEqual(end, -1);
  return css.slice(start, end + 1);
}

test("console toast renders as a top notification with icon states", () => {
  assert.match(html, /<symbol id="icon-alert"/);
  assert.match(html, /<div id="toast" class="toast" role="status" aria-live="polite" hidden>/);
  assert.match(app, /const TOAST_CONFIG = \{/);
  assert.match(app, /success:\s*\{\s*icon:\s*"check"/);
  assert.match(app, /error:\s*\{\s*icon:\s*"alert"/);
  assert.match(app, /info:\s*\{\s*icon:\s*"info"/);
  assert.match(app, /function toast\(message,\s*type = inferToastType\(message\)\)/);
  assert.match(app, /els\.toast\.className = `toast toast-\$\{config\.type\}`/);
  assert.match(app, /<span class="toast-icon" aria-hidden="true">\$\{icon\(config\.icon\)\}<\/span>/);
  assert.match(app, /<span class="toast-message">\$\{escapeHtml\(message\)\}<\/span>/);
});

test("console toast uses top placement and distinct colors", () => {
  const toastRule = cssRule(".toast");

  assert.match(toastRule, /top:\s*18px/);
  assert.match(toastRule, /left:\s*50%/);
  assert.match(toastRule, /transform:\s*translateX\(-50%\)/);
  assert.doesNotMatch(toastRule, /bottom:/);
  assert.match(css, /\.toast-icon\s*\{/);
  assert.match(css, /\.toast-success\s*\{[\s\S]*--toast-color:\s*#0f8a5f/);
  assert.match(css, /\.toast-error\s*\{[\s\S]*--toast-color:\s*var\(--danger\)/);
  assert.match(css, /\.toast-info\s*\{[\s\S]*--toast-color:\s*var\(--accent\)/);
});

test("async console errors use failure toast styling", () => {
  assert.match(app, /function toastError\(error\)/);
  assert.doesNotMatch(app, /catch\(\(error\) => toast\(error\.message\)\)/);
  assert.match(app, /catch\(toastError\)/);
});
