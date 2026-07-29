import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentResponseValidationRetryRequest,
  summarizeValidationErrors,
  validateAgentResponseText,
  validateAndRetryAgentResponse
} from "../src/agent-response-gateway.js";

const auditedTagContext = {
  groups: [{
    id: "intent",
    exclusive: true,
    oneWay: true,
    tags: [{ id: "c" }, { id: "b" }]
  }],
  currentTags: [{ groupId: "intent", tagId: "c" }]
};

const auditedTagEvidenceCandidates = [{
  id: "1013",
  text: "如果请假会扣钱吗"
}];

const validAuditedReply = {
  reply: "请假不会扣费。",
  attachments: [],
  sources: [],
  tagEvaluation: [
    { groupId: "intent", tagId: "c", matched: false, reason: "未命中" },
    {
      groupId: "intent",
      tagId: "b",
      matched: true,
      reason: "客户提出咨询问题",
      evidenceMessageId: "1013",
      evidenceText: "如果请假会扣钱吗"
    }
  ],
  tagDecision: {
    add: [{
      groupId: "intent",
      tagId: "b",
      reason: "客户提出咨询问题",
      evidenceMessageId: "1013",
      evidenceText: "如果请假会扣钱吗"
    }],
    remove: []
  }
};

test("gateway retries a deliberately broken successful JSON response and validates the repair", async () => {
  const validResponse = JSON.stringify({
    reply: "您好，我来帮您了解一下。",
    attachments: [],
    sources: []
  });
  const brokenResponse = validResponse.replace('[],"sources"', '[]"sources"');
  const requests = [];
  const validationFailures = [];

  const result = await validateAndRetryAgentResponse({
    request: { message: "客户：您好", metadata: { source: "test" } },
    invoke: async ({ request, attemptNumber }) => {
      requests.push({ request, attemptNumber });
      return {
        reply: attemptNumber === 1 ? brokenResponse : validResponse,
        response: { attemptNumber }
      };
    },
    onValidationFailure: (failure) => validationFailures.push(failure)
  });

  assert.equal(result.valid, true);
  assert.equal(result.agentReply.reply, "您好，我来帮您了解一下。");
  assert.equal(requests.length, 2);
  assert.equal(validationFailures.length, 1);
  assert.equal(validationFailures[0].attemptNumber, 1);
  assert.equal(validationFailures[0].retryRequested, false);
  assert.equal(requests[1].attemptNumber, 2);
  assert.equal(requests[1].request.metadata.validationRetry, true);
  assert.match(requests[1].request.message, /上一条输出没有通过服务端 JSON 响应校验/);
  assert.match(requests[1].request.message, /json_syntax/);
});

test("gateway reports when the validation retry succeeds", async () => {
  const validResponse = JSON.stringify({ reply: "修复后的回复", attachments: [], sources: [] });
  const retryOutcomes = [];

  const result = await validateAndRetryAgentResponse({
    request: { message: "客户：你好" },
    invoke: async ({ attemptNumber }) => ({
      reply: attemptNumber === 1 ? "不是 JSON" : validResponse,
      response: { attemptNumber }
    }),
    onValidationFailure: () => {},
    onRetryOutcome: (outcome) => retryOutcomes.push(outcome)
  });

  assert.equal(result.valid, true);
  assert.deepEqual(retryOutcomes, [{
    outcome: "succeeded",
    attemptNumber: 2,
    error: null
  }]);
});

test("gateway decodes escaped reply line breaks without retrying the Agent", async () => {
  const attempts = [];
  const result = await validateAndRetryAgentResponse({
    request: { message: "客户：你好" },
    invoke: async ({ attemptNumber }) => {
      attempts.push(attemptNumber);
      return {
        reply: JSON.stringify({
          reply: "第一段\\n\\n第二段",
          attachments: [],
          sources: []
        }),
        response: { attemptNumber }
      };
    }
  });

  assert.equal(result.valid, true);
  assert.equal(result.agentReply.reply, "第一段\n\n第二段");
  assert.deepEqual(result.validation.normalizations, [{
    type: "reply_escaped_line_breaks_decoded"
  }]);
  assert.deepEqual(attempts, [1]);
});

test("validation reports JSON syntax line and column", () => {
  const result = validateAgentResponseText('{\n  "reply": "你好",\n  "attachments": []\n  "sources": []\n}');

  assert.equal(result.valid, false);
  assert.equal(result.errors[0].type, "json_syntax");
  assert.equal(result.errors[0].line, 4);
  assert.equal(result.errors[0].column, 3);
  assert.match(result.errors[0].message, /JSON/);
});

