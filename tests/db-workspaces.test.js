import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnichannel-workspaces-db-test-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");

function createBot(botId) {
  return db.upsertBotBinding({
    botId,
    botName: botId,
    agentId: `agent_${botId}`,
    agentName: botId,
    dclawBaseUrl: "https://dclaw.example.test",
    dclawPublicId: `public_${botId}`,
    agentApiKey: "",
    enabled: true
  });
}

test("workspace assignment is exclusive and transfer preserves Bot data", () => {
  createBot("bot_a");
  createBot("bot_b");
  const first = db.insertWorkspace({
    name: "第一入口",
    slug: "first-entry",
    challengeText: "天王盖地虎",
    responseHash: "hash-a"
  });
  const second = db.insertWorkspace({
    name: "第二入口",
    slug: "second-entry",
    challengeText: "我们的目标是",
    responseHash: "hash-b"
  });

  db.assignBotsToWorkspace({ workspaceId: first.id, botIds: ["bot_a", "bot_b"] });
  assert.deepEqual(
    db.listWorkspaceBots(first.id).map((bot) => bot.botId).sort(),
    ["bot_a", "bot_b"]
  );
  assert.throws(
    () => db.assignBotsToWorkspace({ workspaceId: second.id, botIds: ["bot_a"] }),
    /already assigned/
  );

  db.transferBotToWorkspace({ botId: "bot_a", targetWorkspaceId: second.id });
  assert.deepEqual(db.listWorkspaceBots(second.id).map((bot) => bot.botId), ["bot_a"]);
  assert.equal(db.getBotBinding("bot_a").botName, "bot_a");
});

test("workspace removal unassigns Bots without deleting them", () => {
  const workspace = db.getWorkspaceBySlug("first-entry");
  const result = db.deleteWorkspaceRecord(workspace.id);

  assert.equal(result.unassignedBotCount, 1);
  assert.equal(db.getBotBinding("bot_b").botId, "bot_b");
  assert.equal(db.getWorkspaceById(workspace.id), null);
  assert.equal(db.listUnassignedBotBindings().some((bot) => bot.botId === "bot_b"), true);
});
