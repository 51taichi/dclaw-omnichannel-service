const MAX_GROUP_AGENT_TURNS = 24;
const MAX_GROUP_AGENT_CONTENT_CHARS = 1200;

const beijingDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

function normalizedText(value, maxChars = Infinity) {
  return String(value ?? "").trim().slice(0, maxChars);
}

function roleForSpeaker(roles, speakerName) {
  return roles.find((role) => (
    normalizedText(role?.currentName) === speakerName
    || (Array.isArray(role?.aliases) && role.aliases.some(
      (alias) => normalizedText(alias) === speakerName
    ))
  )) || null;
}

function formatBeijingDateTime(value) {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "时间未知";
  const parts = Object.fromEntries(
    beijingDateTimeFormatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function buildGroupAgentTurns({ items = [], roles = [] } = {}) {
  return (Array.isArray(items) ? items : [])
    .slice(-MAX_GROUP_AGENT_TURNS)
    .map((item) => {
      const messageId = Number(item?.conversationMessageId);
      if (!Number.isSafeInteger(messageId) || messageId <= 0) {
        throw new Error("persisted group conversationMessageId is required");
      }
      const speakerName = normalizedText(item?.message?.receivedName, 200);
      const role = roleForSpeaker(Array.isArray(roles) ? roles : [], speakerName);
      return {
        messageId,
        occurredAt: normalizedText(
          item?.conversationMessageCreatedAt || item?.acceptedAt,
          80
        ),
        speakerName,
        roleId: normalizedText(role?.id, 120),
        identityType: normalizedText(role?.identityType, 80),
        roleDescription: normalizedText(role?.description, 500),
        content: normalizedText(
          item?.message?.spoken || item?.message?.rawSpoken,
          MAX_GROUP_AGENT_CONTENT_CHARS
        ),
        realAtMe: item?.groupReplyDecision?.originalAtMe === true,
        effectiveReplyPolicy: normalizedText(
          item?.groupReplyDecision?.effectivePolicy,
          50
        ),
        triggerReason: normalizedText(item?.groupReplyDecision?.reason, 100)
      };
    });
}

export function formatGroupAgentTurns(turns = []) {
  return (Array.isArray(turns) ? turns : []).map((turn) => {
    const roleLabel = normalizedText(
      turn?.roleDescription || turn?.identityType || "未配置角色",
      500
    );
    return [
      `[M${Number(turn?.messageId)}｜${formatBeijingDateTime(turn?.occurredAt)}｜${normalizedText(turn?.speakerName, 200)}｜${roleLabel}]`,
      normalizedText(turn?.content, MAX_GROUP_AGENT_CONTENT_CHARS)
    ].join("\n");
  }).join("\n\n");
}
