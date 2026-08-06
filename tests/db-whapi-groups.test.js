import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");

function runDatabaseScenario(source) {
  const directory = mkdtempSync(path.join(tmpdir(), "dclaw-whapi-groups-"));
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_PATH: path.join(directory, "groups.sqlite") },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("Whapi groups use account-scoped stable IDs while names remain mutable", () => {
  const result = runDatabaseScenario(`
    import { createOrGetGroup, getGroupByExternalId } from "./src/db.js";
    const first = createOrGetGroup({
      botId: "bot-a", provider: "whapi", channelAccountId: "CHAN-A",
      externalGroupId: "12001@g.us", currentName: "Old name", source: "whapi"
    });
    const renamed = createOrGetGroup({
      botId: "bot-a", provider: "whapi", channelAccountId: "CHAN-A",
      externalGroupId: "12001@g.us", currentName: "New name", source: "whapi"
    });
    const isolated = createOrGetGroup({
      botId: "bot-b", provider: "whapi", channelAccountId: "CHAN-B",
      externalGroupId: "12001@g.us", currentName: "Other account", source: "whapi"
    });
    console.log(JSON.stringify({ first, renamed, isolated, lookup: getGroupByExternalId({
      botId: "bot-a", provider: "whapi", channelAccountId: "CHAN-A", externalGroupId: "12001@g.us"
    }) }));
  `);

  assert.equal(result.first.id, result.renamed.id);
  assert.equal(result.renamed.currentName, "New name");
  assert.equal(result.renamed.conversationKey, "whapi:CHAN-A:group:12001@g.us");
  assert.equal(result.lookup.id, result.first.id);
  assert.notEqual(result.isolated.id, result.first.id);
  assert.equal(result.isolated.conversationKey, "whapi:CHAN-B:group:12001@g.us");
});

test("Whapi group participant snapshots update names without losing stable member IDs", () => {
  const result = runDatabaseScenario(`
    import { createOrGetGroup, listManagedGroupMembers, replaceManagedGroupMembers } from "./src/db.js";
    const group = createOrGetGroup({
      botId: "bot-a", provider: "whapi", channelAccountId: "CHAN-A",
      externalGroupId: "12001@g.us", currentName: "Support", source: "whapi"
    });
    replaceManagedGroupMembers({ botId: "bot-a", groupId: group.id, members: [
      { externalId: "15550001", displayName: "Ada", role: "admin" },
      { externalId: "15550002", displayName: "Grace", role: "member" }
    ] });
    replaceManagedGroupMembers({ botId: "bot-a", groupId: group.id, members: [
      { externalId: "15550001", displayName: "Ada Lovelace", role: "admin" }
    ] });
    console.log(JSON.stringify(listManagedGroupMembers({ botId: "bot-a", groupId: group.id })));
  `);

  assert.deepEqual(result.map((member) => ({
    externalId: member.externalId,
    displayName: member.displayName,
    role: member.role
  })), [{ externalId: "15550001", displayName: "Ada Lovelace", role: "admin" }]);
});

test("Whapi mentions resolve display names and mention-all to stable participant IDs", () => {
  const result = runDatabaseScenario(`
    import { createOrGetGroup, replaceManagedGroupMembers, resolveManagedGroupMentionIds } from "./src/db.js";
    const group = createOrGetGroup({ botId: "bot-a", provider: "whapi", channelAccountId: "CHAN-A", externalGroupId: "12001@g.us", currentName: "Support", source: "whapi" });
    replaceManagedGroupMembers({ botId: "bot-a", groupId: group.id, members: [
      { externalId: "15550001", displayName: "Ada" }, { externalId: "15550002", displayName: "Grace" }
    ] });
    console.log(JSON.stringify({
      selected: resolveManagedGroupMentionIds({ botId: "bot-a", externalGroupId: "12001@g.us", names: ["Ada"] }),
      all: resolveManagedGroupMentionIds({ botId: "bot-a", externalGroupId: "12001@g.us", names: ["@所有人"] })
    }));
  `);
  assert.deepEqual(result.selected, ["15550001"]);
  assert.deepEqual(result.all, ["15550001", "15550002"]);
});
