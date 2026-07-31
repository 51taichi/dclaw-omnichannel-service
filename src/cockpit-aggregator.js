import {
  aggregateCohortFunnels,
  aggregateOccurrenceMetrics,
  aggregateTagChanges,
  classifyReplyRisk,
  periodBounds
} from "./cockpit-domain.js";

function mergeEvents(existing, incoming) {
  const byId = new Map(existing.map((event) => [event.id, event]));
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()].sort((left, right) => left.id - right.id);
}

export function createCockpitAggregator({
  getConfig,
  getCursor,
  listEvents,
  loadState,
  getBaselineCharts = () => ({ nodeDistribution: [], tags: [] }),
  saveState,
  saveSnapshot,
  saveCursor
}) {
  async function aggregateBot({
    botId,
    throughAt,
    periodTypes = ["daily", "weekly", "monthly"]
  }) {
    const config = getConfig(botId);
    const cursor = getCursor(botId);
    const incoming = listEvents({
      botId,
      afterId: cursor.lastEventId,
      throughAt,
      limit: 5000
    });
    const previousState = loadState(botId) || { events: [] };
    const events = mergeEvents(previousState.events || [], incoming);
    const baselineCharts = getBaselineCharts(botId) || {};
    const sourceThroughEventId = incoming.at(-1)?.id || cursor.lastEventId;
    const anchor = new Date(new Date(throughAt).getTime() - 24 * 60 * 60 * 1000).toISOString();
    const snapshots = [];
    for (const periodType of periodTypes) {
      const period = periodBounds({
        type: periodType,
        anchor,
        timezone: config.timezone
      });
      const funnels = aggregateCohortFunnels({ events, period });
      const eventNodeDistribution = funnels.flatMap((funnel) => (
        funnel.nodes.map((node) => ({
          flowVersionId: funnel.flowVersionId,
          ...node,
          basis: "cohort_reached"
        }))
      ));
      const tagChanges = aggregateTagChanges({
        events: events.filter((event) => (
          !event.occurredAt || (
            event.occurredAt >= period.start
            && event.occurredAt < period.end
          )
        ))
      });
      const changesByTag = new Map(
        tagChanges.map((tag) => [`${tag.groupId}\u0000${tag.tagId}`, tag])
      );
      const baselineTagsByKey = new Map(
        (baselineCharts.tags || []).map((tag) => [
          `${tag.groupId}\u0000${tag.tagId}`,
          tag
        ])
      );
      const periodTags = tagChanges.map((change) => {
        const definition = baselineTagsByKey.get(
          `${change.groupId}\u0000${change.tagId}`
        ) || {};
        return {
          groupId: change.groupId,
          ...(definition.groupName ? { groupName: definition.groupName } : {}),
          ...(definition.groupOrder !== undefined
            ? { groupOrder: definition.groupOrder }
            : {}),
          tagId: change.tagId,
          ...(definition.tagName ? { tagName: definition.tagName } : {}),
          ...(definition.tagOrder !== undefined
            ? { tagOrder: definition.tagOrder }
            : {}),
          added: change.added,
          removed: change.removed,
          net: change.net,
          current: Math.max(0, change.net),
          basis: "period_change"
        };
      });
      const metrics = aggregateOccurrenceMetrics({ events, period });
      const cohortKeys = new Set(
        events
          .filter((event) => event.eventType === "friend_added"
            && event.occurredAt >= period.start
            && event.occurredAt < period.end)
          .map((event) => event.customerKey)
      );
      const riskCounts = { never_replied: 0, stopped_replying: 0, waiting: 0 };
      for (const customerKey of cohortKeys) {
        const risk = classifyReplyRisk({
          events: events.filter((event) => event.customerKey === customerKey),
          now: throughAt,
          defaultNoReplyHours: config.defaultNoReplyHours,
          nodeNoReplyHours: config.nodeNoReplyHours
        });
        if (riskCounts[risk] !== undefined) riskCounts[risk] += 1;
      }
      metrics.neverReplied = riskCounts.never_replied;
      metrics.stoppedReplying = riskCounts.stopped_replying;
      metrics.waiting = riskCounts.waiting;
      metrics.effectiveConversations = Math.max(
        0,
        metrics.newCustomers - metrics.neverReplied - metrics.stoppedReplying
      );
      metrics.handoffs = new Set(events
        .filter((event) => event.eventType === "handoff"
          && event.occurredAt >= period.start && event.occurredAt < period.end)
        .map((event) => event.customerKey)).size;
      snapshots.push(await saveSnapshot({
        botId,
        periodType,
        periodStart: period.start,
        periodEnd: period.end,
        status: "ready",
        sourceThroughEventId,
        metrics,
        charts: {
          funnels,
          nodeDistribution: eventNodeDistribution,
          tags: periodTags
        },
        definitions: {},
        generatedAt: throughAt
      }));
    }
    saveState({ botId, state: { events }, lastEventId: sourceThroughEventId });
    saveCursor({
      botId,
      lastEventId: sourceThroughEventId,
      lastSuccessAt: throughAt,
      lastError: ""
    });
    return snapshots;
  }

  async function reconcileBot(input) {
    const snapshots = await aggregateBot({ ...input, periodTypes: input.periodTypes || ["daily"] });
    return { corrected: snapshots.length, unchanged: 0 };
  }

  async function rebuildBot(input) {
    return aggregateBot({ ...input, periodTypes: input.periodTypes || ["daily", "weekly", "monthly"] });
  }

  return { aggregateBot, rebuildBot, reconcileBot };
}
