import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGroupAgentTurns,
  formatGroupAgentTurns
} from "../src/group-agent-turns.js";

const roles = [
  {
    id: "role-customer",
    currentName: "张三",
    aliases: ["张老师"],
    identityType: "客户",
    description: "客户负责人",
    replyPolicy: "always"
  },
  {
    id: "role-colleague",
    currentName: "李四",
    aliases: [],
    identityType: "同事",
    description: "交付老师",
    replyPolicy: "mention_only"
  }
];

test("group turns preserve each persisted speaker, time, role and reply decision", () => {
  const turns = buildGroupAgentTurns({
    roles,
    items: [
      {
        conversationMessageId: 101,
        conversationMessageCreatedAt: "2026-08-05T06:30:01.000Z",
        message: { receivedName: "张老师", spoken: "第一句话" },
        groupReplyDecision: {
          originalAtMe: false,
          effectivePolicy: "always",
          reason: "role_always"
        }
      },
      {
        conversationMessageId: 102,
        conversationMessageCreatedAt: "2026-08-05T06:30:04.000Z",
        message: { receivedName: "李四", spoken: "第二句话" },
        groupReplyDecision: {
          originalAtMe: true,
          effectivePolicy: "mention_only",
          reason: "mentioned"
        }
      }
    ]
  });

  assert.deepEqual(turns, [
    {
      messageId: 101,
      occurredAt: "2026-08-05T06:30:01.000Z",
      speakerName: "张老师",
      roleId: "role-customer",
      identityType: "客户",
      roleDescription: "客户负责人",
      content: "第一句话",
      realAtMe: false,
      effectiveReplyPolicy: "always",
      triggerReason: "role_always"
    },
    {
      messageId: 102,
      occurredAt: "2026-08-05T06:30:04.000Z",
      speakerName: "李四",
      roleId: "role-colleague",
      identityType: "同事",
      roleDescription: "交付老师",
      content: "第二句话",
      realAtMe: true,
      effectiveReplyPolicy: "mention_only",
      triggerReason: "mentioned"
    }
  ]);
  assert.equal(
    formatGroupAgentTurns(turns),
    [
      "[M101｜2026-08-05 14:30:01｜张老师｜客户负责人]",
      "第一句话",
      "",
      "[M102｜2026-08-05 14:30:04｜李四｜交付老师]",
      "第二句话"
    ].join("\n")
  );
});

test("one group message uses the same structured turn contract", () => {
  const turns = buildGroupAgentTurns({
    roles,
    items: [{
      conversationMessageId: 103,
      acceptedAt: "2026-08-05T06:31:00.000Z",
      message: { receivedName: "张三", rawSpoken: "单条消息" },
      groupReplyDecision: {
        originalAtMe: false,
        effectivePolicy: "always",
        reason: "role_always"
      }
    }]
  });

  assert.equal(turns.length, 1);
  assert.equal(turns[0].messageId, 103);
  assert.equal(turns[0].speakerName, "张三");
  assert.equal(turns[0].content, "单条消息");
  assert.match(formatGroupAgentTurns(turns), /^\[M103｜2026-08-05 14:31:00｜张三｜客户负责人\]/u);
});

test("group turns reject an item without a persisted local message id", () => {
  assert.throws(() => buildGroupAgentTurns({
    roles,
    items: [{
      conversationMessageId: "",
      acceptedAt: "2026-08-05T06:31:00.000Z",
      message: { messageId: "upstream-only", receivedName: "张三", spoken: "不能替代" },
      groupReplyDecision: { effectivePolicy: "always", reason: "role_always" }
    }]
  }), /persisted group conversationMessageId is required/u);
});
