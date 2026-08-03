(function exposeGroupAutomationStatus(global) {
  function resolveGroupAutomationDisplayStatus(task = {}) {
    if (task.taskType !== "conditional_push") return null;
    if (!String(task.conditionText || "").trim()) {
      return {
        label: "固定推送",
        className: "fixed",
        iconName: "send",
        business: false
      };
    }
    if (!task.currentState) {
      return task.evaluationError
        ? {
            label: "判断暂不可用",
            className: "error",
            iconName: "warning",
            business: false
          }
        : {
            label: "正在判断",
            className: "loading",
            iconName: "clock",
            business: false
          };
    }
    return task.currentState.achieved
      ? {
          label: "已达成",
          className: "achieved",
          iconName: "check",
          business: true
        }
      : {
          label: "尚未达成",
          className: "unachieved",
          iconName: "clock",
          business: true
        };
  }

  global.resolveGroupAutomationDisplayStatus = resolveGroupAutomationDisplayStatus;
})(typeof window !== "undefined" ? window : globalThis);
