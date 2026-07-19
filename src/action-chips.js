const INVITE_TO_GROUP_CHIP_RE = /\[动作：拉入\s+([^\]\n\r]+?)\]/g;

export function serializeActionChip(action = {}) {
  const groupName = String(action.groupName || action.params?.groupName || "").trim();
  if (!groupName) return "";
  if (String(action.type || "") !== "invite_to_group") return "";
  return `[动作：拉入 ${groupName}]`;
}

export function extractActionChips(text = "") {
  const source = String(text || "");
  const actions = [];
  let match;
  while ((match = INVITE_TO_GROUP_CHIP_RE.exec(source))) {
    const groupName = String(match[1] || "").trim();
    if (!groupName) continue;
    actions.push({
      id: `action_${actions.length + 1}`,
      type: "invite_to_group",
      groupName,
      target: "current_contact",
      showMessageHistory: true,
      runOnce: true
    });
  }
  return actions;
}

export function stripActionChips(text = "") {
  return String(text || "")
    .replace(INVITE_TO_GROUP_CHIP_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([。！？!?，,；;：:])/g, "$1")
    .replace(/([。！？!?，,；;：:])\s+/g, "$1")
    .trim();
}

function normalizeInlineAction(action = {}, index = 1) {
  if (!action || typeof action !== "object" || Array.isArray(action)) return null;
  if (String(action.type || "") !== "invite_to_group") return null;
  const groupName = String(action.groupName || action.params?.groupName || "").trim();
  if (!groupName) return null;
  return {
    id: String(action.id || `action_${index}`).trim() || `action_${index}`,
    type: "invite_to_group",
    groupName,
    target: "current_contact",
    showMessageHistory: action.showMessageHistory !== false,
    runOnce: action.runOnce !== false
  };
}

export function mergeInlineActions({ content = "", actions = [] } = {}) {
  const structured = Array.isArray(actions)
    ? actions.map((action, index) => normalizeInlineAction(action, index + 1)).filter(Boolean)
    : [];
  const inline = extractActionChips(content).map((action, index) => ({
    ...action,
    id: `action_${structured.length + index + 1}`
  }));
  return {
    content: stripActionChips(content),
    actions: [...structured, ...inline]
  };
}
