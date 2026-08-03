import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGroupLedgerAgentRequest,
  buildGroupOccurrenceAgentRequest,
  compactGroupLedgerProjection,
  parseGroupLedgerAgentReply,
  parseGroupOccurrenceAgentReply
} from "../src/group-automation-agent.js";

const binding = { botId: "bot-1", agentId: "agent-1" };
const group = {
  id: "group-1",
  conversationKey: "bot-1:group-id:group-1",
  currentName: "学习服务群",
  background: "客户购买了课程，孩子叫小明"
};
const roles = [{
  id: "role-parent",
  currentName: "家长",
  identityType: "customer",
  description: "小明家长"
}];
const conditionTask = {
  id: "task-1",
  taskType: "conditional_push",
  cadence: "daily",
  conditionText: "今天客户已经完成作业"
};
const summaryTask = {
  id: "task-2",
  taskType: "periodic_summary",
  cadence: "weekly",
  summaryTemplate: "本周上课 {{上课次数（明确完成才计数；无记录填0）}} 次"
};

test("builds a bounded isolated ledger request using inbound member messages only", () => {
  const request = buildGroupLedgerAgentRequest({
    binding,
    group,
    roles,
    tasks: [conditionTask, summaryTask],
    projection: { facts: [] },
    messages: [
      {
        id: 41,
        direction: "inbound",
        senderName: "家长",
        content: "今天作业完成了",
        createdAt: "2026-08-04T10:00:00.000Z"
      },
      {
        id: 42,
        direction: "outbound",
        senderName: "Bot",
        content: "Bot outbound text",
        createdAt: "2026-08-04T10:01:00.000Z"
      }
    ],
    maxChars: 12000
  });

  assert.match(request.message, /只提取与启用条件和模板变量直接相关的客观事实/);
  assert.match(request.message, /私有上下文/);
  assert.doesNotMatch(request.message, /Bot outbound text/);
  assert.ok(request.message.length <= 12000);
  assert.notEqual(request.external_session_id, request.external_user_id);
  assert.equal(request.metadata.eventType, "group_ledger_evaluation");
});

test("validates ledger mutations and condition states against allowed IDs", () => {
  const parsed = parseGroupLedgerAgentReply(JSON.stringify({
    facts: [{
      operation: "upsert",
      semanticKey: "lesson:2026-08-04:1",
      category: "lesson",
      statement: "完成一次课程",
      value: { count: 1 },
      happenedAt: "2026-08-04T10:00:00+08:00",
      speakerName: "老师",
      roleId: "role-teacher",
      evidenceMessageIds: [41]
    }],
    conditionStates: [{
      taskId: "task-1",
      cycleKey: "2026-08-04",
      achieved: true,
      reason: "已经完成",
      supportingFactKeys: ["lesson:2026-08-04:1"],
      contradictingFactKeys: []
    }]
  }), {
    allowedMessageIds: [41],
    allowedTaskIds: ["task-1"]
  });

  assert.equal(parsed.conditionStates[0].achieved, true);
  assert.deepEqual(parsed.facts[0].evidenceMessageIds, [41]);

  assert.throws(() => parseGroupLedgerAgentReply(JSON.stringify({
    facts: [],
    conditionStates: [{
      taskId: "unknown-task",
      cycleKey: "2026-08-04",
      achieved: true,
      reason: "错误任务",
      supportingFactKeys: [],
      contradictingFactKeys: []
    }]
  }), { allowedMessageIds: [41], allowedTaskIds: ["task-1"] }), /unknown task/);
  assert.throws(() => parseGroupLedgerAgentReply(JSON.stringify({
    facts: [{
      operation: "upsert",
      semanticKey: "bad-evidence",
      category: "lesson",
      statement: "错误证据",
      value: {},
      happenedAt: "2026-08-04T10:00:00.000Z",
      speakerName: "老师",
      roleId: "",
      evidenceMessageIds: [999]
    }],
    conditionStates: []
  }), { allowedMessageIds: [41], allowedTaskIds: ["task-1"] }), /unknown message/);
});

