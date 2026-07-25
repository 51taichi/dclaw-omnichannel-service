import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentResponseValidationRetryRequest,
  summarizeValidationErrors,
  validateAgentResponseText,
  validateAndRetryAgentResponse
} from "../src/agent-response-gateway.js";

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
    }
  });

  assert.equal(result.valid, true);
  assert.equal(result.agentReply.tagDecision.add[0].evidenceMessageId, "msg-123");
  assert.equal(result.agentReply.tagDecision.add[0].evidenceText, "你们老师水平怎么样");
});

test("unknown tag decisions remain valid for server-side adjudication", () => {
  const result = validateAgentResponseText(JSON.stringify({
    reply: "老师都是经过严格筛选的。",
    attachments: [],
    sources: [],
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

  assert.equal(result.valid, true);
  assert.equal(result.agentReply.tagDecision.add[0].tagId, "unknown-tag");
});

test("validation rejects prose wrapped around JSON", () => {
  const result = validateAgentResponseText('我先处理一下。{"reply":"你好","attachments":[],"sources":[]}');

  assert.equal(result.valid, false);
  assert.equal(result.errors[0].type, "json_syntax");
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
