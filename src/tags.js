export function dateTagIdFor(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function asId(value) {
  return String(value || "").trim();
}

function normalizeActivationMessage(raw = {}) {
  const source = typeof raw === "string" ? { content: raw } : raw || {};
  const content = String(source.content || "").trim();
  if (!content) return null;
  return {
    content,
    intervalMinutes: Math.max(1, Number.parseInt(source.intervalMinutes ?? 30, 10) || 30),
    maxTimes: Math.max(1, Number.parseInt(source.maxTimes ?? 1, 10) || 1)
  };
}

export function normalizeTagActivation(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const messages = Array.isArray(source.messages)
    ? source.messages.map(normalizeActivationMessage).filter(Boolean)
    : [];
  return {
    enabled: Boolean(source.enabled),
    polishByAgent: source.polishByAgent !== false,
    messages
  };
}

export function normalizeTagSchema(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const groups = Array.isArray(source.groups)
    ? source.groups.map((group, groupIndex) => {
        const groupId = asId(group.id || `group_${groupIndex + 1}`);
        const tags = Array.isArray(group.tags)
          ? group.tags.map((tag, tagIndex) => {
              const tagId = asId(tag.id || `tag_${tagIndex + 1}`);
              return {
                id: tagId,
                name: String(tag.name || tagId).trim(),
                condition: String(tag.condition || "").trim(),
                order: tagIndex,
                enabled: tag.enabled !== false,
                activation: normalizeTagActivation(tag.activation || {})
              };
            }).filter((tag) => tag.id && tag.enabled)
          : [];
        return {
          id: groupId,
          name: String(group.name || groupId).trim(),
          enabled: group.enabled !== false,
          exclusive: group.exclusive !== false,
          oneWay: Boolean(group.oneWay),
          tags
        };
      }).filter((group) => group.id && group.enabled && group.tags.length)
    : [];
  return {
    version: String(source.version || "1.0.0"),
    dateTag: { enabled: Boolean(source.dateTag?.enabled) },
    groups
  };
}

export function compactTagRulesForAgent({ schema, currentTags = [] }) {
  const normalized = normalizeTagSchema(schema);
  if (!normalized.dateTag.enabled && !normalized.groups.length) return null;
  return {
    dateTagEnabled: normalized.dateTag.enabled,
    groups: normalized.groups.map((group) => ({
      id: group.id,
      name: group.name,
      exclusive: group.exclusive,
      oneWay: group.oneWay,
      tags: group.tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        condition: tag.condition
      }))
    })),
    currentTags: Array.isArray(currentTags) ? currentTags : []
  };
}

function normalizeAction(item = {}) {
  const groupId = asId(item.groupId || item.group_id);
  const tagId = asId(item.tagId || item.tag_id);
  if (!groupId || !tagId) return null;
  return {
    groupId,
    tagId,
    reason: String(item.reason || "").trim()
  };
}

export function normalizeTagDecision(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    add: Array.isArray(source.add) ? source.add.map(normalizeAction).filter(Boolean) : [],
    remove: Array.isArray(source.remove) ? source.remove.map(normalizeAction).filter(Boolean) : []
  };
}

function tagKey(tag) {
  return `${tag.groupId}:${tag.tagId}`;
}

function findGroup(schema, groupId) {
  return schema.groups.find((group) => group.id === groupId) || null;
}

function findTag(group, tagId) {
  return group?.tags.find((tag) => tag.id === tagId) || null;
}

function currentGroupTags(currentTags, groupId) {
  return currentTags.filter((tag) => tag.groupId === groupId);
}

export function adjudicateTagDecision({ schema, currentTags = [], decision = {}, ignoreOneWay = false }) {
  const normalizedSchema = normalizeTagSchema(schema);
  const normalizedDecision = normalizeTagDecision(decision);
  const next = new Map(
    (Array.isArray(currentTags) ? currentTags : [])
      .filter((tag) => tag?.groupId && tag?.tagId)
      .map((tag) => [tagKey(tag), { ...tag }])
  );
  const accepted = [];
  const rejected = [];

  for (const action of normalizedDecision.remove) {
    const group = findGroup(normalizedSchema, action.groupId);
    const tag = findTag(group, action.tagId);
    if (!group || !tag) {
      rejected.push({ ...action, action: "remove", reason: "unknown_tag" });
      continue;
    }
    if (group.exclusive) {
      rejected.push({ ...action, action: "remove", reason: "exclusive_remove_not_allowed" });
      continue;
    }
    const key = tagKey(action);
    if (next.delete(key)) {
      accepted.push({ ...action, action: "remove", oldTagIds: [action.tagId], newTagIds: [] });
    }
  }

  for (const action of normalizedDecision.add) {
    const group = findGroup(normalizedSchema, action.groupId);
    const tag = findTag(group, action.tagId);
    if (!group || !tag) {
      rejected.push({ ...action, action: "add", reason: "unknown_tag" });
      continue;
    }
    const existing = currentGroupTags([...next.values()], group.id);
    if (group.exclusive) {
      const current = existing[0] || null;
      if (current?.tagId === tag.id) continue;
      if (group.oneWay && current && !ignoreOneWay) {
        const currentTag = findTag(group, current.tagId);
        if (currentTag && tag.order < currentTag.order) {
          rejected.push({ ...action, action: "add", reason: "one_way_regression" });
          continue;
        }
      }
      for (const old of existing) next.delete(tagKey(old));
      next.set(`${group.id}:${tag.id}`, {
        groupId: group.id,
        groupName: group.name,
        tagId: tag.id,
        tagName: tag.name,
        name: tag.name,
        reason: action.reason
      });
      accepted.push({
        ...action,
        action: existing.length ? "replace" : "add",
        oldTagIds: existing.map((item) => item.tagId),
        newTagIds: [tag.id]
      });
    } else {
      const key = `${group.id}:${tag.id}`;
      if (next.has(key)) continue;
      next.set(key, {
        groupId: group.id,
        groupName: group.name,
        tagId: tag.id,
        tagName: tag.name,
        name: tag.name,
        reason: action.reason
      });
      accepted.push({ ...action, action: "add", oldTagIds: [], newTagIds: [tag.id] });
    }
  }

  return {
    nextTags: [...next.values()],
    accepted,
    rejected
  };
}
