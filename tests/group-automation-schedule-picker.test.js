import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(
  new URL("../public/console/group-automation-schedule-picker.js", import.meta.url),
  "utf8"
);
const context = {};
vm.runInNewContext(source, context);
const {
  MONTH_DAY_PAGES,
  clampMonthPage,
  monthPageForScheduleDays
} = context.GroupAutomationSchedulePicker;

test("monthly schedule dates are split into three stable pages", () => {
  assert.deepEqual([...MONTH_DAY_PAGES[0]], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual([...MONTH_DAY_PAGES[1]], [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  assert.deepEqual([...MONTH_DAY_PAGES[2]], [21, 22, 23, 24, 25, 26, 27, 28, "month_end"]);
});

test("editing a monthly task opens the page containing its earliest selection", () => {
  assert.equal(monthPageForScheduleDays([18, 3, "month_end"]), 0);
  assert.equal(monthPageForScheduleDays([18, 25]), 1);
  assert.equal(monthPageForScheduleDays(["month_end"]), 2);
  assert.equal(monthPageForScheduleDays([]), 0);
});

test("month page indexes clamp at the first and last page", () => {
  assert.equal(clampMonthPage(-1), 0);
  assert.equal(clampMonthPage(1), 1);
  assert.equal(clampMonthPage(3), 2);
  assert.equal(clampMonthPage(Number.NaN), 0);
});