test("validation accepts only a structured reply object", () => {
  const result = validateAgentResponseText(JSON.stringify({
    reply: "您好，课程可以了解下。",
    attachments: [],
    sources: [],
    flowDecision: {
      currentNodeId: "node_1",
      nextNodeId: "node_1",
      nodeCompleted: false,
      confidence: 0.7,
      reason: "继续收集信息",
      collectedDataPatch: {}
    },
    tagDecision: { add: [], remove: [] }
  }), { requireFlowDecision: true, allowTagDecision: true });

  assert.equal(result.valid, true);
  assert.equal(result.agentReply.reply, "您好，课程可以了解下。");
  assert.equal(result.agentReply.flowDecision.nextNodeId, "node_1");
});

test("validation preserves tag decision evidence fields", () => {
  const result = validateAgentResponseText(JSON.stringify({
    reply: "老师都是经过严格筛选的。",
    attachments: [],
    sources: [],
    tagEvaluation: [{
      groupId: "intent",
      tagId: "b",
      matched: true,
      reason: "询问老师水平",
      evidenceMessageId: "msg-123",
      evidenceText: "你们老师水平怎么样"
    }],
    tagDecision: {
      add: [{
        groupId: "intent",
        tagId: "b",
        reason: "询问老师水平",
        evidenceMessageId: "msg-123",
        evidenceText: "你们老师水平怎么样"
      }],
      remove: []
    }
  }), {
    allowTagDecision: true,
    tagContext: {
      groups: [{
        id: "intent",
        tags: [{ id: "b" }]
      }]
    },
    tagEvidenceCandidates: [{
      id: "msg-123",
      text: "你们老师水平怎么样"
    }]
  });

  assert.equal(result.valid, true);
  assert.equal(result.agentReply.tagEvaluation[0].matched, true);
  assert.equal(result.agentReply.tagDecision.add[0].evidenceMessageId, "msg-123");
  assert.equal(result.agentReply.tagDecision.add[0].evidenceText, "你们老师水平怎么样");
});

test("unknown tag decisions are rejected before server-side adjudication", () => {
  const result = validateAgentResponseText(JSON.stringify({
    reply: "老师都是经过严格筛选的。",
    attachments: [],
    sources: [],
    tagEvaluation: [{
      groupId: "intent",
      tagId: "b",
      matched: false,
      reason: "未命中"
    }],
    tagDecision: {
      add: [{
        groupId: "unknown-group",
        tagId: "unknown-tag",
        reason: "模型返回了过期标签"
      }],
      remove: []
    }
  }), {
    allowTagDecision: true,
    tagContext: {
      groups: [{
        id: "intent",
        tags: [{ id: "b" }]
      }]
    }
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /unknown-group:unknown-tag/.test(error.message)));
});

test("gateway repairs an empty decision that omitted mandatory evaluation", async () => {
  const result = await validateAndRetryAgentResponse({
    request: { message: "客户：如果请假会扣钱吗" },
    validationOptions: {
      allowTagDecision: true,
      tagContext: auditedTagContext,
      tagEvidenceCandidates: auditedTagEvidenceCandidates
    },
    invoke: async ({ attemptNumber }) => ({
      reply: JSON.stringify(attemptNumber === 1
        ? {
            reply: "不会扣费",
            attachments: [],
            sources: [],
            tagDecision: { add: [], remove: [] }
          }
        : validAuditedReply),
      response: { attemptNumber }
    })
  });

  assert.equal(result.valid, true);
  assert.equal(result.attempts.length, 2);
  assert.equal(
    result.agentReply.tagEvaluation.find((item) => item.tagId === "b").matched,
    true
  );
});

test("a valid audited response performs one Agent invocation", async () => {
  let calls = 0;
  const result = await validateAndRetryAgentResponse({
    request: { message: "客户：如果请假会扣钱吗" },
    validationOptions: {
      allowTagDecision: true,
      tagContext: auditedTagContext,
      tagEvidenceCandidates: auditedTagEvidenceCandidates
    },
    invoke: async () => {
      calls += 1;
      return {
        reply: JSON.stringify(validAuditedReply),
        response: { calls }
      };
    }
  });

  assert.equal(result.valid, true);
  assert.equal(calls, 1);
  assert.equal(result.attempts.length, 1);
});

