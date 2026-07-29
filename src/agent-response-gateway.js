import { normalizeTagDecision } from "./tags.js";
import { isDeepStrictEqual } from "node:util";
import {
  normalizeTagEvaluation,
  validateTagAuditContract
} from "./tag-audit.js";

const maxValidationRetryPriorResponseChars = 4000;
const maxValidationRetryTagConditionChars = 240;

export function validateAgentResponseText(rawText, {
  requireFlowDecision = false,
  requireReplyContent = false,
  allowTagDecision = false,
  flow = null,
  tagContext = null,
  tagEvidenceCandidates = []
} = {}) {
  const raw = String(rawText || "");
  const { text, normalizations } = normalizeResponseText(raw);
  const repairs = [];
  if (!text) {
    return invalidResult(raw, text, normalizations, repairs, [{
      type: "json_syntax",
      path: "",
      message: "Agent response is empty"
    }]);
  }

  let parsed;
  let normalizedText = text;
  let originalErrors = [];
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    originalErrors = [jsonSyntaxError(text, error)];
    const repairedDocument = repairJsonDocument(text);
    if (!repairedDocument) {
      return invalidResult(raw, text, normalizations, repairs, originalErrors);
    }
    parsed = repairedDocument.parsed;
    normalizedText = repairedDocument.text;
    repairs.push(repairedDocument.repair);
  }

  const validationOptions = {
    requireFlowDecision,
    requireReplyContent,
    allowTagDecision,
    flow,
    tagContext,
    tagEvidenceCandidates
  };
  const beforeRepairErrors = validateResponseObject(parsed, validationOptions);
  originalErrors = [...originalErrors, ...beforeRepairErrors];
  repairs.push(...repairResponseObject(parsed, validationOptions));
  const errors = validateResponseObject(parsed, validationOptions);
  if (errors.length) {
    return invalidResult(raw, normalizedText, normalizations, repairs, errors, originalErrors);
  }

  const normalizedReply = normalizeAgentReplyText(parsed.reply);
  return {
    valid: true,
    rawText: raw,
    normalizedText,
    normalizations: [...normalizations, ...normalizedReply.normalizations],
    repairs,
    originalErrors,
    errors: [],
    agentReply: {
      valid: true,
      reply: stripRuntimeArtifacts(normalizedReply.text),
      attachments: normalizeAgentAttachments(parsed.attachments || parsed.resources || parsed.files),
      sources: normalizeAgentSources(parsed.sources || parsed.references || parsed.evidence),
      flowDecision: parsed.flowDecision || parsed.stateUpdate || null,
      tagEvaluation: normalizeTagEvaluation(parsed.tagEvaluation),
      tagDecision: normalizeTagDecision(parsed.tagDecision || parsed.tags || {}),
      raw: parsed
    }
  };
}

