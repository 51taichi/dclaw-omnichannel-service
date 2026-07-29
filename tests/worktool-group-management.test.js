import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCreateExternalGroupCommand,
  buildMemberRemarkCommands,
  buildModifyGroupCommand
} from "../src/worktool.js";

test("create external group builds one type 206 command with unique contacts", () => {
  assert.deepEqual(buildCreateExternalGroupCommand({
    groupName: "A售后群",
    selectList: ["张三", "李四", "张三"],
    groupAnnouncement: "售后服务群"
  }), {
    type: 206,
    groupName: "A售后群",
    selectList: ["张三", "李四"],
    groupAnnouncement: "售后服务群"
  });
});

test("modify group includes only supplied changed fields", () => {
  assert.deepEqual(buildModifyGroupCommand({
    groupName: "A售后群",
    newGroupName: "A项目交付群",
    newGroupAnnouncement: ""
  }), {
    type: 207,
    groupName: "A售后群",
    newGroupName: "A项目交付群",
    newGroupAnnouncement: "",
    selectList: [],
    removeList: [],
    showMessageHistory: false
  });
  assert.throws(
    () => buildModifyGroupCommand({ groupName: "A售后群" }),
    /at least one changed field/
  );
});

test("member remark commands use type 225 and the current recognized name", () => {
  assert.deepEqual(buildMemberRemarkCommands({
    groupName: "A售后群",
    changes: [
      { currentName: "李四", markName: "李四-助理" },
      { currentName: "王五", markName: "王五-技术" }
    ]
  }), [
    {
      type: 225,
      groupName: "A售后群",
      friend: { name: "李四", markName: "李四-助理" }
    },
    {
      type: 225,
      groupName: "A售后群",
      friend: { name: "王五", markName: "王五-技术" }
    }
  ]);
});
