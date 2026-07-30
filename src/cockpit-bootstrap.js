export function createCockpitBootstrap({
  listBots,
  getLatestSnapshot,
  aggregateBot,
  onError = () => {}
}) {
  return {
    async run({ throughAt = new Date().toISOString() } = {}) {
      let initialized = 0;
      let skipped = 0;
      let failed = 0;
      const bots = listBots().filter((bot) => bot.enabled);
      for (const bot of bots) {
        try {
          const snapshot = getLatestSnapshot({
            botId: bot.botId,
            periodType: "daily"
          });
          if (snapshot) {
            skipped += 1;
            continue;
          }
          await aggregateBot({
            botId: bot.botId,
            throughAt,
            periodTypes: ["daily", "weekly", "monthly"]
          });
          initialized += 1;
        } catch (error) {
          failed += 1;
          onError({ botId: bot.botId, error });
        }
      }
      return { initialized, skipped, failed };
    }
  };
}
