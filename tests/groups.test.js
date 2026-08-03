import assert from "node:assert/strict";
import test from "node:test";

import {
  SYSTEM_DATE_TAG_GROUP_ID,
  buildGroupAgentContext,
  buildGroupTagContext,
  resolveGroupReplyDecision
} from "../src/groups.js";

test("role reply policy overrides the group and mention-only checks atMe", () => {
  assert.deepEqual(resolveGroupReplyDecision({
    groupPolicy: "always",
    rolePolicy: "mention_only",
    atMe: "false"
  }), {
    invokeAgent: false,
    reason: "mention_required",
    effectivePolicy: "mention_only"
  });
  assert.equal(resolveGroupReplyDecision({
    groupPolicy: "mention_only",
    rolePolicy: "always",
    atMe: "false"
  }).invokeAgent, true);
  assert.equal(resolveGroupReplyDecision({
    groupPolicy: "always",
    rolePolicy: "never",
    atMe: "true"
  }).invokeAgent, false);
});

test("group tag context keeps only bound groups and the date rule", () => {
  const context = buildGroupTagContext({
    schema: {
      dateTag: { enabled: true, cutoffTime: "00:00" },
      groups: [
        {
          id: "emotion",
          name: "情绪",
          tags: [{ id: "angry", name: "有情绪", condition: "客户表达不满" }]
        },
        {
          id: "intent",
          name: "意向",
          tags: [{ id: "high", name: "高意向", condition: "客户明确购买" }]
        }
      ]
    },
    boundTagGroupIds: [SYSTEM_DATE_TAG_GROUP_ID, "emotion"],
    currentTags: [{ groupId: "emotion", tagId: "angry" }]
  });

  assert.equal(context.dateTagEnabled, true);
  assert.deepEqual(context.groups.map((group) => group.id), ["emotion"]);
  assert.equal(context.currentTags[0].tagId, "angry");
});

test("group agent context describes configured roles without membership claims", () => {
  const context = buildGroupAgentContext({
    group: { id: "g1", background: "A产品售后服务群" },
    roles: [{
      currentName: "张三",
      identityType: "customer",
      description: "甲方负责人"
    }],
    speakerName: "张三"
  });

  assert.equal(context.speaker.description, "甲方负责人");
  assert.equal(context.roles.length, 1);
  assert.equal("membershipStatus" in context.roles[0], false);
});

test("group agent context carries the server reply authorization and matched role", () => {
  const context = buildGroupAgentContext({
    group: { id: "g1", background: "A产品售后服务群" },
    roles: [{
      id: "role-1",
      currentName: "魔兮",
      identityType: "customer",
      description: "客户代表",
      replyPolicy: "always"
    }],
    speakerName: "魔兮",
    replyDecision: {
      invokeAgent: true,
      reason: "policy_matched",
      effectivePolicy: "always",
      originalAtMe: false,
      matchedRole: {
        id: "role-1",
        currentName: "魔兮",
        replyPolicy: "always"
      }
    }
  });

  assert.deepEqual(context.replyDecision, {
    authorized: true,
    reason: "policy_matched",
    effectivePolicy: "always",
    originalAtMe: false,
    matchedRole: {
      id: "role-1",
      name: "魔兮",
      replyPolicy: "always"
    }
  });
});
