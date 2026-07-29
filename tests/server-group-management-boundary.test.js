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
    '"/api/groups/:groupId/external"',
    '"/api/groups/:groupId/roles"'
  ]) {
    assert.match(server, new RegExp(route.replace(/[/:?]/g, "\\$&")));
  }
  assert.match(server, /assertBotAccess\(req, botId\)/);
  assert.match(server, /String\(req\.query\.refresh[^]*=== "1"/);
  assert.match(server, /listWorkToolGroups/);
});

test("external group writes are planned server-side and unchanged values are skipped", () => {
  assert.match(server, /planGroupExternalPatch/);
  assert.match(server, /externalPatch\.changed/);
  assert.match(server, /planMemberRemarkChanges/);
  assert.match(server, /currentRemark \|\| original\.currentName/);
  assert.match(server, /currentRemark \|\| saved\.group\.currentName/);
  assert.doesNotMatch(server, /removeGroupMember|kickGroupMember/);
});

test("group version conflicts map to HTTP 409", () => {
  assert.match(server, /GROUP_VERSION_CONFLICT/);
  assert.match(server, /error\.status = 409/);
});
