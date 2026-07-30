const stageHours = new Map([
  [1, "aggregate"],
  [2, "reconcile"],
  [3, "generate"],
  [9, "deliver"]
]);

export function scheduledCockpitStage(date = new Date()) {
  return stageHours.get(date.getHours()) || "";
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createCockpitWorker({
  handlers,
  now = () => new Date(),
  intervalMs = 60_000,
  enabled = true
}) {
  let busy = false;
  let timer = null;
  const completed = new Set();

  async function tick({ forceStage = "" } = {}) {
    if (!enabled) return { skipped: "disabled" };
    if (busy) return { skipped: "busy" };
    const current = now();
    const stage = forceStage || scheduledCockpitStage(current);
    if (!stage || typeof handlers?.[stage] !== "function") return { skipped: "no_stage" };
    const key = forceStage ? "" : `${localDateKey(current)}:${stage}`;
    if (key && completed.has(key)) return { skipped: "already_run" };
    busy = true;
    try {
      const result = await handlers[stage]({ now: current.toISOString(), stage });
      if (key) completed.add(key);
      return { stage, result };
    } finally {
      busy = false;
    }
  }

  function start() {
    if (timer || !enabled) return;
    timer = setInterval(() => void tick(), intervalMs);
    timer.unref?.();
    void tick();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, tick };
}
