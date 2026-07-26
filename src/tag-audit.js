import { normalizeTagDecision } from "./tags.js";

function text(value) {
  return String(value || "").trim();
}

function key(groupId, tagId) {
  return `${groupId}:${tagId}`;
}

function error(path, message, type = "semantic") {
  return { type, path, message };
}

export function normalizeTagEvaluation(value = []) {
  return (Array.isArray(value) ? value : []).map((item) => ({
    groupId: text(item?.groupId || item?.group_id),
    tagId: text(item?.tagId || item?.tag_id),
    matched: item?.matched,
    reason: text(item?.reason),
    evidenceMessageId: text(item?.evidenceMessageId || item?.evidence_message_id),
    evidenceText: text(item?.evidenceText || item?.evidence_text)
  }));
}

export function validateTagAuditContract({
  evaluation,
  decision,
  tagContext,
  evidenceCandidates = []
} = {}) {
  const evaluations = normalizeTagEvaluation(evaluation);
  const normalizedDecision = normalizeTagDecision(decision);
  const errors = [];
  const configured = new Map();
  const groupDetails = new Map();

  for (const group of Array.isArray(tagContext?.groups) ? tagContext.groups : []) {
    const groupId = text(group?.id);
    if (!groupId) continue;
    const tags = (Array.isArray(group?.tags) ? group.tags : [])
      .map((tag, index) => ({
        groupId,
        tagId: text(tag?.id),
        index
      }))
      .filter((tag) => tag.tagId);
    groupDetails.set(groupId, {
      id: groupId,
      exclusive: Boolean(group?.exclusive),
      oneWay: Boolean(group?.oneWay),
      tags
    });
    for (const tag of tags) configured.set(key(groupId, tag.tagId), tag);
  }

  const evidence = new Map(
    (Array.isArray(evidenceCandidates) ? evidenceCandidates : [])
      .map((candidate) => [text(candidate?.id), text(candidate?.text)])
      .filter(([id]) => id)
  );
  const evaluationByKey = new Map();

  evaluations.forEach((item, index) => {
    const itemKey = key(item.groupId, item.tagId);
    const path = `tagEvaluation[${index}]`;
    if (!item.groupId || !item.tagId) {
      errors.push(error(path, "tag evaluations require groupId and tagId", "schema"));
      return;
    }
    if (!configured.has(itemKey)) {
      errors.push(error(path, `tag '${itemKey}' is not configured`));
    }
    if (evaluationByKey.has(itemKey)) {
      errors.push(error(path, `tag '${itemKey}' was evaluated more than once`));
    } else {
      evaluationByKey.set(itemKey, item);
    }
    if (typeof item.matched !== "boolean") {
      errors.push(error(`${path}.matched`, "matched must be a boolean", "schema"));
    }
    if (!item.reason) {
      errors.push(error(`${path}.reason`, "reason is required", "schema"));
    }
    if (item.matched === true) {
      if (!item.evidenceMessageId) {
        errors.push(error(`${path}.evidenceMessageId`, "evidenceMessageId is required when matched=true", "schema"));
      } else if (!evidence.has(item.evidenceMessageId)) {
        errors.push(error(
          `${path}.evidenceMessageId`,
          `evidenceMessageId '${item.evidenceMessageId}' is not in tagEvidenceCandidates`
        ));
      } else if (item.evidenceText !== evidence.get(item.evidenceMessageId)) {
        errors.push(error(
          `${path}.evidenceText`,
          "evidenceText must exactly match the selected tagEvidenceCandidates text"
        ));
      }
    } else if (item.evidenceMessageId || item.evidenceText) {
      errors.push(error(
        `${path}.evidenceMessageId`,
        "evidenceMessageId and evidenceText must be empty when matched=false"
      ));
    }
  });

  for (const configuredKey of configured.keys()) {
    if (!evaluationByKey.has(configuredKey)) {
      errors.push(error("tagEvaluation", `tag '${configuredKey}' was not evaluated`));
    }
  }

  const decisionAdds = new Map();
  for (const actionName of ["add", "remove"]) {
    normalizedDecision[actionName].forEach((action, index) => {
      const actionKey = key(action.groupId, action.tagId);
      const path = `tagDecision.${actionName}[${index}]`;
      if (!configured.has(actionKey)) {
        errors.push(error(path, `tag '${actionKey}' is not configured`));
      }
      if (actionName === "add") {
        decisionAdds.set(actionKey, action);
        if (evaluationByKey.get(actionKey)?.matched !== true) {
          errors.push(error(path, `tag '${actionKey}' does not have a positive evaluation`));
        }
      }
    });
  }

  const current = new Set(
    (Array.isArray(tagContext?.currentTags) ? tagContext.currentTags : [])
      .map((tag) => key(text(tag?.groupId), text(tag?.tagId)))
  );

  for (const group of groupDetails.values()) {
    const matched = group.tags.filter((tag) => (
      evaluationByKey.get(key(group.id, tag.tagId))?.matched === true
    ));
    if (!matched.length) continue;

    if (!group.exclusive) {
      for (const tag of matched) {
        const tagKey = key(group.id, tag.tagId);
        if (!current.has(tagKey) && !decisionAdds.has(tagKey)) {
          errors.push(error(
            "tagDecision.add",
            `matched tag '${tagKey}' must appear in tagDecision.add`
          ));
        }
      }
      continue;
    }

    const winner = matched.reduce((best, tag) => (
      !best || tag.index > best.index ? tag : best
    ), null);
    const winnerKey = key(group.id, winner.tagId);
    const currentTag = group.tags.find((tag) => current.has(key(group.id, tag.tagId)));
    const blockedByOneWay = group.oneWay && currentTag && currentTag.index >= winner.index;
    if (!current.has(winnerKey) && !blockedByOneWay && !decisionAdds.has(winnerKey)) {
      errors.push(error(
        "tagDecision.add",
        `matched tag '${winnerKey}' must appear in tagDecision.add`
      ));
    }
  }

  return { evaluations, errors };
}