test("rejects duplicate mutations, unsupported operations, and non-boolean decisions", () => {
  const mutation = {
    operation: "upsert",
    semanticKey: "same-key",
    category: "lesson",
    statement: "完成课程",
    value: {},
    happenedAt: "2026-08-04T10:00:00.000Z",
    speakerName: "老师",
    roleId: "",
    evidenceMessageIds: [41]
  };
  assert.throws(() => parseGroupLedgerAgentReply(JSON.stringify({
    facts: [mutation, mutation],
    conditionStates: []
  }), { allowedMessageIds: [41], allowedTaskIds: [] }), /duplicate semantic mutation/);
  assert.throws(() => parseGroupLedgerAgentReply(JSON.stringify({
    facts: [{ ...mutation, operation: "delete" }],
    conditionStates: []
  }), { allowedMessageIds: [41], allowedTaskIds: [] }), /unsupported fact operation/);
  assert.throws(() => parseGroupLedgerAgentReply(JSON.stringify({
    facts: [],
    conditionStates: [{
      taskId: "task-1",
      cycleKey: "2026-08-04",
      achieved: "yes",
      reason: "不是布尔值",
      supportingFactKeys: [],
      contradictingFactKeys: []
    }]
  }), { allowedMessageIds: [41], allowedTaskIds: ["task-1"] }), /boolean/);
  assert.throws(() => parseGroupLedgerAgentReply(JSON.stringify({
    facts: [],
    conditionStates: [{
      taskId: "task-1",
      cycleKey: "2026-08-04",
      achieved: true,
      reason: "缺少证据",
      supportingFactKeys: [],
      contradictingFactKeys: []
    }]
  }), { allowedMessageIds: [41], allowedTaskIds: ["task-1"] }), /supporting fact/);
});

test("validates conditional and summary occurrence output without unsupported facts", () => {
  const conditional = parseGroupOccurrenceAgentReply(JSON.stringify({
    achieved: false,
    reason: "没有明确完成记录",
    supportingFactKeys: [],
    contradictingFactKeys: []
  }), {
    taskType: "conditional_push",
    allowedFactKeys: ["lesson:1"]
  });
  assert.equal(conditional.achieved, false);
  assert.throws(() => parseGroupOccurrenceAgentReply(JSON.stringify({
    achieved: true,
    reason: "缺少证据",
    supportingFactKeys: [],
    contradictingFactKeys: []
  }), {
    taskType: "conditional_push",
    allowedFactKeys: ["lesson:1"]
  }), /supporting fact/);

  const summary = parseGroupOccurrenceAgentReply(JSON.stringify({
    variables: [{
      name: "上课次数",
      value: "0",
      factKeys: [],
      fallbackUsed: true,
      reason: "模板规定无记录填0"
    }]
  }), {
    taskType: "periodic_summary",
    allowedFactKeys: ["lesson:1"],
    variables: [{ name: "上课次数", instruction: "无记录填0" }]
  });
  assert.equal(summary.variables[0].value, "0");

  assert.throws(() => parseGroupOccurrenceAgentReply(JSON.stringify({
    variables: [{
      name: "上课次数",
      value: "3",
      factKeys: [],
      fallbackUsed: false,
      reason: "没有证据"
    }]
  }), {
    taskType: "periodic_summary",
    allowedFactKeys: [],
    variables: [{ name: "上课次数", instruction: "只输出数字" }]
  }), /fact evidence or an explicit fallback/);
});

test("compacts oldest unreferenced facts and builds occurrence requests without leaking context labels", () => {
  const projection = compactGroupLedgerProjection({
    facts: Array.from({ length: 30 }, (_, index) => ({
      semanticKey: `fact-${index}`,
      statement: `事实${index}${"很长".repeat(50)}`,
      value: { count: index },
      happenedAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      evidenceMessageIds: [index + 1]
    }))
  }, {
    maxChars: 1800,
    referencedFactKeys: ["fact-0"]
  });
  assert.ok(JSON.stringify(projection).length <= 1800);
  assert.equal(projection.facts.some((fact) => fact.semanticKey === "fact-0"), true);

  const request = buildGroupOccurrenceAgentRequest({
    binding,
    group,
    task: conditionTask,
    cycle: {
      cycleKey: "2026-08-04",
      startAt: "2026-08-03T16:00:00.000Z",
      endAt: "2026-08-04T16:00:00.000Z"
    },
    projection,
    maxChars: 8000
  });
  assert.equal(request.metadata.eventType, "group_automation_occurrence");
  assert.doesNotMatch(request.message, /告诉群成员.*群背景/);
  assert.ok(request.message.length <= 8000);
});

test("occurrence request marks cumulative and cycle template variables with distinct scopes", () => {
  const request = buildGroupOccurrenceAgentRequest({
    binding,
    group,
    task: {
      id: "summary-task",
      taskType: "periodic_summary",
      summaryTemplate: "累计 {{累计上课次数（从建群至今；只输出数字）}}，本周 {{本周上课次数（本周完成；只输出数字）}}"
    },
    cycle: {
      cycleKey: "2026-W32",
      startAt: "2026-08-02T16:00:00.000Z",
      endAt: "2026-08-09T16:00:00.000Z"
    },
    projection: {
      facts: [],
      aggregates: {
        lesson_completed: {
          factCount: 3,
          numericSums: { count: 3 },
          evidenceFactKeys: ["lesson:1"],
          evidenceMessageIds: [41]
        }
      }
    }
  });

  assert.match(request.message, /"name": "累计上课次数"[\s\S]*?"scope": "cumulative"/);
  assert.match(request.message, /"name": "本周上课次数"[\s\S]*?"scope": "cycle"/);
  assert.match(request.message, /只有 scope=cumulative 的变量可以使用 aggregates/);
});

