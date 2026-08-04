import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(
  new URL("../public/console/group-automation-status.js", import.meta.url),
  "utf8"
);
const context = vm.createContext({});
vm.runInContext(source, context);
const resolveStatus = context.resolveGroupAutomationDisplayStatus;
const resolveTypeLabel = context.resolveGroupAutomationTypeLabel;

test("first condition evaluation is operational loading rather than a false business state", () => {
  assert.deepEqual({ ...resolveStatus({
    taskType: "conditional_push",
    conditionText: "今天是否交作业",
    currentState: null,
    evaluationError: ""
  }) }, {
    label: "正在判断",
    className: "loading",
    iconName: "clock",
    business: false
  });
});

test("task type owns the fixed or conditional push label without duplicating status", () => {
  assert.equal(resolveTypeLabel({
    taskType: "conditional_push",
    conditionText: "",
    currentState: null
  }), "固定推送");
  assert.equal(resolveStatus({
    taskType: "conditional_push",
    conditionText: "",
    currentState: null
  }), null);
  assert.equal(resolveTypeLabel({
    taskType: "conditional_push",
    conditionText: "今天是否交作业"
  }), "条件推送");
  assert.equal(resolveTypeLabel({
    taskType: "periodic_summary"
  }), "周期汇总");
});

test("evaluated conditions retain their business states", () => {
  assert.equal(resolveStatus({
    taskType: "conditional_push",
    conditionText: "今天是否交作业",
    currentState: { achieved: false }
  }).label, "尚未达成");
  assert.equal(resolveStatus({
    taskType: "conditional_push",
    conditionText: "今天是否交作业",
    currentState: { achieved: true }
  }).label, "已达成");
});

test("first evaluation failure remains operational metadata, not a third business state", () => {
  const status = resolveStatus({
    taskType: "conditional_push",
    conditionText: "今天是否交作业",
    currentState: null,
    evaluationError: "Agent timeout"
  });
  assert.equal(status.label, "判断暂不可用");
  assert.equal(status.business, false);
});
