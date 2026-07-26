import { normalizeTagDecision } from "./tags.js";
import {
  normalizeTagEvaluation,
  validateTagAuditContract
} from "./tag-audit.js";

export function validateAgentResponseText(rawText, {
  requireFlowDecision = false,
  allowTagDecision = false,
  flow = null,
  tagContext = null,
  tagEvidenceCandidates = []
} = {}) {
  const raw = String(rawText || "");
  const { text, normalizations } = normalizeResponseText(raw);
  if (!text) {
    return invalidResult(raw, text, normalizations, [{
      type: "json_syntax",
      path: "",
      message: "Agent response is empty"
    }]);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return invalidResult(raw, text, normalizations, [jsonSyntaxError(text, error)]);
  }

  const errors = validateResponseObject(parsed, {
    requireFlowDecision,
    allowTagDecision,
    flow,
    tagContext,
    tagEvidenceCandidates
  });
  if (errors.length) {
    return invalidResult(raw, text, normalizations, errors);
  }

  return {
    valid: true,
    rawText: raw,
    normalizedText: text,
    normalizations,
    errors: [],
    agentReply: {
      valid: true,
      reply: stripRuntimeArtifacts(parsed.reply),
      attachments: normalizeAgentAttachments(parsed.attachments || parsed.resources || parsed.files),
      sources: normalizeAgentSources(parsed.sources || parsed.references || parsed.evidence),
      flowDecision: parsed.flowDecision || parsed.stateUpdate || null,
      tagEvaluation: normalizeTagEvaluation(parsed.tagEvaluation),
      tagDecision: normalizeTagDecision(parsed.tagDecision || parsed.tags || {}),
      raw: parsed
    }
  };
}

export function buildAgentResponseValidationRetryRequest(request, errors = []) {
  return {
    ...request,
    message: [
      request.message,
      "",
      "上一条输出没有通过服务端 JSON 响应校验，不能发送给客户。请重新回答同一条客户消息。",
      "校验错误如下：",
      ...summarizeValidationErrors(errors).map((error, index) =>
        `${index + 1}. ${formatValidationErrorForPrompt(error)}`
      ),
      "只输出一个合法 JSON 对象，不要输出 Markdown、分析、推理、规则、处理步骤、前后说明或 JSON 对象外的任何文字。"
    ].join("\n"),
    metadata: {
      ...(request.metadata || {}),
      validationRetry: true,
      validationErrors: summarizeValidationErrors(errors)
    }
  };
}

export async function validateAndRetryAgentResponse({
  request,
  invoke,
  validationOptions = {},
  onRetryRequested,
  onValidationFailure,
  onRetryOutcome
}) {
  const attempts = [];
  let currentRequest = request;

  for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber += 1) {
    let invocation;
    try {
      invocation = await invoke({ request: currentRequest, attemptNumber });
    } catch (error) {
      if (attemptNumber > 1) {
        onRetryOutcome?.({
          outcome: "call_failed",
          attemptNumber,
          error
        });
      }
      throw error;
    }
    const validation = validateAgentResponseText(invocation?.reply || "", validationOptions);
    attempts.push({ request: currentRequest, invocation, validation });

    if (validation.valid) {
      if (attemptNumber > 1) {
        onRetryOutcome?.({
          outcome: "succeeded",
          attemptNumber,
          error: null
        });
      }
      return {
        valid: true,
        invocation,
        agentReply: validation.agentReply,
        validation,
        attempts
      };
    }

    onValidationFailure?.({
      attemptNumber,
      stage: attemptNumber === 1 ? "initial" : "validation_retry",
      retryRequested: attemptNumber > 1,
      errors: validation.errors,
      rawReply: validation.rawText,
      rawReplyLength: String(validation.rawText || "").length,
      normalizations: validation.normalizations
    });

    if (attemptNumber === 1) {
      onRetryRequested?.({ rawReplyLength: String(invocation?.reply || "").length });
      currentRequest = buildAgentResponseValidationRetryRequest(request, validation.errors);
    } else {
      onRetryOutcome?.({
        outcome: "failed",
        attemptNumber,
        error: null
      });
    }
  }

  const lastAttempt = attempts[attempts.length - 1];
  return {
    valid: false,
    invocation: lastAttempt.invocation,
    agentReply: lastAttempt.validation.agentReply,
    validation: lastAttempt.validation,
    attempts
  };
}

