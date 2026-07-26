import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDclawAttachmentSourceRetryRequest,
  buildDclawLegacyHistoryAnalysisRequest,
  buildDclawReplyFormatRetryRequest,
  buildDclawRequest,
  buildDclawTagActivationRequest,
  parseAgentReply
} from "../src/dclaw.js";
import { buildDclawConversationIdentity } from "../src/dclaw-conversation-identity.js";

const binding = {
  botId: "tag_bot",
  agentId: "tag_agent",
  agentApiUrl: "https://dclaw.example.test/api/open/v1/targets/tag_agent/messages",
  agentApiKey: ""
};

const conversation = {
  conversationKey: "tag_bot:private:魔兮",
  conversationEpoch: "epoch-tag-1"
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

test("tag-enabled requests require a complete audit before the customer reply", () => {
  const request = buildDclawRequest({
    binding,
    conversation,
    message: { ...message, spoken: "如果请假会扣钱吗" },
    tagContext: {
      groups: [{
        id: "intent",
        name: "意向等级",
        exclusive: true,
        oneWay: true,
        tags: [
          { id: "c", name: "C类", condition: "愿意回答问题" },
          { id: "b", name: "B类", condition: "客户咨询过一个问题" }
        ]
      }],
      currentTags: [{ groupId: "intent", tagId: "c" }]
    },
    tagEvidenceCandidates: [{
      id: "1013",
      conversationMessageId: 1013,
      text: "如果请假会扣钱吗"
    }]
  });

  assert.match(request.message, /标签审计是必做步骤/);
  assert.match(request.message, /不得自行提高达标条件/);
  assert.match(request.message, /tagEvaluation/);
  assert.ok(
    request.message.indexOf("标签审计是必做步骤")
      < request.message.indexOf("企业智库负责业务事实")
  );
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

test("legacy history requests preserve stable evidence message ids", () => {
  const request = buildDclawRequest({
    binding,
    conversation,
    message,
    tagContext: {
      groups: [{
        id: "intent",
        name: "意向",
        tags: [{ id: "b", name: "B类", condition: "咨询问题" }]
      }],
      currentTags: []
    },
    legacyHistoryAnalysis: {
      text: "[321] 你们老师的水平怎么样",
      selectedCount: 1,
      omittedCount: 0,
      selectedChars: 17,
      configuredLimit: 4000
    }
  });

  assert.match(request.message, /\[321\] 你们老师的水平怎么样/);
  assert.doesNotMatch(request.message, /"messages":\s*\[/);
});

test("buildDclawLegacyHistoryAnalysisRequest isolates background analysis and forbids customer replies", () => {
  const liveRequest = buildDclawRequest({
    binding,
    conversation,
    message
  });
  const request = buildDclawLegacyHistoryAnalysisRequest({
    binding,
    conversation,
    message,
    flow: {
      machine: {
        nodes: [{
          id: "node_1",
          name: "收集信息",
          collectFields: ["手机"]
        }]
      },
      currentNode: {
        id: "node_1",
        name: "收集信息",
        collectFields: ["手机"]
      },
      session: {
        currentNodeId: "node_1",
        collectedData: {}
      }
    },
    tagContext: {
      groups: [{
        id: "intent",
        name: "意向",
        tags: [{ id: "a", name: "A类", condition: "明确付费" }]
      }],
      currentTags: []
    },
    legacyHistoryAnalysis: {
      text: "我的手机号是18570860666",
      selectedCount: 1,
      omittedCount: 0,
      selectedChars: 19,
      configuredLimit: 4000
    }
  });

  assert.equal(request.external_user_id, liveRequest.external_user_id);
  assert.equal(
    request.metadata.worktool.conversationId,
    liveRequest.metadata.worktool.conversationId
  );
  assert.notEqual(request.external_session_id, liveRequest.external_session_id);
  assert.equal(request.metadata.eventType, "legacy_history_analysis");
  assert.equal(request.metadata.liveConversationId, conversation.conversationKey);
  assert.equal(request.metadata.localConversationId, conversation.conversationKey);
  assert.match(request.message, /后台历史智能分析/);
  assert.match(request.message, /reply 必须为空字符串/);
  assert.match(request.message, /我的手机号是18570860666/);
  assert.match(request.message, /"collectibleFields":\s*\[\s*"手机"/);
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
    conversation,
    task: { id: 3, messageContent: "跟进一下" },
    generalRule: "回复不要附带未确认链接"
  });

  assert.equal(request.metadata.generalRule, "回复不要附带未确认链接");
  assert.match(request.message, /最高优先级业务规则/);
  assert.match(request.message, /不要附带未确认链接/);
  const identity = buildDclawConversationIdentity({
    botId: binding.botId,
    ...conversation,
    purpose: "conversation"
  });
  assert.equal(request.external_user_id, identity.externalUserId);
  assert.equal(request.external_session_id, identity.externalSessionId);
  assert.equal(request.metadata.conversationId, identity.runtimeConversationId);
  assert.equal(request.metadata.localConversationId, conversation.conversationKey);
});

test("parseAgentReply extracts tagEvaluation and tagDecision", () => {
  const reply = parseAgentReply(JSON.stringify({
    reply: "可以",
    attachments: [],
    sources: [],
    tagEvaluation: [{
      groupId: "intent",
      tagId: "b",
      matched: true,
      reason: "询问细节",
      evidenceMessageId: "321",
      evidenceText: "你们老师怎么样"
    }],
    tagDecision: { add: [{ groupId: "intent", tagId: "b", reason: "询问细节" }], remove: [] }
  }));

  assert.equal(reply.valid, true);
  assert.equal(reply.tagEvaluation[0].matched, true);
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
