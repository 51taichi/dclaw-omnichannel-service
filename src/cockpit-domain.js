import crypto from "node:crypto";

function canonicalize(value, { omitDisplay = false } = {}) {
  if (Array.isArray(value)) {
    return value
      .map((item) => canonicalize(item, { omitDisplay }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !(omitDisplay && ["name", "label", "title"].includes(key)))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item, { omitDisplay })])
  );
}

export function definitionSemanticHash(type, config) {
  const normalizedType = type === "tags" ? "tags" : "flow";
  const semantic = canonicalize(config || {}, { omitDisplay: true });
  return crypto
    .createHash("sha256")
    .update(`${normalizedType}:${JSON.stringify(semantic)}`)
    .digest("hex");
}

function zonedParts(date, timezone) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
}

function zonedMidnightToUtc({ year, month, day }, timezone) {
  let guess = Date.UTC(year, month - 1, day);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedParts(new Date(guess), timezone);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    guess += Date.UTC(year, month - 1, day) - represented;
  }
  return new Date(guess);
}

function localDateLabel(parts) {
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0")
  ].join("-");
}

function addUtcDays(parts, amount) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + amount));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

export function periodBounds({ type, anchor, timezone }) {
  const anchorDate = new Date(anchor);
  const local = zonedParts(anchorDate, timezone);
  let startParts = { year: local.year, month: local.month, day: local.day };
  let endParts;
  let label;
  if (type === "weekly") {
    const localNoonUtc = new Date(Date.UTC(local.year, local.month - 1, local.day, 12));
    const weekday = localNoonUtc.getUTCDay() || 7;
    startParts = addUtcDays(startParts, 1 - weekday);
    endParts = addUtcDays(startParts, 7);
    label = `${localDateLabel(startParts)} 至 ${localDateLabel(addUtcDays(endParts, -1))}`;
  } else if (type === "monthly") {
    startParts = { year: local.year, month: local.month, day: 1 };
    const nextMonth = new Date(Date.UTC(local.year, local.month, 1));
    endParts = {
      year: nextMonth.getUTCFullYear(),
      month: nextMonth.getUTCMonth() + 1,
      day: 1
    };
    label = `${local.year}-${String(local.month).padStart(2, "0")}`;
  } else {
    endParts = addUtcDays(startParts, 1);
    label = localDateLabel(startParts);
  }
  return {
    start: zonedMidnightToUtc(startParts, timezone).toISOString(),
    end: zonedMidnightToUtc(endParts, timezone).toISOString(),
    label
  };
}

export function classifyReplyRisk({
  events,
  now,
  defaultNoReplyHours,
  nodeNoReplyHours
}) {
  const ordered = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  if (ordered.some((event) => ["successful_invitation", "task_completed"].includes(event.eventType))) {
    return "none";
  }
  const customerMessages = ordered.filter((event) => event.eventType === "customer_message");
  const lastBotMessage = ordered.findLast((event) => event.eventType === "bot_message");
  if (!lastBotMessage) return "none";
  const repliedAfter = customerMessages.some(
    (event) => event.occurredAt > lastBotMessage.occurredAt
  );
  if (repliedAfter) return "none";
  const thresholdHours = Number(
    nodeNoReplyHours?.[lastBotMessage.nodeId] ?? defaultNoReplyHours ?? 24
  );
  const elapsed = new Date(now).getTime() - new Date(lastBotMessage.occurredAt).getTime();
  if (elapsed < thresholdHours * 60 * 60 * 1000) return "waiting";
  return customerMessages.length ? "stopped_replying" : "never_replied";
}

function insidePeriod(timestamp, period) {
  return timestamp >= period.start && timestamp < period.end;
}

export function aggregateOccurrenceMetrics({ events, period }) {
  const inPeriod = events.filter((event) => insidePeriod(event.occurredAt, period));
  const unique = (eventType) => new Set(
    inPeriod.filter((event) => event.eventType === eventType).map((event) => event.customerKey)
  ).size;
  return {
    newCustomers: unique("friend_added"),
    customerMessages: inPeriod.filter((event) => event.eventType === "customer_message").length,
    replyMessages: inPeriod.filter((event) => event.eventType === "bot_message").length,
    effectiveConversations: unique("effective_conversation")
  };
}

export function aggregateCohortFunnels({ events, period }) {
  const cohort = new Set(
    events
      .filter((event) => event.eventType === "friend_added" && insidePeriod(event.occurredAt, period))
      .map((event) => event.customerKey)
  );
  const versions = new Map();
  for (const event of events) {
    if (
      event.eventType !== "node_reached"
      || !cohort.has(event.customerKey)
      || !event.flowVersionId
    ) continue;
    const version = versions.get(event.flowVersionId) || new Map();
    const customers = version.get(event.nodeId) || new Set();
    customers.add(event.customerKey);
    version.set(event.nodeId, customers);
    versions.set(event.flowVersionId, version);
  }
  return [...versions.entries()]
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([flowVersionId, nodes]) => ({
      flowVersionId,
      cohortSize: cohort.size,
      nodes: [...nodes.entries()].map(([nodeId, customers]) => ({
        nodeId,
        reached: customers.size,
        share: cohort.size ? customers.size / cohort.size : 0
      }))
    }));
}

export function aggregateTagChanges({ events }) {
  const tags = new Map();
  for (const event of events) {
    if (!["tag_added", "tag_removed"].includes(event.eventType)) continue;
    const key = `${event.groupId}\u0000${event.tagId}`;
    const state = tags.get(key) || {
      groupId: event.groupId,
      tagId: event.tagId,
      customers: new Set(),
      added: 0,
      removed: 0
    };
    if (event.eventType === "tag_added") {
      state.customers.add(event.customerKey);
      state.added += 1;
    } else {
      state.customers.delete(event.customerKey);
      state.removed += 1;
    }
    tags.set(key, state);
  }
  return [...tags.values()].map((state) => ({
    groupId: state.groupId,
    tagId: state.tagId,
    current: state.customers.size,
    added: state.added,
    removed: state.removed,
    net: state.added - state.removed
  }));
}
