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

test("task type labels contain only the two supported group task types", () => {
  assert.equal(resolveTypeLabel({ taskType: "conditional_push" }), "条件推送");
  assert.equal(resolveTypeLabel({ taskType: "periodic_summary" }), "周期汇总");
});

test("a task without an occurrence is a countdown rather than a live condition judgment", () => {
  assert.deepEqual({ ...resolveStatus({
    enabled: true,
    nextRunAt: "2026-08-05T04:00:00.000Z",
    latestOccurrence: null
  }) }, {
    key: "countdown",
    label: "倒计时",
    className: "countdown",
    iconName: "clock"
  });
});

test("occurrence stages project to the six customer-facing operational states", () => {
  const cases = [
    ["waiting_target", "pending", "执行中"],
    ["sent", "sent", "已发送"],
    ["skipped", "skipped", "未发送"],
    ["failed", "failed", "执行失败"],
    ["delivery_unknown", "failed", "发送待确认"],
    ["awaiting_confirmation", "pending", "发送待确认"]
  ];
  for (const [stage, status, label] of cases) {
    assert.equal(resolveStatus({
      enabled: true,
      latestOccurrence: { stage, status }
    }).label, label);
  }
});

test("disabled and technically blocked tasks never masquerade as condition results", () => {
  assert.equal(resolveStatus({ enabled: false }).label, "已停用");
  assert.equal(resolveStatus({
    enabled: true,
    executionAvailable: false,
    technicalReason: "DClaw 群历史能力不可用"
  }).label, "执行不可用");
  assert.doesNotMatch(source, /已达成|尚未达成|判断暂不可用|正在判断/);
});
