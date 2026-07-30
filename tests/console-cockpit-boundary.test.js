import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("cockpit is the first workspace tab and config is last", () => {
  const names = [...html.matchAll(/data-workspace-tab="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(names, [
    "cockpit",
    "sessions",
    "flow",
    "groups",
    "tags",
    "push",
    "logs",
    "config"
  ]);
});

test("unlocked Bot contexts default to the cockpit", () => {
  const fallbackStart = app.indexOf("function updateWorkspaceTabAccess");
  const fallbackEnd = app.indexOf("\n}\n\nfunction tabForPanel", fallbackStart);
  const fallbackSource = app.slice(fallbackStart, fallbackEnd);
  assert.match(fallbackSource, /switchWorkspaceTab\("cockpit",\s*\{\s*force:\s*true\s*\}\)/);
  assert.doesNotMatch(fallbackSource, /"config"\s*:\s*"sessions"/);
});

test("cockpit exposes an icon, Bot-themed shell, and dedicated client", () => {
  assert.match(html, /<symbol id="icon-cockpit"/);
  assert.match(html, /data-tab-panel="cockpit"/);
  assert.match(html, /id="cockpitLoadingState"/);
  assert.match(html, /id="cockpitStaleState"/);
  assert.match(html, /id="cockpitContent"/);
  assert.match(html, /src="\.\/cockpit\.js"/);
  assert.match(css, /\.cockpit-shell/);
  assert.match(css, /var\(--bot-accent/);
});

