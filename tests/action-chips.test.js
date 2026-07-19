import assert from "node:assert/strict";
import test from "node:test";

import {
  extractActionChips,
  mergeInlineActions,
  serializeActionChip,
  stripActionChips
} from "../src/action-chips.js";

test("serializes and extracts invite-to-group chips", () => {
  const chip = serializeActionChip({
    id: "action_9",
    type: "invite_to_group",
    groupName: "直播课学习群",
    target: "current_contact",
    showMessageHistory: true
  });

  assert.equal(chip, "[动作：拉入 直播课学习群]");
  assert.deepEqual(extractActionChips(`我先拉你进群 ${chip}`), [
    {
      id: "action_1",
      type: "invite_to_group",
      groupName: "直播课学习群",
      target: "current_contact",
      showMessageHistory: false,
      runOnce: true
    }
  ]);
});

test("strips chips from customer-visible text", () => {
  assert.equal(
    stripActionChips("我先拉你进群。[动作：拉入 直播课学习群] 进去后看群公告。"),
    "我先拉你进群。进去后看群公告。"
  );
  assert.equal(stripActionChips("[动作：拉入 直播课学习群]"), "");
});

test("mergeInlineActions appends textual chips after existing structured actions", () => {
  assert.deepEqual(
    mergeInlineActions({
      content: "收到。[动作：拉入 直播课学习群]",
      actions: [{ id: "manual_1", type: "invite_to_group", groupName: "老群", target: "current_contact" }]
    }),
    {
      content: "收到。",
      actions: [
        {
          id: "manual_1",
          type: "invite_to_group",
          groupName: "老群",
          target: "current_contact",
          showMessageHistory: false,
          runOnce: true
        },
        {
          id: "action_2",
          type: "invite_to_group",
          groupName: "直播课学习群",
          target: "current_contact",
          showMessageHistory: false,
          runOnce: true
        }
      ]
    }
  );
});
