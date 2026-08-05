import {
  buildDclawGroupAutomationRequest,
  invokeDclawAgent
} from "./dclaw.js";

function boundedText(value, field, maxLength, { required = false } = {}) {
  const text = String(value ?? "").trim();
  if (required && !text) throw new Error(`${field} is required`);
  if (text.length > maxLength) throw new Error(`${field} is too long`);
  return text;
}

function parseJsonObject(rawReply) {
  let text = String(rawReply || "").trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
  }
  if (!text.startsWith("{") || !text.endsWith("}")) {
    throw new Error("Agent reply must contain one JSON object only");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid Agent JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Agent reply must be a JSON object");
  }
  return parsed;
}

function assertExactKeys(value, expectedKeys, label) {
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  const unexpected = actualKeys.filter((key) => !expected.includes(key));
  const missing = expected.filter((key) => !actualKeys.includes(key));
  if (unexpected.length) throw new Error(`${label} has unexpected field: ${unexpected[0]}`);
  if (missing.length) throw new Error(`${label} is missing field: ${missing[0]}`);
}

function strictEvidenceMessageIds(value) {
  if (!Array.isArray(value)) throw new Error("evidenceMessageIds must be an array");
  const normalized = [];
  const seen = new Set();
  for (const rawId of value) {
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error("evidenceMessageIds must contain positive safe integers");
    }
    if (seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

export function validateCustomerVisibleGroupAutomationContent({ content } = {}) {
  const text = boundedText(content, "customer-visible group automation content", 20_000, {
    required: true
  });
  const forbidden = /群背景|背景(?:配置|字段|资料)里|角色配置|系统提示|内部元数据|privateContext|evidenceMessageIds|decisionNote|analysisKey|occurrenceId/iu;
  if (forbidden.test(text)) {
    throw new Error("customer-visible content discloses private or internal context");
  }
  return text;
}

function parseConditionalReply(rawReply) {
  const parsed = parseJsonObject(rawReply);
  assertExactKeys(
    parsed,
    ["achieved", "decisionNote", "evidenceMessageIds"],
    "conditional group automation reply"
  );
  if (typeof parsed.achieved !== "boolean") throw new Error("achieved must be boolean");
  const evidenceMessageIds = strictEvidenceMessageIds(parsed.evidenceMessageIds);
  if (parsed.achieved && !evidenceMessageIds.length) {
    throw new Error("achieved condition requires evidence message ids");
  }
  return {
    taskType: "conditional_push",
    achieved: parsed.achieved,
    decisionNote: boundedText(parsed.decisionNote, "decisionNote", 1000, { required: true }),
    evidenceMessageIds
  };
}

function parseSummaryReply(rawReply) {
  const parsed = parseJsonObject(rawReply);
  assertExactKeys(
    parsed,
    ["content", "decisionNote", "evidenceMessageIds"],
    "periodic summary group automation reply"
  );
  return {
    taskType: "periodic_summary",
    content: validateCustomerVisibleGroupAutomationContent({ content: parsed.content }),
    decisionNote: boundedText(parsed.decisionNote, "decisionNote", 1000, { required: true }),
    evidenceMessageIds: strictEvidenceMessageIds(parsed.evidenceMessageIds)
  };
}

function parseReply(rawReply, taskType) {
  if (taskType === "conditional_push") return parseConditionalReply(rawReply);
  if (taskType === "periodic_summary") return parseSummaryReply(rawReply);
  throw new Error("unsupported group automation task type");
}

function replyText(result) {
  if (typeof result === "string") return result;
  if (typeof result?.reply === "string") return result.reply;
  if (typeof result?.response?.reply === "string") return result.response.reply;
  return "";
}

export async function executeGroupAutomationAgentTask({
  binding,
  conversation,
  group,
  roles = [],
  task,
  occurrence,
  invokeAgent = ({ request }) => invokeDclawAgent({ binding, request }),
  signal
}) {
  let repairError = "";
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const request = buildDclawGroupAutomationRequest({
      binding,
      conversation,
      group,
      roles,
      task,
      occurrence,
      repairError
    });
    try {
      const result = await invokeAgent({ binding, request, signal, attempt, maxAttempts: 3 });
      return parseReply(replyText(result), task?.taskType);
    } catch (error) {
      lastError = error;
      repairError = String(error?.message || "Agent invocation failed").slice(0, 500);
    }
  }
  throw lastError;
}
