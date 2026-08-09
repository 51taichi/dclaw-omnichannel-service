import assert from "node:assert/strict";
import test from "node:test";

const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const scheduled = [];
globalThis.setTimeout = (callback, delay) => {
  const timer = { callback, delay, canceled: false };
  scheduled.push(timer);
  return timer;
};
globalThis.clearTimeout = (timer) => { if (timer) timer.canceled = true; };
globalThis.window = { fetch: async () => new Response("", { status: 500 }) };
await import("../public/console/attention-alert-client.js");

test.after(() => {
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  delete globalThis.window;
});

test("snapshot merge preserves an event received before the snapshot", () => {
  const states = [];
  const sounds = [];
  const client = window.createAttentionAlertClient({
    onChange: (alerts) => states.push(alerts),
    playSound: (alert) => sounds.push(alert.id)
  });
  client.applyCreated({ alert: { id: 7, occurrenceCount: 1 } });
  client.mergeSnapshot([]);
  assert.deepEqual(client.snapshot().map((alert) => alert.id), [7]);
  assert.deepEqual(sounds, [7]);
  client.applyUpdated({ alert: { id: 7, occurrenceCount: 2 } });
  assert.equal(client.snapshot()[0].occurrenceCount, 2);
  assert.deepEqual(sounds, [7]);
  client.applyRead({ alert: { id: 7, readAt: "now" } });
  assert.deepEqual(client.snapshot(), []);
  assert.ok(states.length >= 3);
});

test("401 stops attention stream reconnection", async () => {
  scheduled.length = 0;
  let authExpired = 0;
  const client = window.createAttentionAlertClient({
    fetchImpl: async () => new Response("", { status: 401 }),
    onAuthExpired: () => { authExpired += 1; }
  });
  client.connect({ botId: "bot-a", headers: { "x-api-key": "bad" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(authExpired, 1);
  assert.equal(scheduled.filter((timer) => !timer.canceled).length, 0);
});
