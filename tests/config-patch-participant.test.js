import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnichannel-config-patch-"));
process.env.DATA_DIR = dataDir;

const db = await import("../src/db.js");
const participant = await import("../src/config-patch-participant.js");

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

function seedAgent(agentId, { enabled = true } = {}) {
  return db.upsertAgent({
    agentId,
    agentName: `${agentId} name`,
    dclawBaseUrl: "https://dclaw.internal.example",
    dclawPublicId: `${agentId}-public`,
    agentApiKey: `secret-for-${agentId}`,
    enabled
  });
}

test("config patch snapshots keep Bots distinct while reading shared Agent configuration", () => {
  seedAgent("shared-agent");
  db.upsertBotBinding({
    botId: "bot-a",
    botName: "Bot A",
    agentId: "shared-agent",
    enabled: true
  });
  db.upsertBotBinding({
    botId: "bot-b",
    botName: "Bot B",
    agentId: "shared-agent",
    enabled: true
  });
  db.upsertFlowMachine({
    agentId: "shared-agent",
    enabled: true,
    config: {
      name: "Shared flow",
      version: "2.0.0",
      entryNodeId: "welcome",
      nodes: [{ id: "welcome", name: "Welcome", prompt: "Say hello" }]
    }
  });
  db.upsertAgentTagSchema({
    agentId: "shared-agent",
    schema: {
      dateTag: { enabled: true, cutoffTime: "08:00" },
      groups: [{ id: "intent", name: "Intent", tags: [{ id: "high", name: "High" }] }]
    }
  });

  const bots = participant.listConfigPatchBots();
  assert.deepEqual(bots.map(({ botId }) => botId).sort(), ["bot-a", "bot-b"]);
  assert.equal(bots.every(({ agentId }) => agentId === "shared-agent"), true);

  const snapshotA = participant.getConfigPatchBotSnapshot("bot-a");
  const snapshotB = participant.getConfigPatchBotSnapshot("bot-b");
  assert.equal(snapshotA.bot.botId, "bot-a");
  assert.equal(snapshotB.bot.botId, "bot-b");
  assert.equal(snapshotA.agent.agentId, "shared-agent");
  assert.deepEqual(snapshotA.flowMachine.config, snapshotB.flowMachine.config);
  assert.deepEqual(snapshotA.tags.config, snapshotB.tags.config);
  assert.equal(snapshotA.readiness.ready, true);
  assert.deepEqual(snapshotA.readiness.checks, {
    agent_bound: true,
    agent_enabled: true,
    bot_enabled: true,
    dclaw_location_configured: true,
    flow_readable: true,
    tags_readable: true
  });

  const serialized = JSON.stringify(snapshotA);
  for (const forbidden of [
    "agentApiKey",
    "accessKeyHash",
    "channelToken",
    "webhookSecret",
    "secret-for-shared-agent"
  ]) {
    assert.equal(serialized.includes(forbidden), false, `snapshot leaked ${forbidden}`);
  }
});

test("missing flow and tag records produce canonical empty values without writing defaults", () => {
  seedAgent("empty-agent");
  db.upsertBotBinding({
    botId: "bot-empty",
    botName: "Empty Bot",
    agentId: "empty-agent",
    enabled: true
  });

  assert.equal(db.getFlowMachineForBot("bot-empty"), null);
  assert.equal(db.getAgentTagSchema("empty-agent"), null);

  const first = participant.getConfigPatchBotSnapshot("bot-empty");
  const second = participant.getConfigPatchBotSnapshot("bot-empty");

  assert.deepEqual(first.flowMachine, { enabled: false, config: null });
  assert.deepEqual(first.tags, { config: null });
  assert.equal(first.digests.flowMachine, second.digests.flowMachine);
  assert.equal(first.digests.tags, second.digests.tags);
  assert.equal(db.getFlowMachineForBot("bot-empty"), null);
  assert.equal(db.getAgentTagSchema("empty-agent"), null);
});

test("service authentication fails closed and uses a dedicated header", () => {
  const originalSecret = process.env.OMNICHANNEL_CONFIG_PATCH_INTERNAL_SECRET;
  try {
    delete process.env.OMNICHANNEL_CONFIG_PATCH_INTERNAL_SECRET;
    assert.throws(
      () => participant.assertConfigPatchService({ header: () => undefined }),
      (error) => error.status === 503 && error.code === "CONFIG_PATCH_SERVICE_NOT_CONFIGURED"
    );

    process.env.OMNICHANNEL_CONFIG_PATCH_INTERNAL_SECRET = "internal-only-secret";
    assert.throws(
      () => participant.assertConfigPatchService({ header: () => "wrong" }),
      (error) => error.status === 401 && error.code === "CONFIG_PATCH_SERVICE_UNAUTHORIZED"
    );
    assert.equal(participant.assertConfigPatchService({
      header: (name) => name.toLowerCase() === "x-omnichannel-config-patch-secret"
        ? "internal-only-secret"
        : undefined
    }), true);
  } finally {
    if (originalSecret === undefined) delete process.env.OMNICHANNEL_CONFIG_PATCH_INTERNAL_SECRET;
    else process.env.OMNICHANNEL_CONFIG_PATCH_INTERNAL_SECRET = originalSecret;
  }
});