export function buildAgentResponseValidationRetryRequest(request, errors = [], {
  rawResponse = "",
  tagContext = null
} = {}) {
  const priorResponse = boundedPromptText(
    rawResponse,
    maxValidationRetryPriorResponseChars
  );
  const tagChecklist = buildTagEvaluationChecklist(tagContext);
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
      ...(priorResponse
        ? [
            "",
            "上一版原始响应如下。请以它为修正基础，保留其中正确的客户回复、状态决策和标签判断：",
            priorResponse
          ]
        : []),
      ...(tagChecklist.length
        ? [
            "",
            "必须评估的完整标签清单如下。tagEvaluation 必须对每个标签恰好评估一次，不能遗漏：",
            ...tagChecklist
          ]
        : []),
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
  onRetryOutcome,
  onLocalRepair
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
      if (validation.repairs.length) {
        onLocalRepair?.({
          attemptNumber,
          stage: attemptNumber === 1 ? "initial" : "validation_retry",
          errors: validation.originalErrors,
          rawReply: validation.rawText,
          rawReplyLength: String(validation.rawText || "").length,
          repairs: validation.repairs
        });
      }
      if (attemptNumber > 1) {
        onRetryOutcome?.({
          outcome: validation.repairs.length ? "locally_repaired" : "succeeded",
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
      normalizations: validation.normalizations,
      repairs: validation.repairs
    });

    if (attemptNumber === 1) {
      onRetryRequested?.({ rawReplyLength: String(invocation?.reply || "").length });
      currentRequest = buildAgentResponseValidationRetryRequest(request, validation.errors, {
        rawResponse: validation.rawText,
        tagContext: validationOptions.tagContext
      });
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

function repairJsonDocument(text) {
  const extracted = extractCompleteJsonObjects(text);
  if (extracted.incomplete) return null;
  const candidates = [];
  for (const candidate of extracted.candidates) {
    try {
      candidates.push({ text: candidate, parsed: JSON.parse(candidate) });
    } catch {
      return null;
    }
  }
  if (candidates.length === 1) {
    return {
      ...candidates[0],
      repair: { type: "single_embedded_json_extracted" }
    };
  }
  if (
    candidates.length > 1
    && candidates.every((candidate) => isDeepStrictEqual(candidate.parsed, candidates[0].parsed))
  ) {
    return {
      ...candidates[0],
      repair: {
        type: "duplicate_json_objects_collapsed",
        count: candidates.length
      }
    };
  }
  return null;
}

function extractCompleteJsonObjects(text) {
  const candidates = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (start < 0) {
      if (character === "{") {
        start = index;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        candidates.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return {
    candidates,
    incomplete: start >= 0
  };
}

function buildTagEvaluationChecklist(tagContext) {
  const lines = [];
  for (const group of Array.isArray(tagContext?.groups) ? tagContext.groups : []) {
    const groupId = String(group?.id || "").trim();
    if (!groupId) continue;
    for (const tag of Array.isArray(group?.tags) ? group.tags : []) {
      const tagId = String(tag?.id || "").trim();
      if (!tagId) continue;
      const groupName = String(group?.name || groupId).trim();
      const tagName = String(tag?.name || tagId).trim();
      const condition = boundedPromptText(
        tag?.condition,
        maxValidationRetryTagConditionChars
      );
      lines.push(
        `- ${groupId}:${tagId} | ${groupName} / ${tagName}`
        + (condition ? ` | 达标条件：${condition}` : "")
      );
    }
  }
  return lines;
}

function boundedPromptText(value, maxChars) {
  const text = String(value || "").trim();
  if (!text || text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 6))}…[已截断]`;
}

function repairResponseObject(parsed, {
  allowTagDecision,
  tagContext,
  tagEvidenceCandidates
}) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const repairs = [];

  if (!allowTagDecision && (parsed.tagDecision !== undefined || parsed.tags !== undefined)) {
    delete parsed.tagDecision;
    delete parsed.tags;
    repairs.push({ type: "disallowed_tag_decision_removed" });
  }

  const tagAuditEnabled = Boolean(
    allowTagDecision
    && tagContext
    && Array.isArray(tagContext.groups)
    && tagContext.groups.length
    && Array.isArray(parsed.tagEvaluation)
  );
  if (!tagAuditEnabled) return repairs;

  const evidenceCandidates = (Array.isArray(tagEvidenceCandidates) ? tagEvidenceCandidates : [])
    .map((candidate) => ({
      id: String(candidate?.id || "").trim(),
      text: String(candidate?.text || "").trim()
    }))
    .filter((candidate) => candidate.id);
  const evidenceById = new Map(evidenceCandidates.map((candidate) => [candidate.id, candidate.text]));
  const evidenceByText = new Map();
  for (const candidate of evidenceCandidates) {
    const matches = evidenceByText.get(candidate.text) || [];
    matches.push(candidate);
    evidenceByText.set(candidate.text, matches);
  }

  parsed.tagEvaluation.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const evidenceMessageId = String(
      item.evidenceMessageId || item.evidence_message_id || ""
    ).trim();
    const evidenceText = String(item.evidenceText || item.evidence_text || "").trim();

    if (item.matched === false && (evidenceMessageId || evidenceText)) {
      item.evidenceMessageId = "";
      item.evidenceText = "";
      delete item.evidence_message_id;
      delete item.evidence_text;
      repairs.push({
        type: "unmatched_tag_evidence_cleared",
        index
      });
      return;
    }
    if (item.matched !== true) return;

    if (evidenceById.has(evidenceMessageId)) {
      const canonicalText = evidenceById.get(evidenceMessageId);
      if (evidenceText !== canonicalText) {
        const conflictingTextMatches = evidenceByText.get(evidenceText) || [];
        if (
          evidenceText
          && conflictingTextMatches.some((candidate) => candidate.id !== evidenceMessageId)
        ) {
          return;
        }
        item.evidenceMessageId = evidenceMessageId;
        item.evidenceText = canonicalText;
        delete item.evidence_message_id;
        delete item.evidence_text;
        repairs.push({
          type: "tag_evidence_text_canonicalized",
          index,
          evidenceMessageId
        });
      }
      return;
    }

    const textMatches = evidenceByText.get(evidenceText) || [];
    if (textMatches.length === 1) {
      item.evidenceMessageId = textMatches[0].id;
      item.evidenceText = textMatches[0].text;
      delete item.evidence_message_id;
      delete item.evidence_text;
      repairs.push({
        type: "tag_evidence_message_id_repaired",
        index,
        evidenceMessageId: textMatches[0].id
      });
    }
  });

  repairs.push(...deriveMissingTagDecisionAdds(parsed, tagContext));
  return repairs;
}

function deriveMissingTagDecisionAdds(parsed, tagContext) {
  const evaluations = normalizeTagEvaluation(parsed.tagEvaluation);
  const configuredGroups = (Array.isArray(tagContext?.groups) ? tagContext.groups : [])
    .map((group) => ({
      id: String(group?.id || "").trim(),
      exclusive: Boolean(group?.exclusive),
      oneWay: Boolean(group?.oneWay),
      tags: (Array.isArray(group?.tags) ? group.tags : [])
        .map((tag, index) => ({
          id: String(tag?.id || "").trim(),
          index
        }))
        .filter((tag) => tag.id)
    }))
    .filter((group) => group.id);
  const configuredKeys = configuredGroups.flatMap((group) =>
    group.tags.map((tag) => `${group.id}:${tag.id}`)
  );
  const evaluationByKey = new Map();
  for (const evaluation of evaluations) {
    const evaluationKey = `${evaluation.groupId}:${evaluation.tagId}`;
    if (
      !configuredKeys.includes(evaluationKey)
      || evaluationByKey.has(evaluationKey)
      || typeof evaluation.matched !== "boolean"
      || !evaluation.reason
    ) {
      return [];
    }
    evaluationByKey.set(evaluationKey, evaluation);
  }
  if (
    evaluationByKey.size !== configuredKeys.length
    || configuredKeys.some((configuredKey) => !evaluationByKey.has(configuredKey))
  ) {
    return [];
  }

  const decision = parsed.tagDecision;
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) return [];
  if (
    (decision.add !== undefined && !Array.isArray(decision.add))
    || (decision.remove !== undefined && !Array.isArray(decision.remove))
  ) {
    return [];
  }
  if (!Array.isArray(decision.add)) decision.add = [];
  if (!Array.isArray(decision.remove)) decision.remove = [];

  const current = new Set(
    (Array.isArray(tagContext?.currentTags) ? tagContext.currentTags : [])
      .map((tag) => `${String(tag?.groupId || "").trim()}:${String(tag?.tagId || "").trim()}`)
  );
  const existingAdds = new Set(
    normalizeTagDecision(decision).add.map((tag) => `${tag.groupId}:${tag.tagId}`)
  );
  const repairs = [];

  for (const group of configuredGroups) {
    const matched = group.tags.filter((tag) =>
      evaluationByKey.get(`${group.id}:${tag.id}`)?.matched === true
    );
    if (!matched.length) continue;

    const required = group.exclusive
      ? [matched.reduce((winner, tag) => tag.index > winner.index ? tag : winner)]
      : matched;
    for (const tag of required) {
      const tagKey = `${group.id}:${tag.id}`;
      const currentTag = group.tags.find((candidate) => current.has(`${group.id}:${candidate.id}`));
      const blockedByOneWay = group.exclusive
        && group.oneWay
        && currentTag
        && currentTag.index >= tag.index;
      if (current.has(tagKey) || blockedByOneWay || existingAdds.has(tagKey)) continue;

      const evaluation = evaluationByKey.get(tagKey);
      const action = {
        groupId: group.id,
        tagId: tag.id,
        reason: evaluation.reason
      };
      if (evaluation.evidenceMessageId) action.evidenceMessageId = evaluation.evidenceMessageId;
      if (evaluation.evidenceText) action.evidenceText = evaluation.evidenceText;
      decision.add.push(action);
      existingAdds.add(tagKey);
      repairs.push({
        type: "missing_tag_decision_add_derived",
        groupId: group.id,
        tagId: tag.id
      });
    }
  }
  return repairs;
}

function normalizeAgentReplyText(value) {
  const text = String(value || "");
  const decoded = text.replace(/\\r\\n|\\n|\\r/g, "\n");
  return {
    text: decoded,
    normalizations: decoded === text
      ? []
      : [{ type: "reply_escaped_line_breaks_decoded" }]
  };
}

function validateResponseObject(parsed, {
  requireFlowDecision,
  requireReplyContent,
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
  if (
    requireReplyContent
    && typeof parsed.reply === "string"
    && !parsed.reply.trim()
    && !(Array.isArray(parsed.attachments) && parsed.attachments.length)
  ) {
    errors.push({
      type: "semantic",
      path: "reply",
      message: "authorized request requires reply text or an attachment"
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

function invalidResult(
  rawText,
  normalizedText,
  normalizations,
  repairs,
  errors,
  originalErrors = errors
) {
  return {
    valid: false,
    rawText,
    normalizedText,
    normalizations,
    repairs,
    originalErrors,
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
