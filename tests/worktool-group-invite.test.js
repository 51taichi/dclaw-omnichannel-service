import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGroupInviteCommand,
  sendGroupInviteCommand
} from "../src/worktool.js";

test("buildGroupInviteCommand builds WorkTool type 207 payload", () => {
  assert.deepEqual(
    buildGroupInviteCommand({
      groupName: "直播课学习群",
      targets: ["张三"],
      showMessageHistory: true
    }),
    {
      type: 207,
      groupName: "直播课学习群",
      selectList: ["张三"],
      removeList: [],
      showMessageHistory: true
    }
  );
});

test("buildGroupInviteCommand validates group name and targets", () => {
  assert.throws(
    () => buildGroupInviteCommand({ groupName: "", targets: ["张三"] }),
    /groupName must be a non-empty string/
  );
  assert.throws(
    () => buildGroupInviteCommand({ groupName: "直播课学习群", targets: [] }),
    /targets must be a non-empty array/
  );
});

test("sendGroupInviteCommand is exported separately from titleList raw commands", () => {
  assert.equal(typeof sendGroupInviteCommand, "function");
});
