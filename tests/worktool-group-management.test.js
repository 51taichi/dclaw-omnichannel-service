import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCreateExternalGroupCommand
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

test("group management client does not expose rename or member remark command helpers", async () => {
  const worktool = await import("../src/worktool.js");
  assert.equal("buildModifyGroupCommand" in worktool, false);
  assert.equal("modifyGroup" in worktool, false);
  assert.equal("buildMemberRemarkCommands" in worktool, false);
  assert.equal("modifyGroupMemberRemarks" in worktool, false);
});
