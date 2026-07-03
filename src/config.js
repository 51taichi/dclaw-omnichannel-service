import fs from "node:fs/promises";
import path from "node:path";
import { upsertBotBinding } from "./db.js";

function normalizeBinding(binding) {
  return {
    botId: binding.botId || binding.robotId,
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

  let config = null;
  if (inlineConfig) {
    config = JSON.parse(inlineConfig);
  } else if (configPath) {
    const filePath = path.resolve(process.cwd(), configPath);
    config = JSON.parse(await fs.readFile(filePath, "utf8"));
  }

  if (
    !config &&
    process.env.ROBOT_ID &&
    process.env.DCLAW_BASE_URL &&
    (process.env.DCLAW_PUBLIC_ID || process.env.DCLAW_AGENT_ID)
  ) {
    config = {
      bots: [
        {
          botId: process.env.ROBOT_ID,
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

  return config.bots.map((bot) => upsertBotBinding(normalizeBinding(bot)));
}
