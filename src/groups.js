import { compactTagRulesForAgent, normalizeTagSchema } from "./tags.js";

export const GROUP_REPLY_POLICIES = new Set(["always", "mention_only", "never"]);
export const GROUP_ROLE_REPLY_POLICIES =
  new Set(["inherit", "always", "mention_only", "never"]);
export const SYSTEM_DATE_TAG_GROUP_ID = "__date__";

export function normalizeGroupReplyPolicy(value, { allowInherit = false } = {}) {
  const normalized = String(value || "").trim();
  const allowed = allowInherit ? GROUP_ROLE_REPLY_POLICIES : GROUP_REPLY_POLICIES;
  if (!allowed.has(normalized)) {
    throw new Error(`invalid group reply policy: ${normalized || "(empty)"}`);
  }
  return normalized;
}

function isMentioned(atMe) {
  return atMe === true || String(atMe || "").toLowerCase() === "true";
}

export function resolveGroupReplyDecision({
  groupPolicy,
  rolePolicy = "inherit",
  atMe = false
}) {
  const normalizedGroup = normalizeGroupReplyPolicy(groupPolicy);
  const normalizedRole = normalizeGroupReplyPolicy(rolePolicy, { allowInherit: true });
  const effectivePolicy = normalizedRole === "inherit" ? normalizedGroup : normalizedRole;
  if (effectivePolicy === "never") {
    return { invokeAgent: false, reason: "policy_never", effectivePolicy };
  }
  if (effectivePolicy === "mention_only" && !isMentioned(atMe)) {
    return { invokeAgent: false, reason: "mention_required", effectivePolicy };
  }
  return { invokeAgent: true, reason: "policy_matched", effectivePolicy };
}

export function buildGroupTagContext({
  schema,
  boundTagGroupIds = [],
  currentTags = []
}) {
  const bound = new Set(
    (Array.isArray(boundTagGroupIds) ? boundTagGroupIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
  const normalized = normalizeTagSchema(schema || {});
  const selectedSchema = {
    ...normalized,
    dateTag: {
      ...normalized.dateTag,
      enabled: normalized.dateTag.enabled && bound.has(SYSTEM_DATE_TAG_GROUP_ID)
    },
    groups: normalized.groups.filter((group) => bound.has(group.id))
  };
  return compactTagRulesForAgent({ schema: selectedSchema, currentTags });
}

function bounded(value, maxChars) {
  return String(value || "").trim().slice(0, Math.max(0, Number(maxChars) || 0));
}

export function buildGroupAgentContext({
  group,
  roles = [],
  speakerName,
  maxChars = 12000
}) {
  const normalizedRoles = (Array.isArray(roles) ? roles : []).map((role) => ({
    name: bounded(role.currentName, 200),
    identityType: bounded(role.identityType, 100),
    description: bounded(role.description, 1000)
  })).filter((role) => role.name);
  const speaker = normalizedRoles.find((role) => role.name === String(speakerName || "").trim()) || {
    name: bounded(speakerName, 200),
    identityType: "",
    description: ""
  };
  const context = {
    groupId: String(group?.id || ""),
    background: bounded(group?.background, maxChars),
    speaker,
    roles: normalizedRoles
  };
  const serialized = JSON.stringify(context);
  if (serialized.length <= maxChars) return context;
  return {
    ...context,
    background: bounded(context.background, Math.max(0, maxChars - JSON.stringify({
      ...context,
      background: ""
    }).length))
  };
}

export function planGroupExternalPatch({ original = {}, next = {} }) {
  const fields = [
    ["currentName", "newGroupName"],
    ["announcement", "newGroupAnnouncement"],
    ["currentRemark", "newGroupRemark"]
  ];
  const commandFields = {};
  for (const [sourceField, commandField] of fields) {
    const before = String(original[sourceField] || "").trim();
    const after = String(next[sourceField] || "").trim();
    if (before !== after) commandFields[commandField] = after;
  }
  return {
    changed: Object.keys(commandFields).length > 0,
    commandFields
  };
}

export function planMemberRemarkChanges(roles = []) {
  return (Array.isArray(roles) ? roles : []).flatMap((role) => {
    if (!role?.syncMarkName) return [];
    const currentName = String(role.currentName || "").trim();
    const originalMarkName = String(role.originalMarkName || "").trim();
    const markName = String(role.desiredMarkName || "").trim();
    if (!currentName || !markName || originalMarkName === markName) return [];
    return [{ roleId: role.id, currentName, markName }];
  });
}

export function serializeManagedGroup(group, { roles, tagGroupIds } = {}) {
  if (!group) return null;
  return {
    ...group,
    ...(roles ? { roles } : {}),
    ...(tagGroupIds ? { tagGroupIds } : {})
  };
}
