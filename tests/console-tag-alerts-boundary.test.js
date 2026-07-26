import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");
const clientUrl = new URL("../public/console/tag-alert-client.js", import.meta.url);
const client = fs.existsSync(clientUrl) ? fs.readFileSync(clientUrl, "utf8") : "";
const audioPath = new URL("../public/console/assets/tag-voice-alert.mp3", import.meta.url);

test("tag voice alert template is a nonempty MP3 asset", () => {
  assert.equal(fs.existsSync(audioPath), true);
  const audio = fs.readFileSync(audioPath);
  assert.ok(audio.length > 1000);
  const startsWithId3 = audio.subarray(0, 3).toString("latin1") === "ID3";
  const startsWithMpegFrame = audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0;
  assert.equal(startsWithId3 || startsWithMpegFrame, true);
});

test("console exposes an accessible fixed tag alert center and preloaded audio", () => {
  assert.match(html, /id="tagAlertCenter"/);
  assert.match(html, /id="tagAlertButton"[^>]*aria-label="客户标签提醒"/);
  assert.match(html, /id="tagAlertCount"/);
  assert.match(html, /id="tagAlertPanel"[^>]*role="region"/);
  assert.match(html, /id="tagAlertList"[^>]*role="list"/);
  assert.match(
    html,
    /<audio[^>]*id="tagAlertAudio"[^>]*preload="auto"[^>]*src="\.\/assets\/tag-voice-alert\.mp3"/
  );
  assert.ok(
    html.indexOf('<script src="./tag-alert-client.js"></script>') <
      html.indexOf('<script src="./app.js"></script>')
  );
  assert.match(css, /\.tag-alert-center\s*\{[^}]*position:\s*fixed/);
  assert.match(css, /\.tag-alert-center\s*\{[^}]*bottom:\s*120px/);
  assert.match(
    css,
    /@media \(max-width:\s*760px\)\s*\{[\s\S]*\.tag-alert-center\s*\{[^}]*bottom:\s*104px/
  );
  assert.match(css, /\.tag-alert-button\s*\{[^}]*background:[^;}]*var\(--danger\)/);
  assert.match(css, /\.tag-alert-center\.has-unread:not\(\.is-paused\) \.tag-alert-button/);
  assert.match(css, /\.tag-alert-list\s*\{[^}]*overflow-y:\s*auto/);
});

test("tag alert client uses authenticated fetch streaming without polling", () => {
  assert.match(client, /global\.createTagAlertClient\s*=\s*createTagAlertClient/);
  assert.match(client, /fetchImpl\(streamUrl/);
  assert.match(client, /headers:\s*authHeaders/);
  assert.match(client, /response\.body\.getReader\(\)/);
  assert.match(client, /new AbortController\(\)/);
  assert.match(client, /controller\?\.abort\(\)/);
  assert.match(client, /\[1000,\s*2000,\s*4000,\s*10000\]/);
  assert.doesNotMatch(client, /EventSource/);
  assert.doesNotMatch(client, /setInterval/);
});

test("expired stream authentication stops retries and refreshes console auth", () => {
  assert.match(client, /onAuthExpired/);
  assert.match(client, /error\?\.status === 401/);
  assert.match(client, /onAuthExpired\?\.\(error\)/);
  assert.match(
    app,
    /onAuthExpired:\s*\(\)\s*=>\s*\{[\s\S]*expireBotSession\(botId\)[\s\S]*state\.apiKey[\s\S]*connectTagAlerts\(botId\)/
  );
});

test("tag alert client replaces snapshots silently and sounds once per created batch", () => {
  assert.match(client, /function replaceSnapshot\(\w+\)/);
  assert.match(client, /emitChange\("snapshot"\)/);
  assert.match(client, /function appendCreated\(payload\)/);
  assert.match(client, /if \(added\.length\) playSound\?\.\(added\)/);
  assert.match(client, /function removeRead\(payload\)/);
  assert.match(client, /alerts\.delete\(String\(payload\?\.alertId/);
  assert.match(client, /async function markRead\(alertId\)/);
  assert.match(client, /async function unlockAudio\(\)/);
});

test("alert UI pauses animation on hover or focus and opens evidence from a list item", () => {
  assert.match(app, /tagAlertCenter\?\.addEventListener\("mouseenter"/);
  assert.match(app, /tagAlertCenter\?\.addEventListener\("mouseleave"/);
  assert.match(app, /tagAlertCenter\?\.addEventListener\("focusin"/);
  assert.match(app, /tagAlertCenter\?\.addEventListener\("focusout"/);
  assert.match(app, /classList\.toggle\("is-paused"/);
  assert.match(app, /async function openTagAlert\(alert\)/);
  assert.match(app, /switchWorkspaceTab\("sessions"/);
  assert.match(app, /await openFlowSession\(alert\.conversationKey,\s*\{/);
  assert.match(app, /anchorMessageId:\s*alert\.evidenceMessageId/);
  assert.match(app, /alertTagName:\s*alert\.tagName/);
  assert.match(app, /await tagAlertClient\.markRead\(alert\.id\)/);
});

test("opening an alert resets every conversation filter before selecting the customer", () => {
  assert.match(app, /function resetFlowSessionFiltersForTagAlert\(\)/);
  assert.match(app, /dataset\.flowSessionType === "all"/);
  assert.match(app, /els\.flowSessionSearchInput\.value = ""/);
  assert.match(app, /els\.flowSessionNodeFilter\.value = "all"/);
  assert.match(app, /setFlowSessionTagFilterValues\(\[\],\s*\{\s*reload:\s*false\s*\}\)/);
  assert.match(app, /setFlowSessionDateTagFilterValue\(""\)/);
  assert.match(app, /await reloadFlowSessionsFromFirstPage\(\)/);
});

test("conversation evidence receives a stable anchor, explanation, and temporary highlight", () => {
  assert.match(
    app,
    /async function openFlowSession\(conversationKey,\s*\{[\s\S]*anchorMessageId = ""[\s\S]*alertTagName = ""/
  );
  assert.match(app, /params\.set\("anchorMessageId", String\(anchorMessageId\)\)/);
  assert.match(app, /data-message-id="\$\{escapeHtml\(message\.id\)\}"/);
  assert.match(app, /此消息触发「\$\{escapeHtml\(alertTagName\)\}」标签/);
  assert.match(app, /scrollIntoView\(\{\s*behavior:\s*"smooth",\s*block:\s*"center"\s*\}\)/);
  assert.match(app, /setTimeout\(\(\) =>[\s\S]*is-tag-evidence-highlight[\s\S]*3000\)/);
  assert.match(app, /原触发消息已不在会话记录中，已为您打开该客户的最新会话/);
  assert.match(css, /\.chat-bubble-row\.is-tag-evidence-highlight/);
  assert.match(css, /\.tag-evidence-note/);
});
