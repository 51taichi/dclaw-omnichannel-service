export function serializeGroupAutomationCurrentState({
  task,
  cycleState,
  lastOccurrence
}) {
  if (task?.taskType !== "conditional_push" || !String(task.conditionText || "").trim()) {
    return null;
  }
  if (!cycleState) return null;
  return {
    achieved: Boolean(cycleState.achieved),
    reason: String(cycleState.reason || ""),
    evaluatedAt: String(cycleState.evaluatedAt || ""),
    stale: false,
    lastError: String(lastOccurrence?.errorMessage || "")
  };
}
