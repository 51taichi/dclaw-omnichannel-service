import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("legacy customer identity is limited to private session avatars", () => {
  assert.match(js, /const isLegacyCustomer = sessionType === "private" && session\?\.customerOrigin === "legacy"/);
  assert.match(js, /class="flow-session-card[^\n]*\$\{isLegacyCustomer \? "is-legacy" : ""\}/);
  assert.match(js, /class="flow-session-avatar-shell \$\{isLegacyCustomer \? "is-legacy" : ""\}"/);
  assert.match(js, /title="\$\{isLegacyCustomer \? "老客户" : ""\}"/);
  assert.doesNotMatch(js, /class="legacy-customer-badge"/);
  assert.doesNotMatch(js, /<span>老客户<\/span>/);
});

test("legacy customer avatar uses a gold gradient and native tooltip", () => {
  assert.match(css, /\.flow-session-avatar-shell\.is-legacy\s*\{[^}]*linear-gradient\([^}]*#f59e0b[^}]*cursor:\s*help/);
  assert.match(css, /\.flow-session-avatar-shell\.is-legacy \.flow-session-avatar\s*\{[^}]*mix-blend-mode:\s*multiply/);
});

test("legacy customer controls use gold borders and icons", () => {
  assert.match(css, /\.flow-session-card\.is-legacy :is\(\.flow-session-manual-tag-trigger,\s*\.flow-session-icons span\)\s*\{[^}]*#f59e0b[^}]*color:\s*#a16207/);
  assert.match(css, /\.flow-session-card\.is-legacy \.flow-session-switch\.handoff-switch\s*\{[^}]*#f59e0b/);
  assert.match(css, /\.flow-session-card\.is-legacy \.handoff-switch-option\s*\{[^}]*color:\s*#a16207/);
  assert.match(css, /\.flow-session-card\.is-legacy \.handoff-switch-thumb\s*\{[^}]*linear-gradient\([^}]*#f59e0b/);
});

test("legacy control treatment does not highlight or reorder the card", () => {
  assert.doesNotMatch(css, /\.flow-session-card\.is-legacy\s*\{/);
  assert.doesNotMatch(js, /customerOrigin === "legacy" \? 1 : 0/);
});
