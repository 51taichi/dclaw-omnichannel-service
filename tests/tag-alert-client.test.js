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
globalThis.clearTimeout = (timer) => {
  if (timer) timer.canceled = true;
};
globalThis.window = {
  fetch: async () => new Response("", { status: 500 })
};

await import("../public/console/tag-alert-client.js");

test.after(() => {
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  delete globalThis.window;
});

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve));
}

test.beforeEach(() => {
  scheduled.length = 0;
});

test("401 expires authentication and does not schedule another stream request", async () => {
  const authErrors = [];
  let calls = 0;
  const client = window.createTagAlertClient({
    fetchImpl: async () => {
      calls += 1;
      return new Response("", { status: 401 });
    },
    onAuthExpired: (error) => authErrors.push(error)
  });

  client.connect({
    botId: "bot-a",
    headers: { "x-bot-session-token": "stale" }
  });
  await flushPromises();

  assert.equal(calls, 1);
  assert.equal(authErrors.length, 1);
  assert.equal(authErrors[0].status, 401);
  assert.equal(scheduled.filter((timer) => !timer.canceled).length, 0);
});

test("non-authentication stream failures retain reconnect backoff", async () => {
  let calls = 0;
  const client = window.createTagAlertClient({
    fetchImpl: async () => {
      calls += 1;
      return new Response("", { status: 503 });
    }
  });

  client.connect({ botId: "bot-a", headers: { "x-api-key": "admin" } });
  await flushPromises();

  const reconnect = scheduled.find((timer) => !timer.canceled);
  assert.equal(calls, 1);
  assert.equal(reconnect.delay, 1000);

  reconnect.callback();
  await flushPromises();
  assert.equal(calls, 2);
  client.disconnect();
});
