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

test("same-cycle occurrence decision remains current when delivery later fails", () => {
  assert.deepEqual(serializeGroupAutomationCurrentState({
    task: { taskType: "conditional_push", conditionText: "今天是否交作业" },
    currentCycleKey: "2026-08-04",
    cycleState: null,
    lastOccurrence: {
      cycleKey: "2026-08-04",
      conditionAchieved: true,
      reason: "客户已经提交作业",
      updatedAt: "2026-08-04T11:00:00.000Z",
      errorMessage: "WorkTool 发送失败"
    }
  }), {
    achieved: true,
    reason: "客户已经提交作业",
    evaluatedAt: "2026-08-04T11:00:00.000Z",
    stale: false,
    lastError: "WorkTool 发送失败"
  });
});

test("an occurrence from another cycle cannot become the current condition state", () => {
  assert.equal(serializeGroupAutomationCurrentState({
    task: { taskType: "conditional_push", conditionText: "今天是否交作业" },
    currentCycleKey: "2026-08-04",
    cycleState: null,
    lastOccurrence: {
      cycleKey: "2026-08-03",
      conditionAchieved: true,
      reason: "昨天已经提交作业"
    }
  }), null);
});
