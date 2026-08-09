import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");

test("console loads a distinct attention alert audio and client", () => {
  assert.match(html, /id="attentionAlertAudio"[\s\S]*attention-alert\.mp3/);
  assert.match(html, /attention-alert-client\.js/);
  assert.match(app, /createAttentionAlertClient/);
  assert.match(app, /attentionAlertAudio\.play/);
});

test("attention cards show merged count and navigate to their evidence", () => {
  assert.match(app, /alertType\s*===\s*"attention"/);
  assert.match(app, /occurrenceCount/);
  assert.match(app, /anchorMessageId:\s*alert\.evidenceMessageId/);
  assert.match(app, /此消息触发待处理提醒/);
  assert.match(app, /attentionAlertClient\.markRead/);
});

test("attention reminders use the shared item layout with an alert icon", () => {
  assert.match(app, /tag-alert-item tag-alert-item--attention/);
  assert.match(app, /class="reminder-item-icon"[\s\S]*href="#icon-alert"/);
  assert.match(app, /class="reminder-item-content"/);
  assert.match(app, /class="reminder-item-count"/);
  assert.match(app, /待处理：/);
});
