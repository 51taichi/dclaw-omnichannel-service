import {
  aggregateCohortFunnels,
  aggregateOccurrenceMetrics,
  aggregateTagChanges,
  classifyReplyRisk,
  COCKPIT_TIME_ZONE,
  periodBounds
} from "./cockpit-domain.js";

export const COCKPIT_STATISTICS_VERSION = 3;

function mergeEvents(existing, incoming) {
  const byId = new Map(existing.map((event) => [event.id, event]));
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()].sort((left, right) => left.id - right.id);
}

function periodNodeDistribution({ events, period, definitions = [] }) {
  const periodEvents = events.filter((event) => (
    event.occurredAt >= period.start && event.occurredAt < period.end
  ));
  const activeCustomers = new Set(
    periodEvents
      .filter((event) => (
        ["first_contact", "customer_message", "bot_message"].includes(event.eventType)
      ))
      .map((event) => event.customerKey)
      .filter(Boolean)
  );
  if (!activeCustomers.size) return [];

  const definedNodeIds = new Set(definitions.map((node) => node.nodeId));
  const finalNodeByCustomer = new Map();
  for (const event of events) {
    if (
      event.eventType !== "node_reached"
      || !event.nodeId
      || !event.occurredAt
      || event.occurredAt >= period.end
      || !activeCustomers.has(event.customerKey)
    ) continue;
    const existing = finalNodeByCustomer.get(event.customerKey);
    if (
      !existing
      || event.occurredAt > existing.occurredAt
      || (
        event.occurredAt === existing.occurredAt
        && Number(event.id || 0) > Number(existing.id || 0)
      )
    ) {
      finalNodeByCustomer.set(event.customerKey, event);
    }
  }
  const recognizedNodes = [...finalNodeByCustomer.values()]
    .filter((event) => definedNodeIds.has(event.nodeId));
  if (!recognizedNodes.length) return [];

  const counts = new Map();
  for (const event of recognizedNodes) {
    counts.set(event.nodeId, (counts.get(event.nodeId) || 0) + 1);
  }
  return definitions
    .filter((node) => counts.has(node.nodeId))
    .map((node) => ({
      nodeId: node.nodeId,
      nodeName: node.nodeName,
      reached: counts.get(node.nodeId),
      share: counts.get(node.nodeId) / recognizedNodes.length,
      basis: "period_final_state"
    }));
}

export function createCockpitAggregator({
  getConfig,
  backfillEvents = () => ({ inserted: 0 }),
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
    await backfillEvents({ botId, throughAt });
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
        timezone: COCKPIT_TIME_ZONE
      });
      const funnels = aggregateCohortFunnels({ events, period });
      const eventNodeDistribution = periodNodeDistribution({
        events,
        period,
        definitions: baselineCharts.nodeDistribution || []
      });
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
          .filter((event) => event.eventType === "first_contact"
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
        definitions: { statisticsVersion: COCKPIT_STATISTICS_VERSION },
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
