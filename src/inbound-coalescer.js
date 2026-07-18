function splitKey(key) {
  const value = String(key || "");
  const separator = value.indexOf("\u0000");
  if (separator < 0) {
    return { botId: value.split(":")[0] || "", conversationKey: value };
  }
  return {
    botId: value.slice(0, separator),
    conversationKey: value.slice(separator + 1)
  };
}

function normalizeDelay(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function createInboundMessageCoalescer({
  baseQuietMs,
  incrementMs,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onFlush,
  onEvent = () => {}
}) {
  if (typeof onFlush !== "function") throw new Error("onFlush is required");

  const defaultBaseQuietMs = normalizeDelay(baseQuietMs, 0);
  const defaultIncrementMs = normalizeDelay(incrementMs, 0);
  const pending = new Map();
  const executionTails = new Map();
  let nextBatchId = 1;

  function detailsFor(batch, extra = {}) {
    return {
      id: batch.id,
      key: batch.key,
      botId: batch.botId,
      conversationKey: batch.conversationKey,
      itemCount: batch.items.length,
      startedAt: batch.startedAt,
      ...extra
    };
  }

  function emit(name, batch, extra) {
    onEvent(name, detailsFor(batch, extra));
  }

  function clearBatchTimers(batch) {
    if (batch.quietTimer !== null) clearTimer(batch.quietTimer);
    batch.quietTimer = null;
  }

  function runSerially(batch) {
    const previous = executionTails.get(batch.key) || Promise.resolve();
    const run = previous.catch(() => {}).then(() => onFlush(batch));
    const tail = run.finally(() => {
      if (executionTails.get(batch.key) === tail) executionTails.delete(batch.key);
    });
    executionTails.set(batch.key, tail);
    tail.catch(() => {});
  }

  function flush(batch, reason) {
    if (pending.get(batch.key) !== batch) return;
    pending.delete(batch.key);
    clearBatchTimers(batch);
    batch.flushedAt = now();
    batch.reason = reason;
    emit("flushed", batch, {
      reason,
      flushedAt: batch.flushedAt,
      waitMs: batch.flushedAt - batch.startedAt
    });
    runSerially({
      id: batch.id,
      key: batch.key,
      botId: batch.botId,
      conversationKey: batch.conversationKey,
      items: [...batch.items],
      startedAt: batch.startedAt,
      flushedAt: batch.flushedAt,
      reason
    });
  }

  function scheduleQuiet(batch) {
    if (batch.quietTimer !== null) clearTimer(batch.quietTimer);
    const delayMs = batch.baseQuietMs + Math.max(0, batch.items.length - 1) * batch.incrementMs;
    batch.scheduledDelayMs = delayMs;
    batch.quietTimer = setTimer(() => flush(batch, "quiet_window"), delayMs);
  }

  function push(key, item, options = {}) {
    const normalizedKey = String(key || "");
    const existing = pending.get(normalizedKey);
    if (existing) {
      existing.items.push(item);
      scheduleQuiet(existing);
      emit("appended", existing, { scheduledDelayMs: existing.scheduledDelayMs });
      return existing.id;
    }

    const identity = splitKey(normalizedKey);
    const batch = {
      id: `inbound-${nextBatchId++}`,
      key: normalizedKey,
      botId: identity.botId,
      conversationKey: identity.conversationKey,
      items: [item],
      startedAt: now(),
      quietTimer: null,
      baseQuietMs: normalizeDelay(options.baseQuietMs, defaultBaseQuietMs),
      incrementMs: normalizeDelay(options.incrementMs, defaultIncrementMs),
      scheduledDelayMs: 0
    };
    pending.set(normalizedKey, batch);
    scheduleQuiet(batch);
    emit("started", batch, { scheduledDelayMs: batch.scheduledDelayMs });
    return batch.id;
  }

  function cancel(key, reason = "canceled") {
    const normalizedKey = String(key || "");
    const batch = pending.get(normalizedKey);
    if (!batch) return [];
    pending.delete(normalizedKey);
    clearBatchTimers(batch);
    emit("canceled", batch, { reason, canceledAt: now() });
    return [...batch.items];
  }

  function cancelByBot(botId, reason = "canceled") {
    const normalizedBotId = String(botId || "");
    const canceled = [];
    for (const batch of [...pending.values()]) {
      if (batch.botId !== normalizedBotId) continue;
      canceled.push({
        id: batch.id,
        key: batch.key,
        botId: batch.botId,
        conversationKey: batch.conversationKey,
        items: cancel(batch.key, reason)
      });
    }
    return canceled;
  }

  return {
    push,
    has: (key) => pending.has(String(key || "")),
    cancel,
    cancelByBot,
    pendingCount: () => pending.size
  };
}
