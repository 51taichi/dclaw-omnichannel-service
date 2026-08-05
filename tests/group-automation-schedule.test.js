import assert from "node:assert/strict";
import test from "node:test";

import {
  groupAutomationCycleKey,
  groupAutomationCycleWindow,
  nextGroupAutomationRunAt,
  normalizeGroupAutomationSchedule
} from "../src/group-automation-schedule.js";

test("monthly schedule accepts days 1 through 28 and month_end only", () => {
  assert.deepEqual(normalizeGroupAutomationSchedule({
    cadence: "monthly",
    scheduleDays: [1, 15, "month_end", 15],
    timeOfDay: "20:30"
  }).scheduleDays, [1, 15, "month_end"]);

  for (const invalid of [0, 29, 30, 31, "31", "last"]) {
    assert.throws(() => normalizeGroupAutomationSchedule({
      cadence: "monthly",
      scheduleDays: [invalid],
      timeOfDay: "20:30"
    }), /monthly schedule day/);
  }
});

test("daily schedules reject trigger days and invalid Beijing times", () => {
  assert.deepEqual(normalizeGroupAutomationSchedule({
    cadence: "daily",
    scheduleDays: [],
    timeOfDay: "00:00"
  }), {
    cadence: "daily",
    scheduleDays: [],
    timeOfDay: "00:00"
  });
  assert.throws(() => normalizeGroupAutomationSchedule({
    cadence: "daily",
    scheduleDays: [1],
    timeOfDay: "09:00"
  }), /daily schedule day/);
  assert.throws(() => normalizeGroupAutomationSchedule({
    cadence: "daily",
    timeOfDay: "24:00"
  }), /timeOfDay/);
});

test("month_end resolves to the real Beijing month end", () => {
  assert.equal(nextGroupAutomationRunAt({
    cadence: "monthly",
    scheduleDays: ["month_end"],
    timeOfDay: "09:00"
  }, "2028-02-01T00:00:00.000Z"), "2028-02-29T01:00:00.000Z");
});

test("minimum lead time skips an otherwise imminent target", () => {
  const schedule = {
    cadence: "daily",
    scheduleDays: [],
    timeOfDay: "20:00"
  };
  assert.equal(
    nextGroupAutomationRunAt(schedule, "2026-08-05T11:55:00.000Z", { minimumLeadMs: 600_000 }),
    "2026-08-06T12:00:00.000Z"
  );
  assert.equal(
    nextGroupAutomationRunAt(schedule, "2026-08-05T11:49:59.999Z", { minimumLeadMs: 600_000 }),
    "2026-08-05T12:00:00.000Z"
  );
  assert.equal(
    nextGroupAutomationRunAt(schedule, "2026-08-05T11:50:00.000Z", { minimumLeadMs: 600_000 }),
    "2026-08-05T12:00:00.000Z"
  );
});

test("weekly selected days are independent and cycle starts Monday", () => {
  const schedule = {
    cadence: "weekly",
    scheduleDays: [1, 3, 5],
    timeOfDay: "20:00"
  };

  assert.equal(
    nextGroupAutomationRunAt(schedule, "2026-08-03T11:00:00.000Z"),
    "2026-08-03T12:00:00.000Z"
  );
  assert.equal(
    nextGroupAutomationRunAt(schedule, "2026-08-03T12:00:00.000Z"),
    "2026-08-05T12:00:00.000Z"
  );
  assert.equal(
    groupAutomationCycleKey("weekly", "2026-08-05T12:00:00.000Z"),
    "2026-W32"
  );
});

test("cycle windows use exclusive Beijing calendar boundaries", () => {
  assert.deepEqual(
    groupAutomationCycleWindow("daily", "2026-08-04T15:00:00.000Z"),
    {
      cycleKey: "2026-08-04",
      startAt: "2026-08-03T16:00:00.000Z",
      endAt: "2026-08-04T16:00:00.000Z"
    }
  );
  assert.deepEqual(
    groupAutomationCycleWindow("monthly", "2026-08-31T23:00:00.000Z"),
    {
      cycleKey: "2026-09",
      startAt: "2026-08-31T16:00:00.000Z",
      endAt: "2026-09-30T16:00:00.000Z"
    }
  );
});
