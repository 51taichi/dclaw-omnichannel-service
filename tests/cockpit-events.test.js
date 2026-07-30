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

test("record is fail open when analytics persistence fails", () => {
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
  assert.equal(warnings[0].event, "cockpit.event.failed");
});

test("a newly inserted core event increments its daily counter once", () => {
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
    eventType: "friend_added",
    sourceType: "friend_added",
    sourceId: "f-1",
    occurredAt: "2026-07-30T10:00:00.000Z"
  };

  recorder.record(event);
  recorder.record(event);

  assert.deepEqual(counters, [{
    botId: "bot-a",
    localDate: "2026-07-30",
    metricKey: "new_customer",
    amount: 1
  }]);
});

