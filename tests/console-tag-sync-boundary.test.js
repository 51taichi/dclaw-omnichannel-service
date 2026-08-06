import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const client = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("console removes the retired external-contact tag synchronization UI", () => {
  for (const source of [html, client, css]) {
    assert.doesNotMatch(source, /tagSync|tag-sync|企微标签|夜间自动同步/);
  }
});

test("admin console configures and checks a Whapi channel", () => {
  const adminHtml = fs.readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
  const adminApp = fs.readFileSync(new URL("../public/admin/app.js", import.meta.url), "utf8");
  assert.match(adminHtml, /name="channelId"[^>]*required/);
  assert.match(adminHtml, /name="apiToken"[^>]*type="password"/);
  assert.match(adminHtml, /name="webhookSecret"[^>]*type="password"/);
  assert.match(adminHtml, /id="checkChannelHealthButton"/);
  assert.match(adminApp, /\/channel\/health-check/);
  assert.match(adminApp, /configureWebhook:\s*true/);
});
