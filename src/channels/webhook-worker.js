import { ChannelError } from "./errors.js";

export function createChannelWebhookWorker({
  owner = `channel-webhook:${process.pid}`,
  claim,
  normalize,
  dispatch,
  complete,
  fail,
  batchSize = 10,
  leaseMs = 60_000,
  maxAttempts = 5,
  now = () => new Date()
}) {
  for (const dependency of [claim, normalize, dispatch, complete, fail]) {
    if (typeof dependency !== "function") throw new Error("webhook worker dependencies are required");
  }
  let running = false;
  return Object.freeze({
    async tick() {
      if (running) return Object.freeze({ skipped: true });
      running = true;
      try {
        const current = now();
        const rows = claim({ owner, limit: batchSize, leaseMs, nowIso: current.toISOString() });
        let completed = 0;
        let failed = 0;
        for (const row of rows) {
          try {
            const events = normalize(row);
            for (const event of events) await dispatch(event, row);
            complete({ id: row.id, owner, processedAt: now().toISOString() });
            completed += 1;
          } catch (error) {
            const retryable = error instanceof ChannelError && error.retryable === true && row.attempts < maxAttempts;
            fail({
              id: row.id,
              owner,
              retryable,
              errorMessage: error instanceof ChannelError ? error.code : "channel_webhook_processing_failed",
              nextRetryAt: retryable ? retryTime(current, row.attempts).toISOString() : null
            });
            failed += 1;
          }
        }
        return Object.freeze({ claimed: rows.length, completed, failed });
      } finally {
        running = false;
      }
    }
  });
}

function retryTime(now, attempts) {
  const delayMs = Math.min(300_000, 1000 * (2 ** Math.max(1, Number(attempts) || 1)));
  return new Date(now.getTime() + delayMs);
}
