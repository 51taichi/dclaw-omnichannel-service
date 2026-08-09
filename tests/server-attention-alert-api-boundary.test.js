import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("attention alert API is Bot scoped and subscribes before loading snapshots", () => {
  for (const route of [
    '"/api/attention-alerts/stream"',
    '"/api/attention-alerts"',
    '"/api/attention-alerts/:alertId/read"'
  ]) assert.match(source, new RegExp(route.replaceAll("/", "\\/")));
  const streamStart = source.indexOf('"/api/attention-alerts/stream"');
  const streamEnd = source.indexOf("app.get(", streamStart + 10);
  const stream = source.slice(streamStart, streamEnd);
  assert.ok(stream.indexOf("assertBotAccess(req, botId)") < stream.indexOf("attentionAlertStreamHub.subscribe"));
  assert.match(stream, /loadSnapshot: \(\) => listUnreadAttentionAlerts/);
});

test("attention read commits before publishing", () => {
  const start = source.indexOf('"/api/attention-alerts/:alertId/read"');
  const end = source.indexOf("app.", start + 10);
  const route = source.slice(start, end < 0 ? source.length : end);
  assert.ok(route.indexOf("markAttentionAlertRead") < route.indexOf("attentionAlertStreamHub.publishRead"));
  assert.match(route, /status = 404/);
});

test("duplicate occurrences never publish realtime attention events", () => {
  const start = source.indexOf("function publishCommittedAttentionAlert");
  const end = source.indexOf("function scheduleNextTagActivationTask", start);
  const body = source.slice(start, end);
  assert.match(body, /result\.duplicate/);
  assert.ok(body.indexOf("result.duplicate") < body.indexOf("publishCreated"));
});

test("server periodically cleans only expired read attention alerts", () => {
  assert.match(source, /cleanupReadAttentionAlerts/);
  assert.match(source, /ATTENTION_ALERT_RETENTION_DAYS/);
  assert.match(source, /attention_alert\.cleanup/);
});
