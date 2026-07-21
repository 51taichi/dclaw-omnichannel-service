import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentResponseValidationRetryRequest,
  summarizeValidationErrors,
  validateAgentResponseText
} from "../src/agent-response-gateway.js";

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
