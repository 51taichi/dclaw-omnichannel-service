import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktool-bot-auth-test-"));
process.env.DATA_DIR = dataDir;

const auth = await import("../src/auth.js");
const db = await import("../src/db.js");

test("hashAccessKey verifies the original key but not a different key", () => {
  const hash = auth.hashAccessKey("bot-secret-123");

  assert.notEqual(hash, "bot-secret-123");
  assert.equal(auth.verifyAccessKey("bot-secret-123", hash), true);
  assert.equal(auth.verifyAccessKey("wrong-secret", hash), false);
  assert.equal(auth.verifyAccessKey("", hash), false);
});

test("bot sessions are scoped to one bot and role", () => {
  const session = auth.createBotSession({ botId: "bot_a", role: "bot", ttlMs: 1000 });

  assert.equal(session.botId, "bot_a");
  assert.equal(session.role, "bot");
  assert.equal(typeof session.token, "string");
  assert.equal(auth.getBotSession(session.token).botId, "bot_a");

  auth.deleteBotSession(session.token);

  assert.equal(auth.getBotSession(session.token), null);
});

test("publicBotView redacts sensitive binding fields", () => {
  const binding = db.upsertBotBinding({
    botId: "bot_public",
    botName: "公开机器人",
    agentId: "agent_public",
    agentName: "公开客服",
    dclawBaseUrl: "https://dclaw.example.test",
    dclawPublicId: "public_id",
    agentApiKey: "qp_live_secret",
    enabled: true
  });

  db.setBotAccessKey({ botId: "bot_public", accessKey: "bot-key" });
  const publicView = auth.publicBotView(db.getBotBinding(binding.botId));

  assert.equal(publicView.botId, "bot_public");
  assert.equal(publicView.botName, "公开机器人");
  assert.equal(publicView.agentId, "agent_public");
  assert.equal(publicView.agentName, "公开客服");
  assert.equal(publicView.enabled, true);
  assert.equal(publicView.hasAccessKey, true);
  assert.equal("agentApiKey" in publicView, false);
  assert.equal("agentApiUrl" in publicView, false);
  assert.equal("dclawBaseUrl" in publicView, false);
});

test("setBotAccessKey stores only a hash on the binding", () => {
  db.upsertBotBinding({
    botId: "bot_key",
    botName: "密钥机器人",
    agentId: "agent_key",
    agentName: "密钥客服",
    dclawBaseUrl: "https://dclaw.example.test",
    dclawPublicId: "public_id",
    agentApiKey: "qp_live_secret",
    enabled: true
  });

  const updated = db.setBotAccessKey({ botId: "bot_key", accessKey: "bot-secret" });

  assert.equal(updated.accessKeyHash.includes("bot-secret"), false);
  assert.equal(Boolean(updated.accessKeyUpdatedAt), true);
  assert.equal(auth.verifyAccessKey("bot-secret", updated.accessKeyHash), true);
  assert.equal(auth.verifyAccessKey("wrong", updated.accessKeyHash), false);
});
