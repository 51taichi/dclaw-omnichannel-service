import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const client = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

function functionBody(name) {
  const start = client.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const next = client.indexOf("\nfunction ", start + 1);
  return client.slice(start, next === -1 ? client.length : next);
}

test("Bot config contains an admin-only nightly tag sync panel", () => {
  assert.match(html, /id="tagSyncPanel"[^>]*admin-only-panel/);
  assert.match(html, /夜间自动同步/);
  assert.match(html, /id="tagSyncDateTagsEnabled"[^>]*name="syncDateTags"[^>]*type="checkbox"/);
  assert.match(html, /同步添加日期标签/);
  assert.match(client, /els\.tagSyncNightlyEnabled\.checked = true/);
  assert.match(client, /els\.tagSyncDateTagsEnabled\.checked = false/);
  assert.match(html, /id="tagSyncWindowStart"[^>]*><\/select>/);
  assert.match(html, /id="tagSyncWindowEnd"[^>]*><\/select>/);
  assert.match(html, /id="tagSyncRunButton"[^>]*class="[^"]*tag-sync-run-button/);
  assert.match(html, /id="tagSyncResult"[^>]*aria-live="polite"[^>]*hidden/);
  assert.doesNotMatch(html, /id="tagSyncWindow(?:Start|End)"[^>]*type="time"/);
});

test("night schedule options are restricted and stale Bot loads are ignored", () => {
  const optionsBody = functionBody("buildNightTagSyncTimeOptions");
  assert.match(optionsBody, /22 \* 60/);
  assert.match(optionsBody, /32 \* 60/);
  assert.match(optionsBody, /次日/);

  const loadBody = functionBody("loadTagSyncConfig");
  assert.match(loadBody, /requestVersion/);
  assert.match(loadBody, /state\.tagSyncLoadVersion/);
  assert.match(loadBody, /state\.selectedBotId !== botId/);
  assert.match(loadBody, /Promise\.all/);
});

test("night automation disables only schedule selects and validates forward windows", () => {
  const toggleBody = functionBody("syncTagSyncScheduleFields");
  assert.match(toggleBody, /tagSyncWindowStart\.disabled = !enabled/);
  assert.match(toggleBody, /tagSyncWindowEnd\.disabled = !enabled/);
  assert.doesNotMatch(toggleBody, /tagSyncRunButton\.disabled/);
  assert.doesNotMatch(toggleBody, /tagSyncDateTagsEnabled\.disabled/);

  const endOptionsBody = functionBody("syncTagSyncEndOptions");
  assert.match(endOptionsBody, /canonicalNightMinutes/);
  assert.match(endOptionsBody, /option\.disabled = optionMinutes <= startMinutes/);
});

test("date tag synchronization switch loads and saves independently", () => {
  assert.match(client, /tagSyncDateTagsEnabled:\s*document\.querySelector\("#tagSyncDateTagsEnabled"\)/);

  const applyBody = functionBody("applyTagSyncConfig");
  assert.match(applyBody, /tagSyncDateTagsEnabled\.checked = Boolean\(config\.syncDateTags\)/);

  const saveBody = functionBody("saveTagSyncConfig");
  assert.match(saveBody, /syncDateTags:\s*els\.tagSyncDateTagsEnabled\.checked/);
});

test("manual synchronization locks the button and follows the background run", () => {
  const runBody = functionBody("runTagSyncNow");
  assert.match(runBody, /立即同步企微标签/);
  assert.match(runBody, /收到客户消息时会自动暂停/);
  assert.match(runBody, /openConfirmation/);
  assert.match(runBody, /\/tag-sync\/run/);
  assert.match(runBody, /trackTagSyncRun/);
  assert.doesNotMatch(runBody, /finally[\s\S]*tagSyncRunButton\.disabled = false/);

  const trackBody = functionBody("trackTagSyncRun");
  assert.match(trackBody, /setTagSyncBusy\(true\)/);
  assert.match(trackBody, /\/tag-sync\/status/);
  assert.match(trackBody, /new Set\(\["completed", "stopped", "failed"\]\)/);
  assert.match(trackBody, /setTimeout/);
  assert.match(trackBody, /renderTagSyncResult/);
  assert.match(trackBody, /setTagSyncBusy\(false\)/);

  assert.match(css, /\.tag-sync-form\s*\{[\s\S]*grid-template-columns:/);
  assert.match(css, /\.tag-sync-result\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1/);
  assert.match(css, /\.tag-sync-run-button\.is-syncing \.icon\s*\{[\s\S]*animation:/);
  assert.match(css, /@media \(max-width:\s*980px\)[\s\S]*\.tag-sync-form/);
});

test("loading tag sync config resumes only an active run instead of rendering stale counts", () => {
  const loadBody = functionBody("loadTagSyncConfig");
  assert.match(loadBody, /statusData\.status\?\.activeRun/);
  assert.match(loadBody, /trackTagSyncRun/);
  assert.doesNotMatch(loadBody, /renderTagSyncStatus/);
});
