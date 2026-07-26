export function createConversationResetWorker({
  claimTask,
  getBinding,
  syncTask,
  completeTask,
  failTask,
  retryDelayMs = 5000,
  onEvent = () => {}
}) {
  const activeByConversation = new Map();
  let claiming = null;

  async function processTask(task) {
    const startedAt = Date.now();
    onEvent("started", { task });
    try {
      const binding = getBinding(task.botId);
      if (!binding?.enabled || binding.agentId !== task.agentId) {
        throw new Error("reset task binding is unavailable");
      }
      const result = await syncTask({
        binding,
        conversationKey: task.conversationKey,
        conversationEpoch: task.conversationEpoch,
        reason: "background_console_reset"
      });
      if (result?.status !== "synced") {
        throw new Error(result?.error || "DClaw conversation reset is pending");
      }
      completeTask({ id: task.id });
      onEvent("succeeded", {
        task,
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      failTask({
        id: task.id,
        error: error.message,
        retryDelayMs: retryDelayMs * (2 ** Math.max(0, task.attemptNumber - 1))
      });
      onEvent("failed", {
        task,
        durationMs: Date.now() - startedAt,
        error: error.message
      });
    }
  }

  async function runOnce() {
    if (claiming) return claiming;
    claiming = (async () => {
      const task = claimTask();
      if (!task) return null;
      const operation = processTask(task);
      activeByConversation.set(task.conversationKey, operation);
      try {
        await operation;
      } finally {
        if (activeByConversation.get(task.conversationKey) === operation) {
          activeByConversation.delete(task.conversationKey);
        }
      }
      return task;
    })();
    try {
      return await claiming;
    } finally {
      claiming = null;
    }
  }

  return {
    runOnce,
    wake() {
      void runOnce();
    },
    async waitForConversation(conversationKey) {
      const active = activeByConversation.get(conversationKey);
      if (active) await active;
    }
  };
}
