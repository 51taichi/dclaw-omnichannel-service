import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDclawActivationRequest,
  buildDclawReplyFormatRetryRequest,
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

test("group resource requests instruct the agent to query experience and output attachments", () => {
  const request = buildDclawRequest({
    binding,
    conversation: { conversationKey: "bot_1:group:B招商服务群" },
    message: {
      messageId: "",
      spoken: "有没有产品介绍视频",
      rawSpoken: "@客服小左 有没有产品介绍视频",
      roomType: 1,
      textType: 1,
      receivedName: "魔兮",
      groupName: "B招商服务群",
      atMe: "true"
    },
    flow: null
  });

  assert.match(request.message, /群聊和私聊只在是否触发回复上不同/);
  assert.match(request.message, /不要因为是群聊就跳过资源索取、附件发送、客服经验库或企业智库/);
  assert.match(request.message, /资源索取优先级高于品牌实力解释/);
  assert.match(request.message, /必须先查可发送资源并尽量输出 attachments/);
  assert.match(request.message, /sources 中写入 experience/);
  assert.match(request.message, /"flow": null/);
  assert.doesNotMatch(request.message, /当前私聊会话启用了客服流程状态机/);
});

test("explicit experience-library questions require experience sources", () => {
  const request = buildDclawRequest({
    binding,
    conversation: { conversationKey: "bot_1:private:魔兮" },
    message: {
      messageId: "m-exp",
      spoken: "经验库里以前同事遇到这种家长是怎么沟通的？",
      rawSpoken: "经验库里以前同事遇到这种家长是怎么沟通的？",
      roomType: 2,
      textType: 1,
      receivedName: "魔兮",
      atMe: "false"
    },
    flow: null
  });

  assert.match(request.message, /客户明确提到经验库、同事怎么答、历史沟通案例或优秀话术时/);
  assert.match(request.message, /必须查询客服经验库/);
  assert.match(request.message, /sources 中写入 experience/);
});

test("flow conversations still require knowledge and experience synthesis", () => {
  const request = buildDclawRequest({
    binding,
    conversation: { conversationKey: "bot_1:private:魔兮" },
    message: {
      messageId: "m-flow-knowledge",
      spoken: "晚上直播具体讲什么",
      rawSpoken: "晚上直播具体讲什么",
      roomType: 2,
      textType: 1,
      receivedName: "魔兮",
      atMe: "false"
    },
    flow: {
      currentNode: {
        id: "node_2",
        name: "邀约直播课",
        goal: "邀请客户参加今晚直播课",
        completionCriteria: "客户明确答复是否参加"
      }
    }
  });

  assert.match(request.message, /状态机、企业智库、客服经验库必须三方合议/);
  assert.match(request.message, /状态机不能独占回答/);
  assert.match(request.message, /当前任务节点相关咨询/);
  assert.match(request.message, /不能只用状态机回答/);
  assert.match(request.message, /enterprise_knowledge/);
  assert.match(request.message, /experience/);
  assert.match(request.message, /flow_node/);
});

test("non-flow customer replies use the same strict JSON contract", () => {
  const request = buildDclawRequest({
    binding,
    conversation: { conversationKey: "bot_1:private:魔兮" },
    message: {
      messageId: "m2",
      spoken: "你好",
      rawSpoken: "你好",
      roomType: 2,
      textType: 1,
      receivedName: "魔兮",
      atMe: "false"
    },
    flow: null
  });

  assert.match(request.message, /最终请只输出一个 JSON 对象/);
  assert.match(request.message, /"reply":"发给客户的文本"/);
  assert.doesNotMatch(request.message, /普通文本回复可以直接输出/);
});

test("format repair retries preserve the original customer request", () => {
  const original = buildDclawRequest({
    binding,
    conversation: { conversationKey: "bot_1:private:魔兮" },
    message: {
      messageId: "m3",
      spoken: "你好",
      rawSpoken: "你好",
      roomType: 2,
      textType: 1,
      receivedName: "魔兮",
      atMe: "false"
    }
  });
  const repaired = buildDclawReplyFormatRetryRequest(original);

  assert.equal(repaired.external_session_id, original.external_session_id);
  assert.equal(repaired.metadata.formatRetry, true);
  assert.match(repaired.message, /上一条输出不符合客户回复协议/);
  assert.match(repaired.message, /只输出一个合法 JSON 对象/);
  assert.match(repaired.message, /"message": "你好"/);
});

test("format repair retains the flow decision schema for flow conversations", () => {
  const original = buildDclawRequest({
    binding,
    conversation: { conversationKey: "bot_1:private:魔兮" },
    message: {
      messageId: "m4",
      spoken: "我想了解合作",
      rawSpoken: "我想了解合作",
      roomType: 2,
      textType: 1,
      receivedName: "魔兮",
      atMe: "false"
    },
    flow: {
      currentNode: { id: "node_1", name: "收集信息" }
    }
  });
  const repaired = buildDclawReplyFormatRetryRequest(original);
  const repairInstructions = repaired.message.split("上一条输出不符合客户回复协议")[1] || "";

  assert.match(repairInstructions, /"flowDecision"/);
  assert.match(repairInstructions, /当前节点ID/);
});
