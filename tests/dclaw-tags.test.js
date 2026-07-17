import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDclawAttachmentSourceRetryRequest,
  buildDclawReplyFormatRetryRequest,
  buildDclawRequest,
  parseAgentReply
} from "../src/dclaw.js";

const binding = {
  botId: "tag_bot",
  agentId: "tag_agent",
  agentApiUrl: "https://dclaw.example.test/api/open/v1/targets/tag_agent/messages",
  agentApiKey: ""
};

const conversation = {
  conversationKey: "tag_bot:private:魔兮"
};

const message = {
  roomType: 2,
  spoken: "我想了解",
  rawSpoken: "我想了解",
  receivedName: "魔兮",
  textType: 1
};

test("buildDclawRequest includes tag rules in message and metadata", () => {
  const request = buildDclawRequest({
    binding,
    conversation,
    message,
    tagContext: {
      dateTagEnabled: true,
      groups: [{ id: "intent", name: "意向", exclusive: true, oneWay: true, tags: [{ id: "b", name: "B类", condition: "询问细节" }] }],
      currentTags: []
    }
  });

  assert.match(request.message, /tagRules/);
  assert.match(request.message, /tagDecision/);
  assert.equal(request.metadata.tagRules.groups[0].id, "intent");
});

test("parseAgentReply extracts tagDecision", () => {
  const reply = parseAgentReply(JSON.stringify({
    reply: "可以",
    attachments: [],
    sources: [],
    tagDecision: { add: [{ groupId: "intent", tagId: "b", reason: "询问细节" }], remove: [] }
  }));

  assert.equal(reply.valid, true);
  assert.equal(reply.tagDecision.add[0].tagId, "b");
});

test("retry prompts preserve tagDecision schema", () => {
  const request = buildDclawRequest({ binding, conversation, message, tagContext: { groups: [], currentTags: [] } });
  assert.match(buildDclawReplyFormatRetryRequest(request).message, /tagDecision/);
  assert.match(buildDclawAttachmentSourceRetryRequest(request, {}).message, /tagDecision/);
});
