import assert from "node:assert/strict";
import test from "node:test";

import { serializeGroupAutomationCurrentState } from "../src/group-automation-task-state.js";

test("condition task without a completed evaluation has no fabricated business state", () => {
  assert.equal(serializeGroupAutomationCurrentState({
    task: { taskType: "conditional_push", conditionText: "今天是否交作业" },
    cycleState: null,
    lastOccurrence: null
  }), null);
});

test("completed condition evaluation preserves the real two-state result and metadata", () => {
  assert.deepEqual(serializeGroupAutomationCurrentState({
    task: { taskType: "conditional_push", conditionText: "今天是否交作业" },
    cycleState: {
      achieved: false,
      reason: "没有明确提交记录",
      evaluatedAt: "2026-08-04T10:00:00.000Z"
    },
    lastOccurrence: { errorMessage: "最近刷新失败" }
  }), {
    achieved: false,
    reason: "没有明确提交记录",
    evaluatedAt: "2026-08-04T10:00:00.000Z",
    stale: false,
    lastError: "最近刷新失败"
  });
});
