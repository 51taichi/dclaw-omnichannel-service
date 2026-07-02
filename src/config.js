import fs from "node:fs/promises";
import path from "node:path";
import { upsertBotBinding } from "./db.js";

function normalizeBinding(binding) {
  return {
    botId: binding.botId || binding.robotId,
    botName: binding.botName || binding.name || "",
    agentId: binding.agentId,
    agentName: binding.agentName || "",
    agentApiUrl: binding.agentApiUrl,
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

  if (!config && process.env.ROBOT_ID && process.env.DCLAW_AGENT_API_URL) {
    config = {
      bots: [
        {
          botId: process.env.ROBOT_ID,
          botName: process.env.BOT_NAME || "",
          agentId: process.env.DCLAW_AGENT_ID || "default",
          agentName: process.env.DCLAW_AGENT_NAME || "",
          agentApiUrl: process.env.DCLAW_AGENT_API_URL,
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