export function summarizeValidationErrors(errors = []) {
  return errors.slice(0, 8).map((error) => ({
    type: String(error.type || "validation").trim(),
    path: String(error.path || "").trim(),
    message: String(error.message || "").trim(),
    line: numberOrNull(error.line),
    column: numberOrNull(error.column)
  }));
}

export function sendabilityIssueToValidationError(issue) {
  return {
    type: "semantic",
    path: "attachments",
    message: issue?.message || "Agent response failed sendability validation"
  };
}

function normalizeResponseText(raw) {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  if (!match) {
    return { text: trimmed, normalizations: [] };
  }
  return {
    text: match[1].trim(),
    normalizations: [{ type: "outer_json_fence_removed" }]
  };
}

function validateResponseObject(parsed, {
  requireFlowDecision,
  allowTagDecision,
  flow,
  tagContext,
  tagEvidenceCandidates
}) {
  const errors = [];
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [{
      type: "schema",
      path: "",
      message: "Agent response must be a JSON object"
    }];
  }
  if (typeof parsed.reply !== "string") {
    errors.push({
      type: "schema",
      path: "reply",
      message: "reply must be a string"
    });
  }
  if (parsed.attachments !== undefined && !Array.isArray(parsed.attachments)) {
    errors.push({
      type: "schema",
      path: "attachments",
      message: "attachments must be an array"
    });
  }
  if (parsed.sources !== undefined && !Array.isArray(parsed.sources)) {
    errors.push({
      type: "schema",
      path: "sources",
      message: "sources must be an array"
    });
  }
  validateFlowDecision(parsed.flowDecision || parsed.stateUpdate, {
    requireFlowDecision,
    flow,
    errors
  });
  validateTagDecision(parsed.tagDecision || parsed.tags, {
    allowTagDecision,
    tagContext,
    errors
  });
  const tagAuditEnabled = Boolean(
    allowTagDecision
    && tagContext
    && Array.isArray(tagContext.groups)
    && tagContext.groups.length
  );
  if (tagAuditEnabled) {
    if (!Array.isArray(parsed.tagEvaluation)) {
      errors.push({
        type: "schema",
        path: "tagEvaluation",
        message: "tagEvaluation is required and must be an array when tags are enabled"
      });
    }
    if (!parsed.tagDecision || typeof parsed.tagDecision !== "object" || Array.isArray(parsed.tagDecision)) {
      errors.push({
        type: "schema",
        path: "tagDecision",
        message: "tagDecision is required and must be an object when tags are enabled"
      });
    }
    if (Array.isArray(parsed.tagEvaluation) && parsed.tagDecision && typeof parsed.tagDecision === "object") {
      const audit = validateTagAuditContract({
        evaluation: parsed.tagEvaluation,
        decision: parsed.tagDecision,
        tagContext,
        evidenceCandidates: tagEvidenceCandidates
      });
      errors.push(...audit.errors);
    }
  }
  return errors;
}

function validateFlowDecision(decision, { requireFlowDecision, flow, errors }) {
  if (!decision) {
    if (requireFlowDecision) {
      errors.push({
        type: "schema",
        path: "flowDecision",
        message: "flowDecision is required when a flow context is provided"
      });
    }
    return;
  }
  if (typeof decision !== "object" || Array.isArray(decision)) {
    errors.push({
      type: "schema",
      path: "flowDecision",
      message: "flowDecision must be an object"
    });
    return;
  }
  if (decision.nodeCompleted !== undefined && typeof decision.nodeCompleted !== "boolean") {
    errors.push({
      type: "schema",
      path: "flowDecision.nodeCompleted",
      message: "nodeCompleted must be a boolean"
    });
  }
  if (
    decision.collectedDataPatch !== undefined &&
    (!decision.collectedDataPatch || typeof decision.collectedDataPatch !== "object" || Array.isArray(decision.collectedDataPatch))
  ) {
    errors.push({
      type: "schema",
      path: "flowDecision.collectedDataPatch",
      message: "collectedDataPatch must be an object"
    });
  }

  const validNodeIds = new Set(
    (flow?.machine?.nodes || flow?.nodes || [])
      .map((node) => String(node?.id || "").trim())
      .filter(Boolean)
  );
  const nextNodeId = String(decision.nextNodeId || "").trim();
  if (nextNodeId && validNodeIds.size && !validNodeIds.has(nextNodeId)) {
    errors.push({
      type: "semantic",
      path: "flowDecision.nextNodeId",
      message: `nextNodeId '${nextNodeId}' is not in the current flow`
    });
  }
}

