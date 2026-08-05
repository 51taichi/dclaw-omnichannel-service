import { buildDclawGroupHistoryId } from "./dclaw-group-history.js";

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_RETRY_MS = 30_000;
const MAX_RETRY_MS = 5 * 60_000;

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isoNow(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("invalid group history worker time");
  return date.toISOString();
}

function resolveRoleId(roles, senderName) {
  const normalized = String(senderName || "").trim();
  if (!normalized) return "";
  const role = roles.find((item) => (
    String(item?.currentName || "").trim() === normalized ||
    (Array.isArray(item?.aliases) && item.aliases.some((alias) => String(alias || "").trim() === normalized))
  ));
  return String(role?.id || "");
}

function historyMetadata(message) {
  const raw = message?.rawPayload && typeof message.rawPayload === "object"
    ? message.rawPayload
    : {};
  const metadata = {};
  const sourceMessageId = String(raw.messageId || raw.msgId || message?.sourceKey || "").trim();
  if (sourceMessageId) metadata.sourceMessageId = sourceMessageId;
  if (raw.textType !== undefined && ["string", "number"].includes(typeof raw.textType)) {
    metadata.textType = raw.textType;
  }
  for (const key of ["fileName", "fileType", "ocrText", "transcript"]) {
    if (typeof raw[key] === "string" && raw[key]) metadata[key] = raw[key];
  }
  return metadata;
}

function historyMessageType(message) {
  const raw = message?.rawPayload && typeof message.rawPayload === "object"
    ? message.rawPayload
    : {};
  return String(raw.textType ?? raw.messageType ?? raw.type ?? "text");
}

function mapHistoryMessages(messages, roles) {
  return messages.map((message) => ({
    externalMessageId: `wt-message-${message.id}`,
    occurredAt: message.createdAt,
    senderId: "",
    senderName: String(message.senderName || (message.direction === "outbound" ? "机器人" : "未知成员")),
    participantRoleId: resolveRoleId(roles, message.senderName),
    direction: message.direction === "outbound" ? "outbound" : "inbound",
    source: String(message.source || "local"),
    messageType: historyMessageType(message),
    content: String(message.content || ""),
    metadata: historyMetadata(message)
  }));
}

function log(logger, level, event, fields) {
  const method = typeof logger?.[level] === "function" ? logger[level] : logger?.log;
  if (typeof method === "function") method.call(logger, event, fields);
}

