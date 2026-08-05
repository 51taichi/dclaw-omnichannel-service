import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDclawGroupAutomationRequest,
  buildDclawRequest,
  getDclawRequestMessageMaxChars
} from "../src/dclaw.js";

const binding = {
  botId: "bot-1",
  agentId: "agent-1",
  agentApiUrl: "https://dclaw.example.test/api/open/v1/targets/demo/messages",
  agentApiKey: "test-key"
};

const conversation = {
  conversationKey: "bot-1:group-id:group-1",
  conversationEpoch: "epoch-1"
};

const group = {
  id: "group-1",
  currentName: "学习服务群",
  background: "客户购买了课程"
};

const roles = [{
  id: "role-parent",
  currentName: "家长",
  identityType: "客户",
  description: "学生家长"
}];

const occurrence = {
  id: "occurrence-1",
  scheduledFor: "2026-08-06T09:00:00.000+08:00",
  cycleStartAt: "2026-08-06T00:00:00.000+08:00",
  cycleEndAt: "2026-08-07T00:00:00.000+08:00"
};

const conditionTask = {
  id: "task-1",
  taskType: "conditional_push",
  conditionText: "今天客户已经完成作业",
  content: "今天的作业已经完成，辛苦啦！"
};

function liveGroupRequest(currentConversation = conversation) {
  return buildDclawRequest({
    binding,
    conversation: currentConversation,
    message: {
      messageId: "upstream-101",
      spoken: "[M101｜2026-08-06 08:30:00｜家长｜学生家长]\n作业完成了",
      rawSpoken: "作业完成了",
      roomType: 1,
      groupName: "学习服务群",
      receivedName: "家长",
      atMe: "true"
    },
    groupContext: {
      groupId: "group-1",
      background: "客户购买了课程",
      roles,
      replyDecision: { authorized: true, effectivePolicy: "always" }
    },
    groupTurns: [{
      messageId: 101,
      occurredAt: "2026-08-06T00:30:00.000Z",
      speakerName: "家长",
      roleId: "role-parent",
      identityType: "客户",
      roleDescription: "学生家长",
      content: "作业完成了",
      realAtMe: false,
      effectiveReplyPolicy: "always",
      triggerReason: "role_always"
    }]
  });
}

test("group automation reuses the normal group conversation identity", () => {
  const live = liveGroupRequest();
  const automation = buildDclawGroupAutomationRequest({
    binding,
    conversation,
    group,
    roles,
    task: conditionTask,
    occurrence
  });

  assert.equal(automation.external_user_id, live.external_user_id);
  assert.equal(automation.external_session_id, live.external_session_id);
  assert.equal(automation.metadata.conversationId, live.metadata.conversationId);
  assert.equal(automation.metadata.localConversationId, conversation.conversationKey);
  assert.equal(automation.metadata.eventType, "group_automation");
  assert.equal(automation.metadata.internal, true);
  assert.equal(automation.metadata.occurrenceId, occurrence.id);
  assert.match(automation.message, /"eventType": "group_automation"/u);
  assert.match(automation.message, /existing conversation history is the only historical source/iu);
  assert.match(automation.message, /"evidenceMessageIds":\[\]/u);
  assert.doesNotMatch(
    automation.message,
    /"historyTranscript"|group-history-analysis|"eventType": "group_history_analysis"/iu
  );
});

test("conversation reset rotates live and automation sessions together", () => {
  const nextConversation = { ...conversation, conversationEpoch: "epoch-2" };
  const previousLive = liveGroupRequest(conversation);
  const nextLive = liveGroupRequest(nextConversation);
  const nextAutomation = buildDclawGroupAutomationRequest({
    binding,
    conversation: nextConversation,
    group,
    roles,
    task: conditionTask,
    occurrence: { ...occurrence, id: "occurrence-2" }
  });

  assert.notEqual(nextLive.external_session_id, previousLive.external_session_id);
  assert.equal(nextAutomation.external_session_id, nextLive.external_session_id);
  assert.notEqual(nextAutomation.external_session_id, previousLive.external_session_id);
});

test("periodic summary request has no achievement condition and requires generated content", () => {
  const request = buildDclawGroupAutomationRequest({
    binding,
    conversation,
    group,
    roles,
    task: {
      id: "task-summary",
      taskType: "periodic_summary",
      summaryTemplate: "本周上课 {{本周明确完成的课程次数}} 次"
    },
    occurrence
  });

  assert.match(request.message, /"taskType": "periodic_summary"/u);
  assert.match(request.message, /"content":"可直接发送内容"/u);
  assert.doesNotMatch(request.message, /"conditionText":/u);
});

test("group automation request remains within the shared Agent request limit", () => {
  const request = buildDclawGroupAutomationRequest({
    binding,
    conversation,
    group: { ...group, background: "背景".repeat(3000) },
    roles: Array.from({ length: 100 }, (_, index) => ({
      id: `role-${index}`,
      currentName: `成员-${index}-${"名".repeat(100)}`,
      identityType: "客户",
      description: "职责".repeat(400)
    })),
    task: {
      id: "task-summary-long",
      taskType: "periodic_summary",
      summaryTemplate: "请汇总".repeat(3000)
    },
    occurrence
  });

  assert.ok(request.message.length <= getDclawRequestMessageMaxChars());
  assert.match(request.message, /成员-0/u);
  assert.match(request.message, /summaryTemplate/u);
});
