import crypto from "node:crypto";
import {
  getAgent,
  getAgentTagSchema,
  getBotBinding,
  getFlowMachineForBot,
  listBotBindings
} from "./db.js";

const SERVICE_SECRET_HEADER = "x-omnichannel-config-patch-secret";
const SERVICE_SECRET_ENV = "OMNICHANNEL_CONFIG_PATCH_INTERNAL_SECRET";

function httpError({ status, code, message }) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function secretFingerprint(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest();
}

export function assertConfigPatchService(req) {
  const expected = process.env[SERVICE_SECRET_ENV];
  if (!expected) {
    throw httpError({
      status: 503,
      code: "CONFIG_PATCH_SERVICE_NOT_CONFIGURED",
      message: "config patch service authentication is not configured"
    });
  }

  const supplied = req.header(SERVICE_SECRET_HEADER);
  const authenticated = Boolean(supplied) && crypto.timingSafeEqual(
    secretFingerprint(supplied),
    secretFingerprint(expected)
  );
  if (!authenticated) {
    throw httpError({
      status: 401,
      code: "CONFIG_PATCH_SERVICE_UNAUTHORIZED",
      message: "config patch service authentication failed"
    });
  }
  return true;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalValue(value[key])])
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function canonicalDigest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function buildReadiness({ binding, agent }) {
  const checks = {
    agent_bound: Boolean(binding?.agentId),
    agent_enabled: Boolean(agent?.enabled),
    bot_enabled: Boolean(binding?.botEnabled),
    dclaw_location_configured: Boolean(agent?.dclawBaseUrl && agent?.dclawPublicId),
    flow_readable: true,
    tags_readable: true
  };
  const missingItems = Object.entries(checks)
    .filter(([, ready]) => !ready)
    .map(([key]) => key);
  return {
    ready: missingItems.length === 0,
    checks,
    missingItems
  };
}

export function getConfigPatchBotSnapshot(botId) {
  const normalizedBotId = String(botId || "").trim();
  if (!normalizedBotId) return null;

  const binding = getBotBinding(normalizedBotId);
  if (!binding) return null;

  const agent = binding.agentId ? getAgent(binding.agentId) : null;
  const storedFlowMachine = getFlowMachineForBot(normalizedBotId);
  const storedTags = binding.agentId ? getAgentTagSchema(binding.agentId) : null;
  const flowMachine = storedFlowMachine
    ? { enabled: storedFlowMachine.enabled, config: storedFlowMachine.config }
    : { enabled: false, config: null };
  const tags = storedTags ? { config: storedTags.config } : { config: null };

  const snapshot = {
    schemaVersion: "config-patch-bot-snapshot.v1",
    bot: {
      botId: binding.botId,
      botName: binding.botName || "",
      enabled: Boolean(binding.botEnabled)
    },
    agent: {
      agentId: binding.agentId || "",
      agentName: agent?.agentName || binding.agentName || "",
      enabled: Boolean(agent?.enabled),
      dclaw: {
        baseUrl: agent?.dclawBaseUrl || "",
        publicId: agent?.dclawPublicId || ""
      }
    },
    flowMachine,
    tags,
    source: {
      service: "dclaw-omnichannel-service",
      botUpdatedAt: binding.updatedAt || "",
      agentUpdatedAt: agent?.updatedAt || "",
      flowUpdatedAt: storedFlowMachine?.updatedAt || "",
      tagsUpdatedAt: storedTags?.updatedAt || ""
    },
    readiness: buildReadiness({ binding, agent })
  };

  return {
    ...snapshot,
    digests: {
      flowMachine: canonicalDigest(flowMachine),
      tags: canonicalDigest(tags),
      snapshot: canonicalDigest(snapshot)
    }
  };
}

export function listConfigPatchBots() {
  return listBotBindings().map((binding) => {
    const snapshot = getConfigPatchBotSnapshot(binding.botId);
    return {
      botId: snapshot.bot.botId,
      botName: snapshot.bot.botName,
      enabled: snapshot.bot.enabled,
      agentId: snapshot.agent.agentId,
      agentName: snapshot.agent.agentName,
      dclaw: snapshot.agent.dclaw,
      readiness: snapshot.readiness,
      configurationDigest: snapshot.digests.snapshot
    };
  });
}