export function createGroupHistorySyncWorker({
  db,
  resolveDclawBinding,
  probeCapability,
  appendHistory,
  now = () => new Date(),
  logger = console,
  sleep = defaultSleep,
  batchSize = DEFAULT_BATCH_SIZE,
  leaseMs = DEFAULT_LEASE_MS
}) {
  if (
    !db ||
    typeof resolveDclawBinding !== "function" ||
    typeof probeCapability !== "function" ||
    typeof appendHistory !== "function"
  ) {
    throw new Error("group history sync worker dependencies are required");
  }
  const normalizedBatchSize = Math.max(1, Math.min(200, Number.parseInt(batchSize, 10) || DEFAULT_BATCH_SIZE));
  const normalizedLeaseMs = Math.max(1000, Number(leaseMs) || DEFAULT_LEASE_MS);

  async function wake({ botId, groupId }) {
    const throughMessageId = db.getLatestGroupConversationMessageIdAtOrBefore({
      botId,
      groupId,
      until: isoNow(now)
    });
    return db.enqueueGroupHistorySync({ botId, groupId, throughMessageId });
  }

  async function failClaim(job, owner, error) {
    const current = new Date(isoNow(now));
    const attempt = Math.max(0, Number(job?.attempts) || 0);
    const retryMs = Math.min(MAX_RETRY_MS, DEFAULT_RETRY_MS * (2 ** Math.min(attempt, 4)));
    try {
      db.failGroupHistorySyncJob({
        botId: job.botId,
        groupId: job.groupId,
        owner,
        error,
        nextRetryAt: new Date(current.getTime() + retryMs).toISOString(),
        now: current.toISOString()
      });
    } catch (leaseError) {
      log(logger, "warn", "group_history.sync.lease_lost", {
        botId: job.botId,
        groupId: job.groupId,
        error: String(leaseError?.message || leaseError)
      });
    }
  }

  async function processClaim(job, owner) {
    log(logger, "info", "group_history.sync.lag", {
      botId: job.botId,
      groupId: job.groupId,
      syncedThroughMessageId: job.syncedThroughMessageId,
      requestedThroughMessageId: job.requestedThroughMessageId
    });
    try {
      const binding = await resolveDclawBinding(job.botId);
      if (!binding || binding.enabled === false || !String(binding.agentApiUrl || "").trim()) {
        throw new Error("DClaw binding unavailable for group history sync");
      }
      const capability = await probeCapability({ binding });
      if (!capability?.ready) {
        const status = Number(capability?.status || 0);
        throw new Error(`DClaw group history capability unavailable (${status || "unknown"}: ${capability?.reason || "not ready"})`);
      }

      db.heartbeatGroupHistorySyncJob({
        botId: job.botId,
        groupId: job.groupId,
        owner,
        now: isoNow(now),
        leaseMs: normalizedLeaseMs
      });
      const page = db.listCanonicalGroupMessagesForHistory({
        botId: job.botId,
        groupId: job.groupId,
        afterMessageId: job.syncedThroughMessageId,
        throughMessageId: job.requestedThroughMessageId,
        limit: normalizedBatchSize
      });
      if (page.messages.length) {
        const roles = typeof db.listGroupRoles === "function"
          ? db.listGroupRoles({ botId: job.botId, groupId: job.groupId })
          : [];
        await appendHistory({
          binding,
          externalGroupId: buildDclawGroupHistoryId({ botId: job.botId, groupId: job.groupId }),
          messages: mapHistoryMessages(page.messages, roles)
        });
      }
      const completed = db.completeGroupHistorySyncBatch({
        botId: job.botId,
        groupId: job.groupId,
        owner,
        syncedThroughMessageId: page.processedThroughMessageId,
        now: isoNow(now),
        hasMore: page.hasMore
      });
      log(logger, "info", "group_history.sync.completed", {
        botId: job.botId,
        groupId: job.groupId,
        exportedCount: page.messages.length,
        syncedThroughMessageId: completed.syncedThroughMessageId,
        requestedThroughMessageId: completed.requestedThroughMessageId,
        hasMore: page.hasMore
      });
      return true;
    } catch (error) {
      await failClaim(job, owner, error);
      log(logger, "error", "group_history.sync.failed", {
        botId: job.botId,
        groupId: job.groupId,
        syncedThroughMessageId: job.syncedThroughMessageId,
        requestedThroughMessageId: job.requestedThroughMessageId,
        error: String(error?.message || error)
      });
      return false;
    }
  }

  async function runTick({ owner, limit = 10 }) {
    const normalizedOwner = String(owner || "").trim();
    if (!normalizedOwner) throw new Error("group history sync owner is required");
    const jobs = db.claimGroupHistorySyncJobs({
      owner: normalizedOwner,
      now: isoNow(now),
      leaseMs: normalizedLeaseMs,
      limit
    });
    let completed = 0;
    let failed = 0;
    for (const job of jobs) {
      if (await processClaim(job, normalizedOwner)) completed += 1;
      else failed += 1;
    }
    return { claimed: jobs.length, completed, failed };
  }

  async function ensureSyncedThrough({
    botId,
    groupId,
    throughMessageId,
    deadlineAt
  }) {
    const cutoff = Number(throughMessageId);
    if (!Number.isSafeInteger(cutoff) || cutoff < 0) throw new Error("invalid group history sync cutoff");
    const deadline = new Date(deadlineAt);
    if (Number.isNaN(deadline.getTime())) throw new Error("invalid group history sync deadline");
    db.enqueueGroupHistorySync({ botId, groupId, throughMessageId: cutoff });
    const owner = `ensure:${process.pid}:${Math.random().toString(36).slice(2)}`;
    for (let iteration = 0; iteration < 1000; iteration += 1) {
      const state = db.getGroupHistorySyncState({ botId, groupId });
      if (Number(state?.syncedThroughMessageId || 0) >= cutoff) {
        return { ready: true, syncedThroughMessageId: Number(state.syncedThroughMessageId) };
      }
      if (new Date(isoNow(now)).getTime() >= deadline.getTime()) {
        return {
          ready: false,
          reason: "deadline_exceeded",
          syncedThroughMessageId: Number(state?.syncedThroughMessageId || 0),
          error: String(state?.lastError || "")
        };
      }
      await runTick({ owner, limit: 1 });
      await sleep(25);
    }
    const state = db.getGroupHistorySyncState({ botId, groupId });
    return {
      ready: false,
      reason: "sync_stalled",
      syncedThroughMessageId: Number(state?.syncedThroughMessageId || 0),
      error: String(state?.lastError || "")
    };
  }

  return { wake, runTick, ensureSyncedThrough };
}