function validateTagDecision(decision, { allowTagDecision, tagContext, errors }) {
  if (!decision) return;
  if (!allowTagDecision) {
    errors.push({
      type: "schema",
      path: "tagDecision",
      message: "tagDecision is not allowed for this request"
    });
    return;
  }
  if (typeof decision !== "object" || Array.isArray(decision)) {
    errors.push({
      type: "schema",
      path: "tagDecision",
      message: "tagDecision must be an object"
    });
    return;
  }
  for (const key of ["add", "remove"]) {
    if (decision[key] !== undefined && !Array.isArray(decision[key])) {
      errors.push({
        type: "schema",
        path: `tagDecision.${key}`,
        message: `${key} must be an array`
      });
    }
  }

  for (const key of ["add", "remove"]) {
    const items = Array.isArray(decision[key]) ? decision[key] : [];
    items.forEach((item, index) => {
      const groupId = String(item?.groupId || item?.group_id || "").trim();
      const tagId = String(item?.tagId || item?.tag_id || "").trim();
      if (!groupId || !tagId) {
        errors.push({
          type: "schema",
          path: `tagDecision.${key}[${index}]`,
          message: "tag decision items require groupId and tagId"
        });
      }
    });
  }
}

function jsonSyntaxError(text, error) {
  const position = jsonErrorPosition(error);
  const location = position === null
    ? {}
    : lineColumnForOffset(text, position);
  return {
    type: "json_syntax",
    path: "",
    message: `Invalid JSON: ${error.message}`,
    ...location,
    context: location.line ? contextForLine(text, location.line) : ""
  };
}

function jsonErrorPosition(error) {
  const match = String(error?.message || "").match(/position (\d+)/i);
  return match ? Number(match[1]) : null;
}

function lineColumnForOffset(text, offset) {
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function contextForLine(text, line) {
  return text.split(/\r?\n/)[line - 1]?.slice(0, 240) || "";
}

function formatValidationErrorForPrompt(error) {
  const location = error.line ? ` line ${error.line}, column ${error.column || 1}` : "";
  const path = error.path ? ` path ${error.path}` : "";
  return `[${error.type || "validation"}]${path}${location}: ${error.message || "invalid response"}`;
}

function invalidResult(rawText, normalizedText, normalizations, errors) {
  return {
    valid: false,
    rawText,
    normalizedText,
    normalizations,
    errors,
    agentReply: {
      valid: false,
      reply: "",
      attachments: [],
      sources: [],
      flowDecision: null,
      tagEvaluation: [],
      tagDecision: { add: [], remove: [] },
      raw: rawText,
      validationErrors: errors
    }
  };
}

function normalizeAgentSources(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => {
      const source = {
        type: String(item.type || item.sourceType || item.kind || "").trim().toLowerCase(),
        name: String(item.name || item.title || item.label || "").trim(),
        reason: String(item.reason || item.usage || item.description || "").trim()
      };
      const id = String(item.id || item.docId || item.nodeId || "").trim();
      if (id) source.id = id;
      return source;
    })
    .filter((item) => item.type && item.name);
}

function normalizeAgentAttachments(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const attachment = {
        type: String(item.type || item.fileType || item.kind || "link").trim().toLowerCase(),
        url: String(item.url || item.fileUrl || item.href || "").trim()
      };
      const name = String(item.name || item.objectName || item.filename || item.fileName || "").trim();
      const title = String(item.title || item.label || "").trim();
      if (name) attachment.name = name;
      if (title) attachment.title = title;
      return attachment;
    })
    .filter((item) => item.url);
}

function stripRuntimeArtifacts(value) {
  let text = String(value || "").trim();
  if (!text) return "";

  const compactionPattern =
    /(?:🔄\s*)?Context compaction started\.\.\.\s*Context Status:\s*[^\n\r]*?\bkeep\(\d+\)/g;
  const completedPattern =
    /(?:✅\s*)?Context compaction completed!\s*Context Status:\s*[^\n\r]*?\b\d+\s+msgs/g;

  for (let index = 0; index < 4; index += 1) {
    const next = text
      .replace(compactionPattern, "")
      .replace(completedPattern, "")
      .trim();
    if (next === text) break;
    text = next;
  }

  return text;
}

function numberOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
