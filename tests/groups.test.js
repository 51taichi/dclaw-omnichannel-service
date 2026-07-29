import assert from "node:assert/strict";
import test from "node:test";

import {
  SYSTEM_DATE_TAG_GROUP_ID,
  buildGroupAgentContext,
  buildGroupTagContext,
  planGroupExternalPatch,
  planMemberRemarkChanges,
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

test("differential planners omit unchanged external writes", () => {
  assert.deepEqual(planGroupExternalPatch({
    original: { currentName: "A群", announcement: "公告", currentRemark: "" },
    next: { currentName: "A群", announcement: "公告", currentRemark: "" }
  }), { changed: false, commandFields: {} });

  assert.deepEqual(planMemberRemarkChanges([
    {
      id: "a",
      currentName: "张三",
      originalMarkName: "张三-甲方",
      desiredMarkName: "张三-甲方",
      syncMarkName: false
    },
    {
      id: "b",
      currentName: "李四",
      originalMarkName: "李四",
      desiredMarkName: "李四-助理"
    },
    {
      id: "c",
      currentName: "王五",
      originalMarkName: "王五",
      desiredMarkName: ""
    }
  ]), [{ roleId: "b", currentName: "李四", markName: "李四-助理" }]);
});
