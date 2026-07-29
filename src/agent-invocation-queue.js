const REALTIME_PRIORITY = "realtime";
const BACKGROUND_PRIORITY = "background";
const DEFAULT_KEY = "__default__";
const DEFAULT_CONCURRENCY = 3;

function normalizeConcurrency(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(1, Math.floor(parsed))
    : DEFAULT_CONCURRENCY;
}

function normalizeKey(value) {
  return String(value || "").trim() || DEFAULT_KEY;
}

export function createAgentInvocationQueue({ concurrency = DEFAULT_CONCURRENCY } = {}) {
  const pending = {
    [REALTIME_PRIORITY]: [],
    [BACKGROUND_PRIORITY]: []
  };
  const maxConcurrency = normalizeConcurrency(concurrency);
  const runningKeys = new Set();
  let runningCount = 0;
  let sequence = 0;

  function hasEarlierPendingItem(item) {
    return pending[REALTIME_PRIORITY].some(
      (candidate) => candidate.key === item.key && candidate.sequence < item.sequence
    ) || pending[BACKGROUND_PRIORITY].some(
      (candidate) => candidate.key === item.key && candidate.sequence < item.sequence
    );
  }

  function takeFirstEligible(queue) {
    const index = queue.findIndex(
      (item) => !runningKeys.has(item.key) && !hasEarlierPendingItem(item)
    );
    return index >= 0 ? queue.splice(index, 1)[0] : null;
  }

  function takeNext() {
    return takeFirstEligible(pending[REALTIME_PRIORITY])
      || takeFirstEligible(pending[BACKGROUND_PRIORITY]);
  }

  function runNext() {
    while (runningCount < maxConcurrency) {
      const item = takeNext();
      if (!item) return;

      runningCount += 1;
      runningKeys.add(item.key);
      Promise.resolve()
        .then(item.task)
        .then(item.resolve, item.reject)
        .finally(() => {
          runningCount -= 1;
          runningKeys.delete(item.key);
          runNext();
        });
    }
  }

  function enqueue(task, { priority = REALTIME_PRIORITY, key = DEFAULT_KEY } = {}) {
    if (typeof task !== "function") {
      return Promise.reject(new TypeError("Agent invocation task must be a function"));
    }
    const queue = priority === BACKGROUND_PRIORITY
      ? pending[BACKGROUND_PRIORITY]
      : pending[REALTIME_PRIORITY];
    const result = new Promise((resolve, reject) => {
      sequence += 1;
      queue.push({
        task,
        resolve,
        reject,
        key: normalizeKey(key),
        sequence
      });
    });
    runNext();
    return result;
  }

  return { enqueue };
}
