import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("group management routes are Bot-authorized and keep refresh explicit", () => {
  for (const route of [
    '"/api/groups"',
    '"/api/groups/create"',
    '"/api/groups/:groupId"',
    '"/api/groups/:groupId/config"',
    '"/api/groups/:groupId/roles"'
  ]) {
    assert.match(server, new RegExp(route.replace(/[/:?]/g, "\\$&")));
  }
  assert.doesNotMatch(server, /"\/api\/groups\/:groupId\/external"/);
  assert.match(server, /assertBotAccess\(req, botId\)/);
  assert.match(server, /String\(req\.query\.refresh[^]*=== "1"/);
  assert.match(server, /listWorkToolGroups/);
});

test("group management no longer sends external group rename or member remark commands", () => {
  assert.doesNotMatch(server, /planGroupExternalPatch/);
  assert.doesNotMatch(server, /planMemberRemarkChanges/);
  assert.doesNotMatch(server, /modifyGroup(MemberRemarks)?/);
  assert.doesNotMatch(server, /markGroupRoleRemarkSynced/);
  assert.doesNotMatch(server, /removeGroupMember|kickGroupMember/);
});

test("group version conflicts map to HTTP 409", () => {
  assert.match(server, /GROUP_VERSION_CONFLICT/);
  assert.match(server, /error\.status = 409/);
});
