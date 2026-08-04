export function serializeGroupAutomationCurrentState({
  task,
  currentCycleKey = "",
  cycleState,
  lastOccurrence
}) {
  if (task?.taskType !== "conditional_push" || !String(task.conditionText || "").trim()) {
    return null;
  }
  const occurrenceState = !cycleState
    && String(currentCycleKey || "")
    && String(lastOccurrence?.cycleKey || "") === String(currentCycleKey)
    && typeof lastOccurrence?.conditionAchieved === "boolean"
      ? {
          achieved: lastOccurrence.conditionAchieved,
          reason: lastOccurrence.reason,
          evaluatedAt: lastOccurrence.finishedAt
            || lastOccurrence.updatedAt
            || lastOccurrence.startedAt
            || ""
        }
      : null;
  const resolvedState = cycleState || occurrenceState;
  if (!resolvedState) return null;
  return {
    achieved: Boolean(resolvedState.achieved),
    reason: String(resolvedState.reason || ""),
    evaluatedAt: String(resolvedState.evaluatedAt || ""),
    stale: false,
    lastError: String(lastOccurrence?.errorMessage || "")
  };
}
