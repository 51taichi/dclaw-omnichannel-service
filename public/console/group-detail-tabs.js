(function exposeGroupDetailTabs(global) {
  const tabOrder = ["config", "roles", "tasks"];

  function normalizeGroupDetailTab(value) {
    return tabOrder.includes(value) ? value : "config";
  }

  function nextGroupDetailTab(currentTab, key) {
    const current = normalizeGroupDetailTab(currentTab);
    if (key === "Home") return tabOrder[0];
    if (key === "End") return tabOrder[tabOrder.length - 1];
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) return null;

    const currentIndex = tabOrder.indexOf(current);
    const direction = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
    return tabOrder[(currentIndex + direction + tabOrder.length) % tabOrder.length];
  }

  global.GroupDetailTabs = Object.freeze({
    normalizeGroupDetailTab,
    nextGroupDetailTab
  });
})(typeof window !== "undefined" ? window : globalThis);