test("gateway extracts one complete JSON object from surrounding prose without another Agent call", async () => {
  const localRepairs = [];
  let calls = 0;
  const result = await validateAndRetryAgentResponse({
    request: { message: "客户：你好" },
    invoke: async () => {
      calls += 1;
      return {
        reply: '我先处理一下。\n{"reply":"你好","attachments":[],"sources":[]}\n处理完成。',
        response: { calls }
      };
    },
    onLocalRepair: (repair) => localRepairs.push(repair)
  });

  assert.equal(result.valid, true);
  assert.equal(result.agentReply.reply, "你好");
  assert.equal(calls, 1);
  assert.deepEqual(result.validation.repairs, [{
    type: "single_embedded_json_extracted"
  }]);
  assert.equal(localRepairs.length, 1);
  assert.equal(localRepairs[0].errors[0].type, "json_syntax");
});

test("gateway collapses repeated identical JSON objects locally", () => {
  const json = '{"reply":"你好","attachments":[],"sources":[]}';
  const result = validateAgentResponseText(`${json}\n${json}`);

  assert.equal(result.valid, true);
  assert.deepEqual(result.repairs, [{
    type: "duplicate_json_objects_collapsed",
    count: 2
  }]);
});

test("gateway does not choose between different complete JSON objects", () => {
  const result = validateAgentResponseText([
    '{"reply":"第一个","attachments":[],"sources":[]}',
    '{"reply":"第二个","attachments":[],"sources":[]}'
  ].join("\n"));

  assert.equal(result.valid, false);
  assert.equal(result.errors[0].type, "json_syntax");
});

test("gateway rejects a complete draft followed by a truncated JSON object", () => {
  const result = validateAgentResponseText([
    '{"reply":"草稿","attachments":[],"sources":[]}',
    '{"reply":"最终回复","attachments":['
  ].join("\n"));

  assert.equal(result.valid, false);
  assert.equal(result.repairs.length, 0);
  assert.equal(result.errors[0].type, "json_syntax");
});

test("gateway rejects a complete draft followed by a closed malformed JSON object", () => {
  const result = validateAgentResponseText([
    '{"reply":"草稿","attachments":[],"sources":[]}',
    '{reply:"最终回复"}'
  ].join("\n"));

  assert.equal(result.valid, false);
  assert.equal(result.repairs.length, 0);
  assert.equal(result.errors[0].type, "json_syntax");
});

test("gateway removes a tag decision when tags are disabled", () => {
  const result = validateAgentResponseText(JSON.stringify({
    reply: "你好",
    attachments: [],
    sources: [],
    tagDecision: {
      add: [{ groupId: "intent", tagId: "b" }],
      remove: []
    }
  }), { allowTagDecision: false });

  assert.equal(result.valid, true);
  assert.deepEqual(result.agentReply.tagDecision, { add: [], remove: [] });
  assert.deepEqual(result.repairs, [{
    type: "disallowed_tag_decision_removed"
  }]);
});

