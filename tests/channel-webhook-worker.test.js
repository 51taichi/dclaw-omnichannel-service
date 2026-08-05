import assert from "node:assert/strict";
import test from "node:test";

import { ChannelError } from "../src/channels/errors.js";
import { createChannelWebhookWorker } from "../src/channels/webhook-worker.js";

function row(overrides = {}) {
  return {
    id: 1, provider: "whapi", botId: "bot-a", channelAccountId: "CHAN-A",
    payload: { event: { type: "messages", event: "post" }, messages: [] }, attempts: 1,
    ...overrides
  };
}

test("webhook worker normalizes and dispatches every event before completion", async () => {
  const calls = [];
  const worker = createChannelWebhookWorker({
    owner: "worker-1",
    claim: () => [row()],
    normalize: (claimed) => [{ eventId: "one", source: claimed.id }, { eventId: "two", source: claimed.id }],
    dispatch: async (event, claimed) => calls.push(["dispatch", event.eventId, claimed.id]),
    complete: (input) => calls.push(["complete", input.id, input.owner]),
    fail: () => assert.fail("must not fail")
  });
  assert.deepEqual(await worker.tick(), { claimed: 1, completed: 1, failed: 0 });
  assert.deepEqual(calls, [
    ["dispatch", "one", 1],
    ["dispatch", "two", 1],
    ["complete", 1, "worker-1"]
  ]);
});

test("webhook worker terminates invalid provider events and retries temporary failures", async () => {
  const failures = [];
  let batch = [row({ id: 1 }), row({ id: 2 })];
  const worker = createChannelWebhookWorker({
    owner: "worker-1",
    claim: () => { const value = batch; batch = []; return value; },
    normalize: (claimed) => {
      if (claimed.id === 1) throw new ChannelError("invalid_provider_response");
      return [{ eventId: "temporary" }];
    },
    dispatch: async () => { throw new ChannelError("temporary_provider_failure", undefined, { retryable: true }); },
    complete: () => assert.fail("must not complete"),
    fail: (input) => failures.push(input),
    maxAttempts: 4,
    now: () => new Date("2026-08-06T10:00:00.000Z")
  });
  assert.deepEqual(await worker.tick(), { claimed: 2, completed: 0, failed: 2 });
  assert.equal(failures[0].retryable, false);
  assert.equal(failures[0].errorMessage, "invalid_provider_response");
  assert.equal(failures[1].retryable, true);
  assert.equal(failures[1].nextRetryAt, "2026-08-06T10:00:02.000Z");
});

test("webhook worker prevents overlapping ticks", async () => {
  let release;
  let claims = 0;
  const worker = createChannelWebhookWorker({
    claim: () => { claims += 1; return [row()]; },
    normalize: () => [{ eventId: "one" }],
    dispatch: () => new Promise((resolve) => { release = resolve; }),
    complete: () => {},
    fail: () => {}
  });
  const first = worker.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await worker.tick(), { skipped: true });
  release();
  await first;
  assert.equal(claims, 1);
});