test("aggregate projection keeps only bounded numeric totals and representative evidence", () => {
  const projection = compactGroupLedgerProjection({
    facts: [],
    aggregates: {
      lesson_completed: {
        factCount: 50,
        numericSums: Object.fromEntries(
          Array.from({ length: 50 }, (_, index) => [`metric-${index}`, index])
        ),
        firstHappenedAt: "2026-01-01T00:00:00.000Z",
        lastHappenedAt: "2026-08-04T00:00:00.000Z",
        evidenceFactKeys: Array.from({ length: 50 }, (_, index) => `lesson:${index}`),
        evidenceMessageIds: Array.from({ length: 50 }, (_, index) => index + 1),
        internalText: "must not leave the server"
      }
    }
  }, { maxChars: 8000 });

  assert.equal(Object.keys(projection.aggregates.lesson_completed.numericSums).length, 30);
  assert.equal(projection.aggregates.lesson_completed.evidenceFactKeys.length, 20);
  assert.equal(projection.aggregates.lesson_completed.evidenceMessageIds.length, 20);
  assert.equal(Object.hasOwn(projection.aggregates.lesson_completed, "internalText"), false);
});

test("cycle-scoped summary variable rejects a historical aggregate fact key", () => {
  assert.throws(() => parseGroupOccurrenceAgentReply(JSON.stringify({
    variables: [
      {
        name: "累计上课次数",
        value: "3",
        factKeys: ["lesson:old"],
        fallbackUsed: false,
        reason: "来自累计聚合"
      },
      {
        name: "本周上课次数",
        value: "3",
        factKeys: ["lesson:old"],
        fallbackUsed: false,
        reason: "错误使用累计聚合"
      }
    ]
  }), {
    taskType: "periodic_summary",
    allowedFactKeys: ["lesson:old", "lesson:current"],
    allowedCycleFactKeys: ["lesson:current"],
    allowedAggregateFactKeys: ["lesson:old"],
    variables: [
      { name: "累计上课次数", instruction: "从建群至今", scope: "cumulative" },
      { name: "本周上课次数", instruction: "本周完成", scope: "cycle" }
    ]
  }), /cycle variable.*historical aggregate fact/i);
});

test("summary without an explicit fallback uses only the safe default empty-record text", () => {
  const options = {
    taskType: "periodic_summary",
    allowedFactKeys: [],
    variables: [{
      name: "本周情况摘要",
      instruction: "结合本周有效事实总结学习表现",
      scope: "cycle"
    }]
  };
  assert.throws(() => parseGroupOccurrenceAgentReply(JSON.stringify({
    variables: [{
      name: "本周情况摘要",
      value: "学习表现优秀",
      factKeys: [],
      fallbackUsed: true,
      reason: "无事实时猜测"
    }]
  }), options), /暂无明确记录/);

  const safeDefault = parseGroupOccurrenceAgentReply(JSON.stringify({
    variables: [{
      name: "本周情况摘要",
      value: "暂无明确记录",
      factKeys: [],
      fallbackUsed: true,
      reason: "本周没有相关客观事实"
    }]
  }), options);
  assert.equal(safeDefault.variables[0].value, "暂无明确记录");

  const explicit = parseGroupOccurrenceAgentReply(JSON.stringify({
    variables: [{
      name: "上课次数",
      value: "0",
      factKeys: [],
      fallbackUsed: true,
      reason: "模板明确无记录填0"
    }]
  }), {
    taskType: "periodic_summary",
    allowedFactKeys: [],
    variables: [{ name: "上课次数", instruction: "没有明确记录时填0", scope: "cycle" }]
  });
  assert.equal(explicit.variables[0].value, "0");
});

test("cumulative summary variables must cite a fact carried by the cumulative aggregate", () => {
  assert.throws(() => parseGroupOccurrenceAgentReply(JSON.stringify({
    variables: [{
      name: "累计上课次数",
      value: "1",
      factKeys: ["lesson:current"],
      fallbackUsed: false,
      reason: "错误地只使用本周一次课程"
    }]
  }), {
    taskType: "periodic_summary",
    allowedFactKeys: ["lesson:old", "lesson:current"],
    allowedCycleFactKeys: ["lesson:current"],
    allowedAggregateFactKeys: ["lesson:old"],
    variables: [{
      name: "累计上课次数",
      instruction: "从建群至今明确完成的课程总次数",
      scope: "cumulative"
    }]
  }), /cumulative aggregate fact/i);
});
