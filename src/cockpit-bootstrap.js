export function createCockpitBootstrap({
  listBots,
  getLatestSnapshot,
  aggregateBot,
  onError = () => {},
  statisticsVersion = 3
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
          const hasUniversalMetrics = snapshot
            && Object.hasOwn(snapshot.metrics || {}, "customerMessages")
            && Object.hasOwn(snapshot.metrics || {}, "replyMessages");
          const metrics = snapshot?.metrics || {};
          const hasExhaustiveOutcomes = Number(metrics.newCustomers || 0) === (
            Number(metrics.neverReplied || 0)
            + Number(metrics.stoppedReplying || 0)
            + Number(metrics.effectiveConversations || 0)
          );
          const hasCurrentStatistics = Number(
            snapshot?.definitions?.statisticsVersion || 0
          ) === statisticsVersion;
          if (
            snapshot
            && hasUniversalMetrics
            && hasExhaustiveOutcomes
            && hasCurrentStatistics
          ) {
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
