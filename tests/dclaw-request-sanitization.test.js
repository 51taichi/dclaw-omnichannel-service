import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDclawActivationRequest,
  buildDclawRequest
} from "../src/dclaw.js";

const binding = {
  botId: "bot_1",
  agentId: "agent_1",
  agentApiUrl: "https://dclaw.example.test/api/open/v1/targets/demo/messages",
  agentApiKey: "test-key"
};

const heavyHistoryMessage = {
  id: 10,
  direction: "outbound",
  senderName: "客服小左",
  content: "我发您看下",
  rawPayload: {
    agentReply: {
      reply: "我发您看下",
      attachments: [{ type: "video", url: "https://cdn.example.com/demo.mp4" }],
      sources: [{ type: "experience", name: "视频资料索取与实力背书回应" }],
      flowDecision: { currentNodeId: "node_1" }
    },
    worktoolMessageIds: ["2076219836125294592"],
    request: { message: "very large nested request" }
  },
  createdAt: "2026-07-12T08:19:17.908Z"
};

test("buildDclawRequest sends compact recent messages without nested raw payloads", () => {
  const request = buildDclawRequest({
    binding,
    conversation: { conversationKey: "bot_1:private:魔兮" },
    message: {
      messageId: "m1",
      spoken: "产品的呢",
      rawSpoken: "产品的呢",
      roomType: 2,
      textType: 1,
      receivedName: "魔兮",
      atMe: "false"
    },
    flow: {
      currentNode: { id: "node_1", name: "发资料" },
      recentMessages: [heavyHistoryMessage]
    }
  });

  assert.match(request.message, /"content": "我发您看下"/);
  assert.doesNotMatch(request.message, /rawPayload/);
  assert.doesNotMatch(request.message, /agentReply/);
  assert.doesNotMatch(request.message, /worktoolMessageIds/);
  assert.doesNotMatch(JSON.stringify(request.metadata), /agentReply/);
});

test("buildDclawActivationRequest also sends compact recent messages", () => {
  const request = buildDclawActivationRequest({
    binding,
    conversationKey: "bot_1:private:魔兮",
    task: {
      id: 7,
      nodeId: "node_1",
      attemptNumber: 1,
      maxTimes: 2,
      messages: ["再提醒您一下"],
      intervalMinutes: 30
    },
    flow: {
      currentNode: { id: "node_1", name: "发资料" },
      recentMessages: [heavyHistoryMessage]
    },
    recentMessages: [heavyHistoryMessage]
  });

  assert.match(request.message, /"content": "我发您看下"/);
  assert.doesNotMatch(request.message, /rawPayload/);
  assert.doesNotMatch(request.message, /agentReply/);
  assert.doesNotMatch(request.message, /worktoolMessageIds/);
});
