(function exposeGroupAutomationStatus(global) {
  function resolveGroupAutomationTypeLabel(task = {}) {
    return task.taskType === "periodic_summary" ? "周期汇总" : "条件推送";
  }

  function status(key, label, className, iconName) {
    return { key, label, className, iconName };
  }

  function resolveGroupAutomationDisplayStatus(task = {}) {
    if (!task.enabled) return status("disabled", "已停用", "disabled", "lock");
    if (task.executionAvailable === false) {
      return status("unavailable", "执行不可用", "error", "warning");
    }
    const occurrence = task.latestOccurrence || null;
    if (!occurrence) return status("countdown", "倒计时", "countdown", "clock");
    const stage = String(occurrence.stage || "");
    if (["delivery_unknown", "awaiting_confirmation"].includes(stage)) {
      return status("send_unknown", "发送待确认", "send-unknown", "warning");
    }
    if (stage === "sent" || occurrence.status === "sent") {
      return status("sent", "已发送", "sent", "check");
    }
    if (stage === "skipped" || occurrence.status === "skipped") {
      return status("not_sent", "未发送", "not-sent", "clock");
    }
    if (stage === "failed" || occurrence.status === "failed") {
      return status("failed", "执行失败", "error", "warning");
    }
    if (stage === "canceled" || occurrence.status === "canceled") {
      return status("canceled", "已取消", "disabled", "lock");
    }
    return status("running", "执行中", "running", "clock");
  }

  global.resolveGroupAutomationTypeLabel = resolveGroupAutomationTypeLabel;
  global.resolveGroupAutomationDisplayStatus = resolveGroupAutomationDisplayStatus;
})(typeof window !== "undefined" ? window : globalThis);
