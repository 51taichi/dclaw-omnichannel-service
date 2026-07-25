import { createKeyedSingleFlight } from "./legacy-history.js";

export function createWorktoolHistoryCache({
  listPage,
  upsertItems,
  hasMessageId,
  onRefreshed = async () => {},
  pageSize = 100
}) {
  const singleFlight = createKeyedSingleFlight();

  async function performRefresh(robotId) {
    let page = 1;
    let totalPage = 1;
    let fetched = 0;
    let inserted = 0;
    let stoppedAtKnown = false;
    do {
      const result = await listPage({
        robotId,
        page,
        pageSize,
        sort: "create_time,desc"
      });
      const unseen = [];
      for (const item of result.items || []) {
        fetched += 1;
        if (hasMessageId({ botId: robotId, messageId: item.messageId })) {
          stoppedAtKnown = true;
          break;
        }
        unseen.push(item);
      }
      if (unseen.length) {
        inserted += Number(upsertItems({ botId: robotId, items: unseen }) || 0);
      }
      totalPage = Math.max(1, Number(result.pagination?.totalPage || 1));
      page += 1;
    } while (!stoppedAtKnown && page <= totalPage);

    await onRefreshed({ robotId });
    return { fetched, inserted, stoppedAtKnown };
  }

  return {
    refreshBot({ robotId }) {
      return singleFlight.run(String(robotId || ""), () => performRefresh(robotId));
    }
  };
}
