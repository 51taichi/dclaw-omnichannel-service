const stageHours = new Map([
  [1, "aggregate"],
  [2, "reconcile"],
  [3, "generate"],
  [9, "deliver"]
]);

export function scheduledCockpitStage(date = new Date()) {
  return stageHours.get(date.getHours()) || "";
}

export function scheduledCockpitStages(date = new Date()) {
  return [...stageHours.entries()]
    .filter(([hour]) => hour <= date.getHours())
    .map(([, stage]) => stage);
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
  enabled = true,
  isStageCompleted,
  markStageCompleted
}) {
  let busy = false;
  let timer = null;
  const completed = new Set();
  const checkStageCompleted = isStageCompleted
    || (async ({ key }) => completed.has(key));
  const persistStageCompleted = markStageCompleted
    || (async ({ key }) => {
      completed.add(key);
    });

  async function tick({ forceStage = "" } = {}) {
    if (!enabled) return { skipped: "disabled" };
    if (busy) return { skipped: "busy" };
    busy = true;
    try {
      const current = now();
      let stage = forceStage;
      let key = "";
      if (!stage) {
        const localDate = localDateKey(current);
        for (const dueStage of scheduledCockpitStages(current)) {
          if (typeof handlers?.[dueStage] !== "function") continue;
          const dueKey = `${localDate}:${dueStage}`;
          if (completed.has(dueKey)) continue;
          if (await checkStageCompleted({ key: dueKey, localDate, stage: dueStage })) {
            completed.add(dueKey);
            continue;
          }
          stage = dueStage;
          key = dueKey;
          break;
        }
        if (!stage) {
          return scheduledCockpitStages(current).length
            ? { skipped: "already_run" }
            : { skipped: "no_stage" };
        }
      }
      if (typeof handlers?.[stage] !== "function") return { skipped: "no_stage" };
      const result = await handlers[stage]({ now: current.toISOString(), stage });
      if (key) {
        await persistStageCompleted({
          key,
          localDate: localDateKey(current),
          stage,
          completedAt: current.toISOString()
        });
        completed.add(key);
      }
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
