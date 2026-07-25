import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDclawAttachmentSourceRetryRequest,
  buildDclawReplyFormatRetryRequest,
  buildDclawRequest,
  buildDclawTagActivationRequest,
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

test("buildDclawRequest includes tag rules when explicitly requested", () => {
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

test("buildDclawRequest includes bounded evidence candidates for tag decisions", () => {
  const request = buildDclawRequest({
    binding,
    conversation,
    message,
    tagContext: {
      groups: [{
        id: "intent",
        name: "意向",
        tags: [{ id: "b", name: "B类", condition: "询问老师" }]
      }],
      currentTags: []
    },
    tagEvidenceCandidates: [{
      id: "321",
      conversationMessageId: 321,
      text: "你们老师的水平怎么样"
    }]
  });

  assert.deepEqual(request.metadata.tagEvidenceCandidates, [{
    id: "321",
    conversationMessageId: 321,
    text: "你们老师的水平怎么样"
  }]);
  assert.match(request.message, /evidenceMessageId/);
  assert.match(request.message, /你们老师的水平怎么样/);
});

test("buildDclawRequest omits tag rules from normal requests", () => {
  const request = buildDclawRequest({ binding, conversation, message });

  assert.doesNotMatch(request.message, /tagRules/);
  assert.doesNotMatch(request.message, /tagDecision/);
  assert.equal(request.metadata.tagRules, undefined);
});

test("buildDclawRequest carries the flow general rule", () => {
  const request = buildDclawRequest({
    binding,
    conversation,
    message,
    flow: {
      machine: {
        generalRule: "回复内容不要发送未确认的课程链接",
        nodes: []
      }
    }
  });

  assert.equal(request.metadata.generalRule, "回复内容不要发送未确认的课程链接");
  assert.match(request.message, /最高优先级业务规则/);
  assert.match(request.message, /不要发送未确认的课程链接/);
});

test("buildDclawRequest carries the rule even when no flow context is active", () => {
  const request = buildDclawRequest({
    binding,
    conversation,
    message,
    generalRule: "回复内容不要出现内部处理说明"
  });

  assert.equal(request.metadata.generalRule, "回复内容不要出现内部处理说明");
  assert.match(request.message, /不要出现内部处理说明/);
});

test("buildDclawRequest includes bounded legacy customer text and tag guidance", () => {
  const request = buildDclawRequest({
    binding,
    conversation,
    message,
    flow: {
      machine: {
        nodes: [{ id: "final", name: "持续服务" }]
      },
      currentNode: {
        id: "final",
        name: "持续服务",
        goal: "基于历史继续交流"
      },
      session: {
        currentNodeId: "final",
        customerOrigin: "legacy"
      }
    },
    tagContext: {
      groups: [{
        id: "status",
        name: "客户状态",
        tags: [{ id: "paid", name: "已付费", condition: "客户明确表示已经付款" }]
      }],
      currentTags: []
    },
    legacyHistoryAnalysis: {
      text: "之前咨询过课程\n我刚刚已经付费了",
      selectedCount: 2,
      omittedCount: 60,
      selectedChars: 17,
      configuredLimit: 4000
    }
  });

  assert.match(request.message, /客户历史发言（纯文本，按时间从旧到新）/);
  assert.match(request.message, /之前咨询过课程\n我刚刚已经付费了/);
  assert.match(request.message, /tagDecision/);
  assert.doesNotMatch(request.message, /history_context/);
  assert.doesNotMatch(request.message, /"messages":\s*\[/);
  assert.equal(request.metadata.historyAnalysis.selectedCount, 2);
  assert.equal(request.metadata.historyAnalysis.omittedCount, 60);
  assert.equal(request.metadata.historyAnalysis.text, undefined);
});

test("buildDclawRequest omits empty legacy history", () => {
  const request = buildDclawRequest({
    binding,
    conversation,
    message,
    legacyHistoryAnalysis: {
      text: "",
      selectedCount: 0,
      omittedCount: 0,
      selectedChars: 0,
      configuredLimit: 4000
    }
  });

  assert.equal(request.metadata.historyAnalysis, undefined);
  assert.doesNotMatch(request.message, /客户历史发言（纯文本/);
});

test("buildDclawTagActivationRequest carries the general rule", () => {
  const request = buildDclawTagActivationRequest({
    binding,
    conversationKey: conversation.conversationKey,
    task: { id: 3, messageContent: "跟进一下" },
    generalRule: "回复不要附带未确认链接"
  });

  assert.equal(request.metadata.generalRule, "回复不要附带未确认链接");
  assert.match(request.message, /最高优先级业务规则/);
  assert.match(request.message, /不要附带未确认链接/);
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

test("retry prompts preserve an enabled tagDecision schema", () => {
  const request = buildDclawRequest({
    binding,
    conversation,
    message,
    tagContext: {
      groups: [{ id: "intent", tags: [{ id: "b" }] }],
      currentTags: []
    }
  });
  assert.match(buildDclawReplyFormatRetryRequest(request).message, /tagDecision/);
  assert.match(buildDclawAttachmentSourceRetryRequest(request, {}).message, /tagDecision/);
});

test("legacy flow requests preserve dynamic collectible fields across task nodes", () => {
  const earlierFields = ["姓名", "手机", "地区"];
  const currentFields = ["预约时间", "是否陪同"];
  const legacyRequest = buildDclawRequest({
    binding,
    conversation,
    message,
    flow: {
      machine: {
        nodes: [
          { id: "entry", collectFields: earlierFields },
          { id: "final", collectFields: currentFields }
        ]
      },
      session: {
        currentNodeId: "final",
        customerOrigin: "legacy",
        collectedData: { 姓名: "魔兮" }
      },
      currentNode: { id: "final", collectFields: currentFields }
    },
    legacyHistoryAnalysis: {
      text: "我还是告诉你号码吧，18570860666",
      selectedCount: 1,
      omittedCount: 0,
      selectedChars: 20,
      configuredLimit: 4000
    }
  });

  for (const field of [...earlierFields, ...currentFields]) {
    assert.match(legacyRequest.message, new RegExp(field));
  }
  assert.match(legacyRequest.message, /collectibleFields/);
  assert.match(legacyRequest.message, /只补充尚未收集的字段/);
  assert.match(legacyRequest.message, /"collectedData": \{\s*"姓名": "魔兮"/);

  const normalRequest = buildDclawRequest({
    binding,
    conversation,
    message,
    flow: {
      machine: {
        nodes: [
          { id: "entry", collectFields: earlierFields },
          { id: "final", collectFields: currentFields }
        ]
      },
      session: { currentNodeId: "final", collectedData: {} },
      currentNode: { id: "final", collectFields: currentFields }
    }
  });
  assert.doesNotMatch(normalRequest.message, /collectibleFields/);
  assert.doesNotMatch(normalRequest.message, /"手机"/);
});
