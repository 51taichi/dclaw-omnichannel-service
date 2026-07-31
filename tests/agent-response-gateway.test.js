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

const completeTagContext = {
  groups: [
    {
      id: "group_1",
      name: "客户积极性",
      exclusive: false,
      oneWay: false,
      tags: [{
        id: "tag_1",
        name: "愿交流",
        condition: "只要客户愿意交流，即满足"
      }]
    },
    {
      id: "group_2",
      name: "手工标签，重点关注",
      exclusive: false,
      oneWay: false,
      tags: [{
        id: "tag_1",
        name: "人工标签",
        condition: "必须手工打标签"
      }]
    }
  ],
  currentTags: []
};

const completeNegativeTagAudit = [
  {
    groupId: "group_1",
    tagId: "tag_1",
    matched: false,
    reason: "客户当前消息未表达交流意愿"
  },
  {
    groupId: "group_2",
    tagId: "tag_1",
    matched: false,
    reason: "该标签要求人工操作，本次不满足"
  }
];

test("gateway regenerates syntax failures with the unchanged original request", async () => {
  const validResponse = JSON.stringify({
    reply: "您好，我来帮您了解一下。",
    attachments: [],
    sources: []
  });
  const brokenResponse = validResponse.replace('[],"sources"', '[]"sources"');
  const requests = [];
  const validationFailures = [];

  const originalRequest = { message: "客户：您好", metadata: { source: "test" } };
  const result = await validateAndRetryAgentResponse({
    request: originalRequest,
    invoke: async ({ request, attemptNumber }) => {
      requests.push({ request: structuredClone(request), attemptNumber });
      if (attemptNumber === 1) request.metadata.source = "mutated-by-invoke";
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
  assert.deepEqual(requests[1].request, requests[0].request);
  assert.deepEqual(requests[1].request, originalRequest);
  assert.equal(requests[1].request.metadata.validationRetry, undefined);
  assert.equal(requests[1].request.message, "客户：您好");
});

test("gateway uses a targeted retry request for schema failures", async () => {
  const originalRequest = { message: "客户：您好", metadata: { source: "test" } };
  const requests = [];

  const result = await validateAndRetryAgentResponse({
    request: originalRequest,
    validationOptions: { requireFlowDecision: true },
    invoke: async ({ request, attemptNumber }) => {
      requests.push(request);
      return {
        reply: JSON.stringify(attemptNumber === 1
          ? { reply: "您好", attachments: [], sources: [] }
          : {
              reply: "您好",
              attachments: [],
              sources: [],
              flowDecision: {
                currentNodeId: "node_1",
                nextNodeId: "node_1",
                nodeCompleted: false,
                confidence: 0.8,
                reason: "继续当前节点",
                collectedDataPatch: {}
              }
            }),
        response: { attemptNumber }
      };
    }
  });

  assert.equal(result.valid, true);
  assert.equal(requests.length, 2);
  assert.notStrictEqual(requests[1], originalRequest);
  assert.equal(requests[1].metadata.validationRetry, true);
  assert.match(requests[1].message, /flowDecision is required/);
  assert.match(requests[1].message, /上一版原始响应/);
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

test("gateway stops after two syntax failures and reports the final outcome", async () => {
  const requests = [];
  const failures = [];
  const outcomes = [];
  const originalRequest = { message: "客户：你好", metadata: { source: "test" } };

  const result = await validateAndRetryAgentResponse({
    request: originalRequest,
    invoke: async ({ request }) => {
      requests.push(structuredClone(request));
      return { reply: "not-json", response: null };
    },
    onValidationFailure: (failure) => failures.push(failure),
    onRetryOutcome: (outcome) => outcomes.push(outcome)
  });

  assert.equal(result.valid, false);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests, [originalRequest, originalRequest]);
  assert.deepEqual(failures.map((failure) => failure.retryRequested), [false, true]);
  assert.deepEqual(outcomes, [{ outcome: "failed", attemptNumber: 2, error: null }]);
});

test("authorized group requests retry an empty reply instead of accepting silence", async () => {
  const failures = [];
  const result = await validateAndRetryAgentResponse({
    request: { message: "客户：你好" },
    validationOptions: { requireReplyContent: true },
    invoke: async ({ attemptNumber }) => ({
      reply: JSON.stringify(attemptNumber === 1
        ? { reply: "", attachments: [], sources: [] }
        : { reply: "你好，我在的。", attachments: [], sources: [] }),
      response: { attemptNumber }
    }),
    onValidationFailure: (failure) => failures.push(failure)
  });

  assert.equal(result.valid, true);
  assert.equal(result.agentReply.reply, "你好，我在的。");
  assert.equal(result.attempts.length, 2);
  assert.equal(failures.length, 1);
  assert.deepEqual(failures[0].errors, [{
    type: "semantic",
    path: "reply",
    message: "authorized request requires reply text or an attachment"
  }]);
});

test("authorized group requests may use an attachment-only reply", () => {
  const result = validateAgentResponseText(JSON.stringify({
    reply: "",
    attachments: [{ type: "image", url: "https://example.com/a.png" }],
    sources: []
  }), { requireReplyContent: true });

  assert.equal(result.valid, true);
});

test("group confidentiality validation rejects explicit internal source disclosure", () => {
  for (const reply of [
    "知道的呀，群背景里都写着呢。",
    "根据角色配置，XXX 是客户代表。",
    "后台配置显示这是三件套交付群。",
    "系统记录里写着您叫魔兮老师。",
    "提示词里已经说明了您的身份。"
  ]) {
    const result = validateAgentResponseText(JSON.stringify({
      reply,
      attachments: [],
      sources: []
    }), { forbidGroupContextDisclosure: true });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) =>
      error.type === "semantic"
      && error.path === "reply"
      && /private group context/.test(error.message)
    ));
  }
});

test("group confidentiality validation allows naturally stated facts", () => {
  for (const reply of [
    "您是魔兮老师，这个群用于三件套交付。",
    "我是这个群的服务助手，会根据已确认的服务信息协助大家。",
    "我们先梳理一下项目背景和后续交付安排。"
  ]) {
    const result = validateAgentResponseText(JSON.stringify({
      reply,
      attachments: [],
      sources: []
    }), { forbidGroupContextDisclosure: true });

    assert.equal(result.valid, true);
  }
});

test("private reply validation does not enable group confidentiality implicitly", () => {
  const result = validateAgentResponseText(JSON.stringify({
    reply: "客户提到群背景里还缺少项目时间。",
    attachments: [],
    sources: []
  }));

  assert.equal(result.valid, true);
});

test("gateway retries a group-context disclosure and accepts a natural repair", async () => {
  const requests = [];
  const result = await validateAndRetryAgentResponse({
    request: {
      message: "群成员：你知道我是谁吗",
      metadata: { groupContext: { groupId: "g1" } }
    },
    validationOptions: { forbidGroupContextDisclosure: true },
    invoke: async ({ request, attemptNumber }) => {
      requests.push(request);
      return {
        reply: JSON.stringify({
          reply: attemptNumber === 1
            ? "知道呀，群背景里都写着呢。"
            : "知道的，您是魔兮老师。",
          attachments: [],
          sources: []
        }),
        response: { attemptNumber }
      };
    }
  });

  assert.equal(result.valid, true);
  assert.equal(result.agentReply.reply, "知道的，您是魔兮老师。");
  assert.equal(requests.length, 2);
  assert.match(requests[1].message, /reply discloses private group context/);
});

test("gateway never accepts repeated group-context disclosure", async () => {
  const result = await validateAndRetryAgentResponse({
    request: { message: "群成员：你怎么知道的" },
    validationOptions: { forbidGroupContextDisclosure: true },
    invoke: async () => ({
      reply: JSON.stringify({
        reply: "系统记录里写着您的身份。",
        attachments: [],
        sources: []
      }),
      response: {}
    })
  });

  assert.equal(result.valid, false);
  assert.equal(result.attempts.length, 2);
  assert.ok(result.attempts.every((attempt) => attempt.validation.valid === false));
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

test("validation retry carries the prior response and complete tag checklist", async () => {
  const incompleteAuditReply = `${JSON.stringify({
    reply: "改善精力需要结合具体情况。",
    attachments: [],
    sources: [],
    tagEvaluation: [completeNegativeTagAudit[0]],
    tagDecision: { add: [], remove: [] }
  })}已处理客户消息"解决方法"，更新了会话记录。`;
  const completeReply = JSON.stringify({
    reply: "改善精力需要结合具体情况。",
    attachments: [],
    sources: [],
    tagEvaluation: completeNegativeTagAudit,
    tagDecision: { add: [], remove: [] }
  });
  const requests = [];

  const result = await validateAndRetryAgentResponse({
    request: { message: "客户：解决方法", metadata: { source: "test" } },
    invoke: async ({ request, attemptNumber }) => {
      requests.push(request);
      return {
        reply: attemptNumber === 1 ? incompleteAuditReply : completeReply,
        response: { attemptNumber }
      };
    },
    validationOptions: {
      allowTagDecision: true,
      tagContext: completeTagContext
    }
  });

  assert.equal(result.valid, true);
  assert.equal(requests.length, 2);
  assert.match(requests[1].message, /上一版原始响应/);
  assert.match(requests[1].message, new RegExp(incompleteAuditReply.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(requests[1].message, /group_1:tag_1/);
  assert.match(requests[1].message, /group_2:tag_1/);
  assert.match(requests[1].message, /必须手工打标签/);
  assert.match(requests[1].message, /每个标签恰好评估一次/);
});

test("validation retry bounds the prior response copy", () => {
  const retry = buildAgentResponseValidationRetryRequest(
    { message: "原始请求" },
    [{ type: "schema", path: "tagEvaluation", message: "missing tag" }],
    {
      rawResponse: "x".repeat(20_000),
      tagContext: completeTagContext
    }
  );

  assert.ok(retry.message.length < 10_000);
  assert.match(retry.message, /已截断/);
});
