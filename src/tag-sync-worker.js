const RETRY_DELAYS_MS = [30_000, 120_000, 300_000];

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("invalid tag sync worker time");
  return date;
}

function retryAt(now, attemptNumber) {
  const attempt = Math.max(1, Number.parseInt(attemptNumber, 10) || 1);
  const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
  return new Date(asDate(now).getTime() + delay).toISOString();
}

function callbackLists(payload = {}) {
  return {
    successList: Array.isArray(payload.successList)
      ? payload.successList.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    failList: Array.isArray(payload.failList)
      ? payload.failList.map((item) => String(item || "").trim()).filter(Boolean)
      : []
  };
}

function callbackOutcome({ payload, targetName }) {
  const { successList, failList } = callbackLists(payload);
  const normalizedTarget = String(targetName || "").trim();
  const errorCode = Number(payload?.errorCode ?? 0);
  if (errorCode !== 0) {
    return {
      succeeded: false,
      error: String(payload?.errorReason || payload?.errorMsg || `WorkTool error ${errorCode}`)
    };
  }
  if (normalizedTarget && failList.includes(normalizedTarget)) {
    return { succeeded: false, error: `target failed: ${normalizedTarget}` };
  }
  if (successList.length && (!normalizedTarget || !successList.includes(normalizedTarget))) {
    return { succeeded: false, error: `target missing from success list: ${normalizedTarget}` };
  }
  if (!normalizedTarget && failList.length) {
    return { succeeded: false, error: `WorkTool target failed: ${failList.join(", ")}` };
  }
  return { succeeded: true, error: "" };
}

export function createTagSyncWorker(deps) {
  let ticking = false;
  let stopped = false;
  const submitted = new Map();

  const log = (event, fields = {}) => {
    if (typeof deps.log === "function") deps.log(event, fields);
  };

  async function runBot(botId, currentTime = new Date()) {
    if (stopped) return { status: "stopped" };
    const clock = asDate(currentTime);
    const config = deps.getConfig(botId);
    const window = deps.getWindowState(config, clock);
    let run = deps.getActiveRun(botId);

    if (!run && config.nightlyEnabled && window.inside) {
      run = deps.startRun({
        botId,
        triggerType: "scheduled",
        windowKey: window.windowKey,
        startedAt: clock.toISOString()
      });
      if (!run) return { status: "already_completed" };
      log("tag_sync.run.started", {
        botId,
        runId: run.id,
        triggerType: run.triggerType,
        windowKey: run.windowKey || window.windowKey
      });
    }
    if (!run) return { status: "idle" };

    if (
      run.triggerType === "scheduled"
      && (!config.nightlyEnabled || !window.inside)
    ) {
      deps.setRunStatus({
        runId: run.id,
        status: "stopped",
        reason: "window_closed"
      });
      log("tag_sync.run.stopped", { botId, runId: run.id, reason: "window_closed" });
      return { status: "stopped" };
    }

    if (deps.hasRealtimeActivity(botId)) {
      deps.setRunStatus({
        runId: run.id,
        status: "paused",
        reason: "customer_message"
      });
      log("tag_sync.run.paused", { botId, runId: run.id, reason: "customer_message" });
      return { status: "paused" };
    }

    deps.setRunStatus({ runId: run.id, status: "running", reason: "" });
    const nowIso = clock.toISOString();
    const batch = deps.claimBatch({
      botId,
      runId: run.id,
      nowIso,
      leaseExpiresAt: new Date(
        clock.getTime() + Number(deps.leaseMs || 120_000)
      ).toISOString(),
      limit: 5
    });
    if (!batch) {
      const completed = deps.finishRunIfDrained({ botId, runId: run.id });
      return completed
        ? { status: completed.status || "completed", run: completed }
        : { status: "waiting" };
    }

    log("tag_sync.worker.claimed", {
      botId,
      runId: run.id,
      conversationKey: batch.conversationKey,
      targetName: batch.targetName,
      tagCount: batch.tagNames.length
    });
    try {
      const response = await deps.sendTags({
        robotId: botId,
        targetName: batch.targetName,
        tagNames: batch.tagNames
      });
      const worktoolMessageId = String(response?.data || "").trim();
      if (!worktoolMessageId) throw new Error("WorkTool did not return a message id");
      const outboxIds = batch.rows.map((row) => row.id);
      deps.markSubmitted({ botId, outboxIds, worktoolMessageId });
      submitted.set(`${botId}:${worktoolMessageId}`, {
        targetName: batch.targetName,
        attemptNumber: Math.max(...batch.rows.map((row) => Number(row.runAttemptCount || 1)))
      });
      log("tag_sync.command.submitted", {
        botId,
        runId: run.id,
        worktoolMessageId,
        targetName: batch.targetName,
        tagCount: batch.tagNames.length
      });
      return { status: "submitted", worktoolMessageId };
    } catch (error) {
      const attemptNumber = Math.max(...batch.rows.map((row) => Number(row.runAttemptCount || 1)));
      deps.markSubmitFailed({
        botId,
        outboxIds: batch.rows.map((row) => row.id),
        error: error?.message || String(error),
        nextRetryAt: retryAt(clock, attemptNumber)
      });
      log("tag_sync.command.failed", {
        botId,
        runId: run.id,
        targetName: batch.targetName,
        error: error?.message || String(error)
      });
      return { status: "failed", error: error?.message || String(error) };
    }
  }

  async function handleCommandCallback({ botId, messageId, payload = {} }) {
    const worktoolMessageId = String(messageId || payload?.messageId || "").trim();
    if (!botId || !worktoolMessageId) return { matched: false };
    const memoryKey = `${botId}:${worktoolMessageId}`;
    const stored = submitted.get(memoryKey)
      || deps.getSubmittedCommand?.({ botId, worktoolMessageId })
      || null;
    const outcome = callbackOutcome({ payload, targetName: stored?.targetName || "" });
    const result = deps.resolveCallback({
      botId,
      worktoolMessageId,
      succeeded: outcome.succeeded,
      error: outcome.error,
      nextRetryAt: outcome.succeeded
        ? undefined
        : retryAt(new Date(), stored?.attemptNumber || 1)
    });
    const matched = Number(result?.succeededCount || 0) + Number(result?.failedCount || 0) > 0;
    if (matched) submitted.delete(memoryKey);
    log(outcome.succeeded ? "tag_sync.command.succeeded" : "tag_sync.command.failed", {
      botId,
      worktoolMessageId,
      matched,
      error: outcome.error
    });
    return { matched, succeeded: matched && outcome.succeeded, result };
  }

  async function tick(currentTime = new Date()) {
    if (stopped) return { status: "stopped" };
    if (ticking) return { status: "busy" };
    ticking = true;
    try {
      recover(currentTime);
      const configs = deps.listConfigs();
      const results = await Promise.allSettled(
        configs.map((config) => runBot(config.botId, currentTime))
      );
      return { status: "completed", results };
    } finally {
      ticking = false;
    }
  }

  function recover(currentTime = new Date()) {
    const clock = asDate(currentTime);
    return deps.recoverLeases({
      nowIso: clock.toISOString(),
      nextRetryAt: new Date(clock.getTime() + RETRY_DELAYS_MS[0]).toISOString()
    });
  }

  function stop() {
    stopped = true;
  }

  return { tick, runBot, handleCommandCallback, recover, stop };
}
