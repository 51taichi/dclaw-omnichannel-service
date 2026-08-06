import fs from "node:fs/promises";
import path from "node:path";
import { getBotBinding, upsertAgent, upsertBotBinding } from "./db.js";

function normalizeBinding(binding) {
  return {
    botId: binding.botId,
    botName: binding.botName || binding.name || "",
    agentId: binding.agentId,
    agentName: binding.agentName || "",
    dclawBaseUrl: binding.dclawBaseUrl || "",
    dclawPublicId: binding.dclawPublicId || binding.agentId,
    agentApiKey: binding.agentApiKey || "",
    enabled: binding.enabled !== false
  };
}

export async function loadBotBindingsFromConfig() {
  const configPath = process.env.BOTS_CONFIG_PATH;
  const inlineConfig = process.env.BOTS_CONFIG_JSON;
  const forceSync = process.env.FORCE_SYNC_BOTS_CONFIG === "true";

  let config = null;
  if (inlineConfig) {
    config = JSON.parse(inlineConfig);
  } else if (configPath) {
    const filePath = path.resolve(process.cwd(), configPath);
    config = JSON.parse(await fs.readFile(filePath, "utf8"));
  }

  if (
    !config &&
    process.env.BOT_ID &&
    process.env.DCLAW_BASE_URL &&
    (process.env.DCLAW_PUBLIC_ID || process.env.DCLAW_AGENT_ID)
  ) {
    config = {
      bots: [
        {
          botId: process.env.BOT_ID,
          botName: process.env.BOT_NAME || "",
          agentId: process.env.DCLAW_AGENT_ID || "default",
          agentName: process.env.DCLAW_AGENT_NAME || "",
          dclawBaseUrl: process.env.DCLAW_BASE_URL || "",
          dclawPublicId: process.env.DCLAW_PUBLIC_ID || process.env.DCLAW_AGENT_ID || "default",
          agentApiKey: process.env.DCLAW_AGENT_API_KEY || "",
          enabled: true
        }
      ]
    };
  }

  if (!config?.bots?.length) {
    return [];
  }

  return config.bots.map((bot) => {
    const binding = normalizeBinding(bot);
    const existing = getBotBinding(binding.botId);
    if (existing && !forceSync) {
      return existing;
    }
    upsertAgent({
      agentId: binding.agentId,
      agentName: binding.agentName,
      dclawBaseUrl: binding.dclawBaseUrl,
      dclawPublicId: binding.dclawPublicId,
      agentApiKey: binding.agentApiKey,
      enabled: binding.enabled
    });
    return upsertBotBinding(binding);
  });
}
