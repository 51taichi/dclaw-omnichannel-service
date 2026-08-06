import assert from "node:assert/strict";
import test from "node:test";
import {
  cockpitEventKey,
  createCockpitEventRecorder
} from "../src/cockpit-events.js";

test("event keys stay stable for the same source and differ across Bots", () => {
  const input = {
    botId: "bot-a",
    eventType: "customer_message",
    sourceType: "incoming_message",
    sourceId: "m-1"
  };
  assert.equal(
    cockpitEventKey(input),
    cockpitEventKey({ ...input })
  );
  assert.notEqual(
    cockpitEventKey(input),
    cockpitEventKey({ ...input, botId: "bot-b" })
  );
});

test("record is fail open when analytics persistence fails", async () => {
  const warnings = [];
  const recorder = createCockpitEventRecorder({
    appendEvent() {
      throw new Error("disk busy");
    },
    incrementCounter() {
      throw new Error("counter should not run");
    },
    logWarn(event, fields) {
      warnings.push({ event, fields });
    }
  });

  assert.doesNotThrow(() => recorder.record({
    botId: "bot-a",
    eventType: "customer_message",
    sourceType: "incoming_message",
    sourceId: "m-1",
    occurredAt: "2026-07-30T10:00:00.000Z"
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(warnings[0].event, "cockpit.event.failed");
});

test("event persistence is deferred beyond the core reply call stack", async () => {
  let persisted = false;
  const recorder = createCockpitEventRecorder({
    appendEvent() {
      persisted = true;
      return { inserted: true, eventId: 1 };
    },
    incrementCounter() {},
    logWarn() {}
  });

  recorder.record({
    botId: "bot-a",
    eventType: "customer_message",
    sourceType: "incoming_message",
    sourceId: "m-1"
  });

  assert.equal(persisted, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(persisted, true);
});

test("a newly inserted core event increments its daily counter once", async () => {
  const counters = [];
  let insertions = 0;
  const recorder = createCockpitEventRecorder({
    appendEvent() {
      insertions += 1;
      return { inserted: insertions === 1, eventId: 1 };
    },
    incrementCounter(input) {
      counters.push(input);
    },
    logWarn() {}
  });
  const event = {
    botId: "bot-a",
    eventType: "first_contact",
    sourceType: "first_contact",
    sourceId: "f-1",
    occurredAt: "2026-07-30T10:00:00.000Z"
  };

  recorder.record(event);
  recorder.record(event);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(counters, [{
    botId: "bot-a",
    localDate: "2026-07-30",
    metricKey: "new_customer",
    amount: 1
  }]);
});