test("gateway repairs deterministic tag evidence and a missing required add", () => {
  const result = validateAgentResponseText(JSON.stringify({
    ...validAuditedReply,
    tagEvaluation: [
      {
        groupId: "intent",
        tagId: "c",
        matched: false,
        reason: "未命中",
        evidenceMessageId: "wrong",
        evidenceText: "不应保留"
      },
      {
        groupId: "intent",
        tagId: "b",
        matched: true,
        reason: "客户提出咨询问题",
        evidenceMessageId: "wrong",
        evidenceText: "如果请假会扣钱吗"
      }
    ],
    tagDecision: { add: [], remove: [] }
  }), {
    allowTagDecision: true,
    tagContext: auditedTagContext,
    tagEvidenceCandidates: auditedTagEvidenceCandidates
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.agentReply.tagDecision.add, [{
    groupId: "intent",
    tagId: "b",
    reason: "客户提出咨询问题",
    evidenceMessageId: "1013",
    evidenceText: "如果请假会扣钱吗"
  }]);
  assert.deepEqual(
    result.repairs.map((repair) => repair.type),
    [
      "unmatched_tag_evidence_cleared",
      "tag_evidence_message_id_repaired",
      "missing_tag_decision_add_derived"
    ]
  );
});

test("gateway retries instead of guessing when a tag evaluation is missing", async () => {
  let calls = 0;
  const result = await validateAndRetryAgentResponse({
    request: { message: "客户：如果请假会扣钱吗" },
    validationOptions: {
      allowTagDecision: true,
      tagContext: auditedTagContext,
      tagEvidenceCandidates: auditedTagEvidenceCandidates
    },
    invoke: async ({ attemptNumber }) => {
      calls += 1;
      return {
        reply: JSON.stringify(attemptNumber === 1
          ? {
              reply: "不会扣费",
              attachments: [],
              sources: [],
              tagEvaluation: [validAuditedReply.tagEvaluation[1]],
              tagDecision: { add: [], remove: [] }
            }
          : validAuditedReply),
        response: { attemptNumber }
      };
    }
  });

  assert.equal(result.valid, true);
  assert.equal(calls, 2);
  assert.equal(result.attempts[0].validation.repairs.length, 0);
});

test("gateway retries instead of guessing when tag evidence text is ambiguous", async () => {
  let calls = 0;
  const result = await validateAndRetryAgentResponse({
    request: { message: "客户：同一句话" },
    validationOptions: {
      allowTagDecision: true,
      tagContext: {
        groups: [{ id: "intent", tags: [{ id: "b" }] }],
        currentTags: []
      },
      tagEvidenceCandidates: [
        { id: "message-1", text: "同一句话" },
        { id: "message-2", text: "同一句话" }
      ]
    },
    invoke: async ({ attemptNumber }) => {
      calls += 1;
      return {
        reply: JSON.stringify(attemptNumber === 1
          ? {
              reply: "收到",
              attachments: [],
              sources: [],
              tagEvaluation: [{
                groupId: "intent",
                tagId: "b",
                matched: true,
                reason: "命中",
                evidenceText: "同一句话"
              }],
              tagDecision: { add: [], remove: [] }
            }
          : {
              reply: "收到",
              attachments: [],
              sources: [],
              tagEvaluation: [{
                groupId: "intent",
                tagId: "b",
                matched: true,
                reason: "命中",
                evidenceMessageId: "message-2",
                evidenceText: "同一句话"
              }],
              tagDecision: {
                add: [{
                  groupId: "intent",
                  tagId: "b",
                  reason: "命中",
                  evidenceMessageId: "message-2",
                  evidenceText: "同一句话"
                }],
                remove: []
              }
            }),
        response: { attemptNumber }
      };
    }
  });

  assert.equal(result.valid, true);
  assert.equal(calls, 2);
});

test("gateway does not overwrite evidence text that identifies another valid message", () => {
  const result = validateAgentResponseText(JSON.stringify({
    reply: "收到",
    attachments: [],
    sources: [],
    tagEvaluation: [{
      groupId: "intent",
      tagId: "b",
      matched: true,
      reason: "客户咨询费用",
      evidenceMessageId: "message-1",
      evidenceText: "咨询费用"
    }],
    tagDecision: { add: [], remove: [] }
  }), {
    allowTagDecision: true,
    tagContext: {
      groups: [{ id: "intent", tags: [{ id: "b" }] }],
      currentTags: []
    },
    tagEvidenceCandidates: [
      { id: "message-1", text: "你好" },
      { id: "message-2", text: "咨询费用" }
    ]
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.path.endsWith("evidenceText")));
  assert.equal(
    result.repairs.some((repair) => repair.type === "tag_evidence_text_canonicalized"),
    false
  );
});

test("validation records schema paths for missing or invalid fields", () => {
  const result = validateAgentResponseText(JSON.stringify({
    reply: 123,
    attachments: {},
    sources: []
  }));

  assert.equal(result.valid, false);
  assert.deepEqual(
    result.errors.map((error) => error.path),
    ["reply", "attachments"]
  );
});

test("validation accepts an isolated JSON markdown fence and records normalization", () => {
  const result = validateAgentResponseText(`\`\`\`json
{"reply":"你好","attachments":[],"sources":[]}
\`\`\``);

  assert.equal(result.valid, true);
  assert.equal(result.normalizations[0].type, "outer_json_fence_removed");
});

test("retry request includes concise validation errors", () => {
  const request = { message: "原始请求", metadata: { flow: { currentNode: { id: "node_1" } } } };
  const errors = [
    { type: "json_syntax", message: "Expected ',' after property", line: 3, column: 4 },
    { type: "schema", path: "reply", message: "reply must be a non-empty string" }
  ];
  const retry = buildAgentResponseValidationRetryRequest(request, errors);

  assert.match(retry.message, /Expected ',' after property/);
  assert.match(retry.message, /reply/);
  assert.equal(retry.metadata.validationRetry, true);
  assert.deepEqual(retry.metadata.validationErrors, summarizeValidationErrors(errors));
});
