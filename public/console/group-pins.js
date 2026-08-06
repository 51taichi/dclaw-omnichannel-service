(function exposeGroupPins(global) {
  const STORAGE_PREFIX = "dclaw_omnichannel_console_group_pins";

  function storageKey(workspaceSlug, botId) {
    return `${STORAGE_PREFIX}:${String(workspaceSlug || "default")}:${String(botId || "none")}`;
  }

  function readPinnedGroupIds(storage, workspaceSlug, botId) {
    try {
      const value = JSON.parse(storage.getItem(storageKey(workspaceSlug, botId)) || "[]");
      return new Set(Array.isArray(value) ? value.map(String).filter(Boolean) : []);
    } catch {
      return new Set();
    }
  }

  function togglePinnedGroupId(storage, workspaceSlug, botId, groupId) {
    const pinnedGroupIds = readPinnedGroupIds(storage, workspaceSlug, botId);
    const normalizedGroupId = String(groupId || "");
    if (!normalizedGroupId) return pinnedGroupIds;

    if (pinnedGroupIds.has(normalizedGroupId)) {
      pinnedGroupIds.delete(normalizedGroupId);
    } else {
      pinnedGroupIds.add(normalizedGroupId);
    }
    storage.setItem(
      storageKey(workspaceSlug, botId),
      JSON.stringify([...pinnedGroupIds])
    );
    return pinnedGroupIds;
  }

  function sortGroupsByPinned(groups = [], pinnedGroupIds = new Set()) {
    return groups
      .map((group, index) => ({
        group,
        index,
        pinned: pinnedGroupIds.has(String(group.id))
      }))
      .sort((left, right) => Number(right.pinned) - Number(left.pinned) || left.index - right.index)
      .map(({ group }) => group);
  }

  global.GroupPins = Object.freeze({
    readPinnedGroupIds,
    togglePinnedGroupId,
    sortGroupsByPinned
  });
})(typeof window !== "undefined" ? window : globalThis);
