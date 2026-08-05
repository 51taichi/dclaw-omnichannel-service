import assert from "node:assert/strict";
import test from "node:test";

import {
  executeGroupAutomationAgentTask,
  validateCustomerVisibleGroupAutomationContent
} from "../src/group-automation-agent.js";

const base = {
  binding: {
    botId: "bot-1",
    agentId: "agent-1",
    agentApiUrl: "https://dclaw.example.test/api/open/v1/targets/demo/messages",
    agentApiKey: "test-key"
  },
  conversation: {
    conversationKey: "bot-1:group-id:group-1",
    conversationEpoch: "epoch-1"
  },
  group: {
    id: "group-1",
    currentName: "学习服务群",
    background: "客户购买了课程"
  },
  roles: [{
    id: "role-parent",
    currentName: "家长",
    identityType: "客户",
    description: "学生家长"
  }],
  occurrence: {
    id: "occurrence-1",
    scheduledFor: "2026-08-06T09:00:00.000+08:00",
    cycleStartAt: "2026-08-06T00:00:00.000+08:00",
    cycleEndAt: "2026-08-07T00:00:00.000+08:00"
  }
};

const conditionTask = {
  id: "task-1",
  taskType: "conditional_push",
  conditionText: "今天客户已经完成作业",
  content: "今天的作业已经完成，辛苦啦！"
};

const summaryTask = {
  id: "task-2",
  taskType: "periodic_summary",
  summaryTemplate: "本周上课 {{本周明确完成的课程次数}} 次"
};

test("conditional result repairs missing evidence within the same occurrence session", async () => {
  const requests = [];
  const replies = [
    '{"achieved":true,"decisionNote":"已提交作业","evidenceMessageIds":[]}',
    '{"achieved":true,"decisionNote":"已提交作业","evidenceMessageIds":[101]}'
  ];
  const result = await executeGroupAutomationAgentTask({
    ...base,
    task: conditionTask,
    invokeAgent: async ({ request }) => {
      requests.push(request);
      return { reply: replies.shift() };
    }
  });

  assert.deepEqual(result, {
    taskType: "conditional_push",
    achieved: true,
    decisionNote: "已提交作业",
    evidenceMessageIds: [101]
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].external_session_id, requests[1].external_session_id);
  assert.equal(requests[0].metadata.occurrenceId, requests[1].metadata.occurrenceId);
  assert.match(requests[1].message, /achieved condition requires evidence message ids/iu);
});

test("transport and format failures share one three-call budget", async () => {
  let calls = 0;
  await assert.rejects(() => executeGroupAutomationAgentTask({
    ...base,
    task: summaryTask,
    invokeAgent: async () => {
      calls += 1;
      if (calls === 1) throw new Error("timeout");
      return { reply: "not-json" };
    }
  }), /Agent reply must contain one JSON object only/u);
  assert.equal(calls, 3);
});

test("conditional false accepts an honest no-evidence result", async () => {
  const result = await executeGroupAutomationAgentTask({
    ...base,
    task: conditionTask,
    invokeAgent: async () => ({
      reply: '{"achieved":false,"decisionNote":"本周期暂无明确完成记录","evidenceMessageIds":[]}'
    })
  });

  assert.deepEqual(result, {
    taskType: "conditional_push",
    achieved: false,
    decisionNote: "本周期暂无明确完成记录",
    evidenceMessageIds: []
  });
});

test("periodic summary repairs private context disclosure before returning content", async () => {
  const replies = [
    '{"content":"群背景里写着本周上了两次课","decisionNote":"已汇总","evidenceMessageIds":[101]}',
    '{"content":"本周明确完成课程 2 次。","decisionNote":"依据两次明确结课记录汇总","evidenceMessageIds":[101,102]}'
  ];
  const result = await executeGroupAutomationAgentTask({
    ...base,
    task: summaryTask,
    invokeAgent: async () => ({ reply: replies.shift() })
  });

  assert.deepEqual(result, {
    taskType: "periodic_summary",
    content: "本周明确完成课程 2 次。",
    decisionNote: "依据两次明确结课记录汇总",
    evidenceMessageIds: [101, 102]
  });
  assert.equal(
    validateCustomerVisibleGroupAutomationContent({ content: result.content }),
    result.content
  );
});

test("strict result rejects extra fields and non-positive evidence ids", async () => {
  const replies = [
    '{"achieved":true,"decisionNote":"已完成","evidenceMessageIds":[101],"reasoning":"隐藏推理"}',
    '{"achieved":true,"decisionNote":"已完成","evidenceMessageIds":[0]}',
    '{"achieved":true,"decisionNote":"已完成","evidenceMessageIds":[-1]}'
  ];
  await assert.rejects(() => executeGroupAutomationAgentTask({
    ...base,
    task: conditionTask,
    invokeAgent: async () => ({ reply: replies.shift() })
  }), /evidenceMessageIds must contain positive safe integers/u);
});
