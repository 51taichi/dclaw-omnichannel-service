import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDclawGroupAutomationRequest,
  buildDclawRequest
} from "../src/dclaw.js";
import {
  buildGroupAgentTurns,
  formatGroupAgentTurns
} from "../src/group-agent-turns.js";
import { resolveGroupReplyDecision } from "../src/groups.js";

const binding = {
  botId: "bot-memory",
  agentId: "agent-memory"
};

const conversation = {
  conversationKey: "bot-memory:group-id:delivery-group",
  conversationEpoch: "epoch-7"
};

const group = {
  id: "delivery-group",
  currentName: "交付服务群",
  background: "用于客户交付跟进"
};

const roles = [
  {
    id: "role-customer",
    currentName: "张三",
    identityType: "客户",
    description: "客户负责人",
    replyPolicy: "always"
  },
  {
    id: "role-colleague",
    currentName: "李四",
    identityType: "同事",
    description: "内部交付同事",
    replyPolicy: "never"
  },
  {
    id: "role-teacher",
    currentName: "王老师",
    identityType: "授课老师",
    description: "直播授课老师",
    replyPolicy: "mention_only"
  }
];

function inboundItem({ id, at, speaker, content, rolePolicy, atMe }) {
  const decision = resolveGroupReplyDecision({
    groupPolicy: "mention_only",
    rolePolicy,
    atMe
  });
  return {
    conversationMessageId: id,
    conversationMessageCreatedAt: at,
    message: {
      messageId: `upstream-${id}`,
      receivedName: speaker,
      spoken: content,
      rawSpoken: content,
      groupName: group.currentName,
      roomType: 1,
      atMe: String(Boolean(atMe))
    },
    groupReplyDecision: {
      ...decision,
      originalAtMe: Boolean(atMe)
    }
  };
}

function buildLiveRequest(items) {
  const invokedItems = items.filter((item) => item.groupReplyDecision.invokeAgent);
  const groupTurns = buildGroupAgentTurns({ items: invokedItems, roles });
  const latest = invokedItems.at(-1);
  return {
    invokedItems,
    groupTurns,
    request: buildDclawRequest({
      binding,
      conversation,
      message: {
        ...latest.message,
        spoken: formatGroupAgentTurns(groupTurns)
      },
      groupContext: {
        groupId: group.id,
        background: group.background,
        roles,
        replyDecision: {
          authorized: true,
          effectivePolicy: latest.groupReplyDecision.effectivePolicy,
          originalAtMe: latest.groupReplyDecision.originalAtMe,
          reason: latest.groupReplyDecision.reason
        }
      },
      groupTurns
    })
  };
}

test("normal group turns retain only Agent-triggering messages with independent speakers", () => {
  const ignoredColleagueText = "内部同事的非触发消息不能进入 Agent 会话";
  const ignoredUnmentionedText = "没有 @ 的授课老师消息不能进入 Agent 会话";
  const live = buildLiveRequest([
    inboundItem({
      id: 201,
      at: "2026-08-06T01:00:01.000Z",
      speaker: "李四",
      content: ignoredColleagueText,
      rolePolicy: "never",
      atMe: true
    }),
    inboundItem({
      id: 202,
      at: "2026-08-06T01:00:02.000Z",
      speaker: "王老师",
      content: ignoredUnmentionedText,
      rolePolicy: "mention_only",
      atMe: false
    }),
    inboundItem({
      id: 203,
      at: "2026-08-06T01:00:03.000Z",
      speaker: "张三",
      content: "今天的作业已经交了",
      rolePolicy: "always",
      atMe: false
    }),
    inboundItem({
      id: 204,
      at: "2026-08-06T01:00:04.000Z",
      speaker: "王老师",
      content: "@机器人 我确认已经收到作业",
      rolePolicy: "mention_only",
      atMe: true
    })
  ]);

  assert.deepEqual(live.invokedItems.map((item) => item.conversationMessageId), [203, 204]);
  assert.deepEqual(live.groupTurns.map((turn) => [turn.messageId, turn.speakerName]), [
    [203, "张三"],
    [204, "王老师"]
  ]);
  assert.match(live.request.message, /M203[\s\S]*张三[\s\S]*今天的作业已经交了/u);
  assert.match(live.request.message, /M204[\s\S]*王老师[\s\S]*我确认已经收到作业/u);
  assert.doesNotMatch(live.request.message, new RegExp(ignoredColleagueText, "u"));
  assert.doesNotMatch(live.request.message, new RegExp(ignoredUnmentionedText, "u"));
});

test("scheduled group task reuses the exact ordinary group Agent session", () => {
  const live = buildLiveRequest([
    inboundItem({
      id: 205,
      at: "2026-08-06T01:30:00.000Z",
      speaker: "张三",
      content: "本周两次课程都已经完成",
      rolePolicy: "always",
      atMe: false
    })
  ]).request;
  const automation = buildDclawGroupAutomationRequest({
    binding,
    conversation,
    group,
    roles,
    task: {
      id: "weekly-review",
      taskType: "periodic_summary",
      summaryTemplate: "本周完成 {{明确已经完成的课程次数}} 次课"
    },
    occurrence: {
      id: "weekly-review-2026-w32",
      scheduledFor: "2026-08-09T10:00:00.000+08:00",
      cycleStartAt: "2026-08-03T00:00:00.000+08:00",
      cycleEndAt: "2026-08-10T00:00:00.000+08:00"
    }
  });

  assert.equal(automation.external_user_id, live.external_user_id);
  assert.equal(automation.external_session_id, live.external_session_id);
  assert.equal(automation.metadata.conversationId, live.metadata.conversationId);
  assert.equal(automation.metadata.localConversationId, conversation.conversationKey);
  assert.match(automation.message, /existing conversation history is the only historical source/iu);
  assert.doesNotMatch(automation.message, /historyTranscript|group-history-analysis/iu);
});
