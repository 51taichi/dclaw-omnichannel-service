const TRANSCRIPT_SEPARATOR = "｜";
const DEFAULT_MAX_REQUEST_CHARS = 12_000;

const SHANGHAI_DATE_TIME = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

function bounded(value, maxLength = 1000) {
  return String(value ?? "").slice(0, maxLength);
}

function escapeTranscriptValue(value) {
  return bounded(value, 20_000)
    .replaceAll("\\", "\\\\")
    .replaceAll(TRANSCRIPT_SEPARATOR, `\\${TRANSCRIPT_SEPARATOR}`)
    .replace(/\r\n|\r|\n/g, "\\n");
}

function formatShanghaiDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("message occurredAt is invalid");
  return SHANGHAI_DATE_TIME.format(date).replace(",", "");
}

function messageIdentity(message) {
  const numericId = Number(message?.id);
  if (Number.isSafeInteger(numericId) && numericId > 0) return numericId;
  const externalId = bounded(message?.externalMessageId, 240);
  const importedId = externalId.match(/^wt-message-(\d+)$/u)?.[1];
  if (importedId && Number.isSafeInteger(Number(importedId))) return Number(importedId);
  if (externalId) return externalId;
  throw new Error("message identity is required");
}

function roleName(role) {
  return bounded(role?.currentName || role?.name, 200).trim();
}

function roleAliases(role) {
  return [roleName(role), ...(Array.isArray(role?.aliases) ? role.aliases : [])]
    .map((value) => bounded(value, 200).trim())
    .filter(Boolean);
}

function roleMatchesMessage(role, message) {
  const roleId = bounded(role?.id, 120);
  const messageRoleId = bounded(message?.participantRoleId, 120);
  if (roleId && messageRoleId && roleId === messageRoleId) return true;
  const senderName = bounded(message?.senderName, 200).trim();
  return Boolean(senderName && roleAliases(role).includes(senderName));
}

function participantDescription(role) {
  return [
    roleName(role),
    bounded(role?.identityType, 80).trim(),
    bounded(role?.description, 500).trim()
  ].filter(Boolean).map(escapeTranscriptValue).join(TRANSCRIPT_SEPARATOR);
}

function buildParticipants(messages, roles) {
  const configured = (Array.isArray(roles) ? roles : []).filter((role) => roleName(role));
  const unknownNames = [...new Set(messages
    .filter((message) => !configured.some((role) => roleMatchesMessage(role, message)))
    .map((message) => bounded(message?.senderName || "未知成员", 200).trim() || "未知成员"))]
    .sort((left, right) => left.localeCompare(right, "zh-CN"));
  const participants = [
    ...configured.map((role) => ({ role, name: roleName(role) })),
    ...unknownNames.map((name) => ({ role: null, name }))
  ].map((participant, index) => ({ ...participant, code: `P${index + 1}` }));

  return {
    participants,
    find(message) {
      const configuredParticipant = participants.find(
        (participant) => participant.role && roleMatchesMessage(participant.role, message)
      );
      if (configuredParticipant) return configuredParticipant;
      const senderName = bounded(message?.senderName || "未知成员", 200).trim() || "未知成员";
      return participants.find((participant) => !participant.role && participant.name === senderName);
    }
  };
}

function messageContent(message) {
  const content = bounded(message?.content, 20_000);
  if (content) return escapeTranscriptValue(content);
  const type = bounded(message?.messageType || "text", 80).trim() || "text";
  return type === "text" ? "[empty]" : `[${escapeTranscriptValue(type)}]`;
}

function messageSortKey(message) {
  const occurredAt = new Date(message?.occurredAt || message?.createdAt || 0).getTime();
  return Number.isNaN(occurredAt) ? 0 : occurredAt;
}

export function buildCompactGroupTranscript({
  messages,
  roles = [],
  groupBackground = "",
  startCode = 1
} = {}) {
  if (!Array.isArray(messages)) throw new Error("messages must be an array");
  const firstCode = Number(startCode);
  if (!Number.isSafeInteger(firstCode) || firstCode <= 0) {
    throw new Error("startCode must be a positive integer");
  }
  const orderedMessages = messages.map((message, index) => ({ message, index }))
    .sort((left, right) => (
      messageSortKey(left.message) - messageSortKey(right.message)
      || String(messageIdentity(left.message)).localeCompare(String(messageIdentity(right.message)), "en", { numeric: true })
      || left.index - right.index
    ))
    .map(({ message }) => message);
  const participantIndex = buildParticipants(orderedMessages, roles);
  const participantLines = participantIndex.participants.map(({ code, role, name }) => (
    role
      ? `${code}${TRANSCRIPT_SEPARATOR}${participantDescription(role)}`
      : `${code}${TRANSCRIPT_SEPARATOR}${escapeTranscriptValue(name)}${TRANSCRIPT_SEPARATOR}未配置角色`
  ));
  const background = escapeTranscriptValue(groupBackground).trim();
  const header = [
    "参与人：",
    ...participantLines,
    ...(background ? [`私有业务背景（仅供分析，不得对外提及来源）：${background}`] : [])
  ].join("\n");
  const evidenceMap = {};
  const messageIds = [];
  const entries = orderedMessages.map((message, index) => {
    const code = `M${String(firstCode + index).padStart(3, "0")}`;
    const id = messageIdentity(message);
    const participant = participantIndex.find(message);
    const occurredAt = message?.occurredAt || message?.createdAt;
    const messageType = escapeTranscriptValue(bounded(message?.messageType || "text", 80).trim() || "text");
    const line = [
      code,
      formatShanghaiDateTime(occurredAt),
      participant?.code || "P?",
      messageType,
      messageContent(message)
    ].join(TRANSCRIPT_SEPARATOR);
    evidenceMap[code] = id;
    messageIds.push(id);
    return { code, id, line, occurredAt: new Date(occurredAt).toISOString() };
  });

  return {
    header,
    lines: entries.map(({ line }) => line),
    entries,
    evidenceMap,
    messageIds
  };
}

export function estimateGroupAnalysisRequestChars({
  systemContext = "",
  taskContext = "",
  transcript = ""
} = {}) {
  return JSON.stringify({ systemContext, taskContext, transcript }).length;
}

export function packTranscriptChunks(transcript, {
  maxRequestChars = DEFAULT_MAX_REQUEST_CHARS
} = {}) {
  if (!transcript || !Array.isArray(transcript.entries)) {
    throw new Error("transcript entries are required");
  }
  const limit = Number(maxRequestChars);
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("maxRequestChars must be positive");
  if (!transcript.entries.length) return [];

  const chunks = [];
  let current = [];
  const render = (entries) => [transcript.header, ...entries.map(({ line }) => line)].join("\n");
  const flush = () => {
    if (!current.length) return;
    chunks.push({
      text: render(current),
      lines: current.map(({ line }) => line),
      messageCodes: current.map(({ code }) => code),
      messageIds: current.map(({ id }) => id),
      startAt: current[0].occurredAt,
      endAt: current.at(-1).occurredAt
    });
    current = [];
  };

  for (const entry of transcript.entries) {
    const candidate = [...current, entry];
    if (render(candidate).length <= limit) {
      current = candidate;
      continue;
    }
    if (!current.length) throw new Error(`transcript message ${entry.code} exceeds maxRequestChars`);
    flush();
    if (render([entry]).length > limit) {
      throw new Error(`transcript message ${entry.code} exceeds maxRequestChars`);
    }
    current = [entry];
  }
  flush();
  return chunks;
}
