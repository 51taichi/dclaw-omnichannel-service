import crypto from "node:crypto";

import { detectGroupAutomationHistoryScope } from "./group-summary-template.js";
import {
  buildCompactGroupTranscript,
  packTranscriptChunks
} from "./group-history-transcript.js";

const PHASED_RETRY_DELAY_MS = 60_000;
const DEFAULT_TRANSCRIPT_MAX_CHARS = 8_000;
const DEFAULT_MERGE_BATCH_MAX_ITEMS = 8;

function instantFrom(value) {
  const resolved = typeof value === "function" ? value() : value;
  const instant = resolved instanceof Date ? new Date(resolved.getTime()) : new Date(resolved);
  if (Number.isNaN(instant.getTime())) throw new Error("invalid group automation time");
  return instant;
}

function assertWorktoolAccepted(response) {
  if (response?.code == null) return;
  const code = Number(response.code);
  if (code === 0 || code === 200) return;
  const error = new Error(
    `WorkTool explicitly rejected the command: ${response.code} ${response.message || ""}`.trim()
  );
  error.worktoolExplicitRejection = true;
  throw error;
}

function checkpointHash(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function occurrenceSnapshotContext(db, occurrence) {
  const task = occurrence?.taskSnapshot || {};
  const currentGroup = db.getGroupById?.({
    botId: occurrence.botId,
    groupId: occurrence.groupId
  }) || {};
  const snapshotGroup = task.group || {};
  return {
    task,
    roles: Array.isArray(task.roles) ? task.roles : [],
    group: {
      ...snapshotGroup,
      id: occurrence.groupId,
      conversationKey: currentGroup.conversationKey || snapshotGroup.conversationKey || "",
      createdAt: snapshotGroup.createdAt || currentGroup.createdAt || occurrence.cycleStartAt
    },
    deliveryGroupName: currentGroup.currentName || snapshotGroup.currentName || ""
  };
}

function checkpointKey({ occurrenceId, stage, level, ordinal, inputHash }) {
  return { occurrenceId, stage, level, ordinal, inputHash };
}

function getCheckpoint(db, input) {
  return typeof db.getGroupAutomationChunkCheckpoint === "function"
    ? db.getGroupAutomationChunkCheckpoint(input)
    : null;
}

function saveCheckpoint(db, input) {
  return db.saveGroupAutomationChunkCheckpoint(input);
}

function externalMessageIdToLocalId(value) {
  const match = String(value || "").match(/^wt-message-(\d+)$/u);
  const id = Number(match?.[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function mapEvidenceCodes(evidenceMap, codes) {
  return [...new Set((Array.isArray(codes) ? codes : [])
    .map((code) => evidenceMap?.[code])
    .map((value) => Number(value))
    .filter((value) => Number.isSafeInteger(value) && value > 0))];
}

function strictHistoryWindow(messages, { from, until, fromExclusive = false }) {
  const lower = new Date(from).getTime();
  const upper = new Date(until).getTime();
  return (Array.isArray(messages) ? messages : []).filter((message) => {
    const occurredAt = new Date(message?.occurredAt).getTime();
    return Number.isFinite(occurredAt)
      && (fromExclusive ? occurredAt > lower : occurredAt >= lower)
      && occurredAt <= upper;
  });
}

async function listCompleteDclawHistory(listDclawHistory, input) {
  const messages = [];
  let after = "";
  const seenCursors = new Set();
  for (let pageNumber = 0; pageNumber < 10_000; pageNumber += 1) {
    const page = await listDclawHistory({ ...input, after, limit: 500 });
    messages.push(...(Array.isArray(page?.messages) ? page.messages : []));
    if (!page?.hasMore) return messages;
    const nextCursor = String(page?.nextCursor || "");
    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw new Error("DClaw group history pagination did not advance");
    }
    seenCursors.add(nextCursor);
    after = nextCursor;
  }
  throw new Error("DClaw group history exceeded the page limit");
}

function stageMetrics({
  occurrence,
  stage,
  startedAt,
  finishedAt,
  messageCount = 0,
  transcriptChars = 0,
  chunkCount = 0,
  modelCalls = 0,
  retries = 0,
  coveredFrom = "",
  coveredUntil = ""
}) {
  return {
    botId: occurrence.botId,
    groupId: occurrence.groupId,
    occurrenceId: occurrence.id,
    stage,
    messageCount,
    transcriptChars,
    estimatedTokens: Math.ceil(transcriptChars / 3),
    chunkCount,
    modelCalls,
    retries,
    coveredFrom,
    coveredUntil,
    stageDurationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    targetDelayMs: Math.max(0, finishedAt.getTime() - new Date(occurrence.scheduledFor).getTime())
  };
}

function logPhased(logger, level, event, fields) {
  const method = typeof logger?.[level] === "function" ? logger[level] : logger?.log;
  method?.call(logger, event, fields);
}

function createPhasedGroupAutomationWorker({
  db,
  historySyncWorker,
  listDclawHistory,
  analyzeChunk,
  mergeAnalyses,
  finalizeConditional,
  finalizeSummary,
  sendGroupMessage = null,
  now = () => new Date(),
  logger = console,
  leaseMs = 300_000,
  transcriptMaxChars = DEFAULT_TRANSCRIPT_MAX_CHARS,
  mergeBatchMaxItems = DEFAULT_MERGE_BATCH_MAX_ITEMS
}) {
  if (
    !db
    || typeof historySyncWorker?.ensureSyncedThrough !== "function"
    || typeof listDclawHistory !== "function"
    || typeof analyzeChunk !== "function"
    || typeof mergeAnalyses !== "function"
    || typeof finalizeConditional !== "function"
    || typeof finalizeSummary !== "function"
  ) {
    throw new Error("phased group automation worker dependencies are required");
  }
  const chunkLimit = Math.max(500, Math.min(10_000, Number(transcriptMaxChars) || DEFAULT_TRANSCRIPT_MAX_CHARS));
  const mergeLimit = Math.max(2, Math.min(20, Number(mergeBatchMaxItems) || DEFAULT_MERGE_BATCH_MAX_ITEMS));

  async function ensureHistoryReady({ occurrence, until }) {
    const throughMessageId = Number(db.getLatestGroupConversationMessageIdAtOrBefore({
      botId: occurrence.botId,
      groupId: occurrence.groupId,
      until
    }) || 0);
    const clock = instantFrom(now);
    const result = await historySyncWorker.ensureSyncedThrough({
      botId: occurrence.botId,
      groupId: occurrence.groupId,
      throughMessageId,
      deadlineAt: new Date(Math.max(
        clock.getTime() + 300_000,
        new Date(occurrence.scheduledFor).getTime()
      )).toISOString()
    });
    if (!result?.ready) {
      throw new Error(`group history is not synchronized through message ${throughMessageId}`);
    }
    return throughMessageId;
  }

  async function analyzeTranscript({
    occurrence,
    task,
    group,
    roles,
    transcript,
    checkpointStage
  }) {
    const chunks = packTranscriptChunks(transcript, { maxRequestChars: chunkLimit });
    if (!chunks.length) {
      return {
        analysis: "指定时间范围内暂无群消息。",
        evidenceMessageCodes: [],
        chunks: 0,
        modelCalls: 0
      };
    }
    const partials = [];
    let modelCalls = 0;
    for (let ordinal = 0; ordinal < chunks.length; ordinal += 1) {
      const chunk = chunks[ordinal];
      const inputHash = checkpointHash(chunk.text);
      const identity = checkpointKey({
        occurrenceId: occurrence.id,
        stage: checkpointStage,
        level: 0,
        ordinal,
        inputHash
      });
      const saved = getCheckpoint(db, identity);
      if (saved) {
        partials.push(saved.result);
        continue;
      }
      const result = await analyzeChunk({
        task,
        group,
        roles,
        transcriptChunk: chunk,
        occurrenceId: occurrence.id,
        chunkOrdinal: ordinal
      });
      modelCalls += 1;
      saveCheckpoint(db, {
        ...identity,
        result,
        evidenceMessageIds: mapEvidenceCodes(transcript.evidenceMap, result.evidenceMessageCodes),
        now: instantFrom(now).toISOString()
      });
      db.heartbeatGroupAutomationOccurrence?.({
        occurrenceId: occurrence.id,
        owner: occurrence.leaseOwner,
        now: instantFrom(now).toISOString(),
        leaseMs
      });
      partials.push(result);
    }

    let current = partials;
    let level = 0;
    while (current.length > 1) {
      const next = [];
      for (let ordinal = 0; ordinal < Math.ceil(current.length / mergeLimit); ordinal += 1) {
        const batch = current.slice(ordinal * mergeLimit, (ordinal + 1) * mergeLimit);
        if (batch.length === 1) {
          next.push(batch[0]);
          continue;
        }
        const inputHash = checkpointHash(JSON.stringify(batch));
        const identity = checkpointKey({
          occurrenceId: occurrence.id,
          stage: `${checkpointStage}_merge`,
          level,
          ordinal,
          inputHash
        });
        const saved = getCheckpoint(db, identity);
        if (saved) {
          next.push(saved.result);
          continue;
        }
        const result = await mergeAnalyses({
          task,
          group,
          roles,
          partials: batch,
          occurrenceId: occurrence.id,
          level,
          ordinal,
          allowedEvidenceMessageCodes: Object.keys(transcript.evidenceMap)
        });
        modelCalls += 1;
        saveCheckpoint(db, {
          ...identity,
          result,
          evidenceMessageIds: mapEvidenceCodes(transcript.evidenceMap, result.evidenceMessageCodes),
          now: instantFrom(now).toISOString()
        });
        db.heartbeatGroupAutomationOccurrence?.({
          occurrenceId: occurrence.id,
          owner: occurrence.leaseOwner,
          now: instantFrom(now).toISOString(),
          leaseMs
        });
        next.push(result);
      }
      current = next;
      level += 1;
    }
    return {
      ...current[0],
      chunks: chunks.length,
      modelCalls
    };
  }

  async function processPreanalysis(occurrence, context) {
    const startedAt = instantFrom(now);
    const scope = detectGroupAutomationHistoryScope({
      taskType: context.task.taskType,
      conditionText: context.task.conditionText,
      summaryTemplate: context.task.summaryTemplate
    });
    const historyStartAt = scope === "cumulative"
      ? context.group.createdAt
      : occurrence.cycleStartAt;
    const cutoffAt = occurrence.preanalysisCutoffAt;
    await ensureHistoryReady({ occurrence, until: cutoffAt });
    const rawMessages = await listCompleteDclawHistory(listDclawHistory, {
      botId: occurrence.botId,
      groupId: occurrence.groupId,
      from: historyStartAt,
      until: cutoffAt
    });
    const messages = strictHistoryWindow(rawMessages, {
      from: historyStartAt,
      until: cutoffAt
    });
    const transcript = buildCompactGroupTranscript({
      messages,
      roles: context.roles,
      groupBackground: context.group.background
    });
    const analyzed = await analyzeTranscript({
      occurrence,
      task: context.task,
      group: context.group,
      roles: context.roles,
      transcript,
      checkpointStage: "preanalysis_chunk"
    });
    const finalHash = checkpointHash(JSON.stringify({
      task: context.task,
      historyStartAt,
      cutoffAt,
      messageIds: transcript.messageIds
    }));
    saveCheckpoint(db, {
      occurrenceId: occurrence.id,
      stage: "preanalysis_final",
      level: 0,
      ordinal: 0,
      inputHash: finalHash,
      result: {
        analysis: analyzed.analysis,
        evidenceMessageCodes: analyzed.evidenceMessageCodes,
        evidenceMap: transcript.evidenceMap,
        messageCount: transcript.messageIds.length,
        nextMessageCode: transcript.messageIds.length + 1
      },
      evidenceMessageIds: mapEvidenceCodes(transcript.evidenceMap, analyzed.evidenceMessageCodes),
      now: instantFrom(now).toISOString()
    });
    const finishedAt = instantFrom(now);
    const metrics = stageMetrics({
      occurrence,
      stage: "preanalysis",
      startedAt,
      finishedAt,
      messageCount: transcript.messageIds.length,
      transcriptChars: transcript.lines.reduce((total, line) => total + line.length, transcript.header.length),
      chunkCount: analyzed.chunks,
      modelCalls: analyzed.modelCalls,
      coveredFrom: historyStartAt,
      coveredUntil: cutoffAt
    });
    logPhased(logger, "info", "group_automation.preanalysis.completed", metrics);
    return db.transitionGroupAutomationOccurrence({
      occurrenceId: occurrence.id,
      owner: occurrence.leaseOwner,
      fromStages: ["preanalysis"],
      toStage: "waiting_target",
      patch: {
        historyStartAt,
        preanalysisCutoffAt: cutoffAt,
        retryMetadata: {
          preanalysisCheckpointHash: finalHash,
          preanalysisMetrics: metrics
        }
      },
      now: finishedAt.toISOString()
    });
  }

  function loadPreanalysisFinal(occurrence) {
    const inputHash = occurrence.retryMetadata?.preanalysisCheckpointHash;
    if (!inputHash) throw new Error("preanalysis final checkpoint is missing");
    const checkpoint = getCheckpoint(db, {
      occurrenceId: occurrence.id,
      stage: "preanalysis_final",
      level: 0,
      ordinal: 0,
      inputHash
    });
    if (!checkpoint) throw new Error("preanalysis final checkpoint is unavailable");
    return checkpoint.result;
  }

  async function deliverFrozenPayload(occurrence) {
    const frozenPayload = occurrence.frozenPayload || {};
    if (!String(frozenPayload.content || "").trim()) {
      throw new Error("frozen group automation payload is unavailable");
    }
    if (occurrence.stage === "send_pending") {
      const sending = db.transitionGroupAutomationOccurrence({
        occurrenceId: occurrence.id,
        owner: occurrence.leaseOwner,
        fromStages: ["send_pending"],
        toStage: "sending",
        patch: { deliveryState: "sending" },
        now: instantFrom(now).toISOString()
      });
      Object.assign(occurrence, sending, { stage: "sending" });
    }
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await sendGroupMessage({
          robotId: occurrence.botId,
          targets: [frozenPayload.targetGroupName],
          content: frozenPayload.content,
          atList: frozenPayload.atList || [],
          occurrenceId: occurrence.id
        });
        assertWorktoolAccepted(response);
        const worktoolMessageId = extractWorktoolMessageId(response);
        return db.transitionGroupAutomationOccurrence({
          occurrenceId: occurrence.id,
          owner: occurrence.leaseOwner,
          fromStages: ["sending"],
          toStage: "awaiting_confirmation",
          patch: {
            deliveryState: "awaiting_confirmation",
            worktoolMessageId,
            worktoolResponse: response,
            retryMetadata: {
              ...(occurrence.retryMetadata || {}),
              sendAttempts: attempt
            }
          },
          now: instantFrom(now).toISOString()
        });
      } catch (error) {
        if (error?.worktoolExplicitRejection === true) {
          if (attempt < 3) continue;
          return db.transitionGroupAutomationOccurrence({
            occurrenceId: occurrence.id,
            owner: occurrence.leaseOwner,
            fromStages: ["sending"],
            toStage: "failed",
            patch: {
              deliveryState: "rejected",
              errorMessage: String(error.message || error),
              retryMetadata: {
                ...(occurrence.retryMetadata || {}),
                sendAttempts: attempt
              }
            },
            now: instantFrom(now).toISOString()
          });
        }
        if (typeof db.markGroupAutomationSendUnknown === "function") {
          return db.markGroupAutomationSendUnknown({
            occurrenceId: occurrence.id,
            owner: occurrence.leaseOwner,
            transportReference: String(error?.transportReference || ""),
            error: String(error?.message || error),
            now: instantFrom(now).toISOString()
          });
        }
        return db.transitionGroupAutomationOccurrence({
          occurrenceId: occurrence.id,
          owner: occurrence.leaseOwner,
          fromStages: ["sending"],
          toStage: "delivery_unknown",
          patch: {
            deliveryState: "unknown",
            errorMessage: String(error?.message || error)
          },
          now: instantFrom(now).toISOString()
        });
      }
    }
    throw new Error("unreachable group automation delivery state");
  }

  async function processTarget(occurrence, context) {
    const startedAt = instantFrom(now);
    if (startedAt.getTime() < new Date(occurrence.scheduledFor).getTime()) {
      throw new Error("group automation target is not due");
    }
    const preanalysis = loadPreanalysisFinal(occurrence);
    await ensureHistoryReady({ occurrence, until: occurrence.scheduledFor });
    const rawDelta = await listCompleteDclawHistory(listDclawHistory, {
      botId: occurrence.botId,
      groupId: occurrence.groupId,
      from: occurrence.preanalysisCutoffAt,
      until: occurrence.scheduledFor
    });
    const deltaMessages = strictHistoryWindow(rawDelta, {
      from: occurrence.preanalysisCutoffAt,
      until: occurrence.scheduledFor,
      fromExclusive: true
    });
    const deltaTranscript = buildCompactGroupTranscript({
      messages: deltaMessages,
      roles: context.roles,
      groupBackground: context.group.background,
      startCode: Number(preanalysis.nextMessageCode || 1)
    });
    const deltaAnalysis = deltaMessages.length
      ? await analyzeTranscript({
          occurrence,
          task: context.task,
          group: context.group,
          roles: context.roles,
          transcript: deltaTranscript,
          checkpointStage: "delta_chunk"
        })
      : null;
    const sendPending = db.transitionGroupAutomationOccurrence({
      occurrenceId: occurrence.id,
      owner: occurrence.leaseOwner,
      fromStages: ["delta_analysis"],
      toStage: "finalizing",
      patch: {},
      now: instantFrom(now).toISOString()
    });
    occurrence.stage = "finalizing";
    const evidenceMap = {
      ...(preanalysis.evidenceMap || {}),
      ...deltaTranscript.evidenceMap
    };
    const analyses = [{
      analysis: preanalysis.analysis,
      evidenceMessageCodes: preanalysis.evidenceMessageCodes || []
    }];
    const finalInput = {
      task: context.task,
      group: context.group,
      roles: context.roles,
      analyses,
      deltaAnalysis,
      occurrenceId: occurrence.id,
      allowedEvidenceMessageCodes: Object.keys(evidenceMap)
    };
    const final = context.task.taskType === "conditional_push"
      ? await finalizeConditional(finalInput)
      : await finalizeSummary(finalInput);
    const evidenceMessageIds = mapEvidenceCodes(evidenceMap, final.evidenceMessageCodes);
    if (context.task.taskType === "conditional_push" && !final.achieved) {
      const completed = db.transitionGroupAutomationOccurrence({
        occurrenceId: occurrence.id,
        owner: occurrence.leaseOwner,
        fromStages: ["finalizing"],
        toStage: "skipped",
        patch: {
          conditionAchieved: false,
          decisionNote: final.decisionNote,
          evidenceMessageIds,
          actualCompletedAt: instantFrom(now).toISOString(),
          targetDelayMs: Math.max(0, instantFrom(now).getTime() - new Date(occurrence.scheduledFor).getTime())
        },
        now: instantFrom(now).toISOString()
      });
      logPhased(logger, "info", "group_automation.target.completed", stageMetrics({
        occurrence,
        stage: "skipped",
        startedAt,
        finishedAt: instantFrom(now),
        messageCount: deltaMessages.length,
        transcriptChars: deltaTranscript.lines.reduce((total, line) => total + line.length, deltaTranscript.header.length),
        chunkCount: deltaAnalysis?.chunks || 0,
        modelCalls: (deltaAnalysis?.modelCalls || 0) + 1,
        coveredFrom: occurrence.preanalysisCutoffAt,
        coveredUntil: occurrence.scheduledFor
      }));
      return completed;
    }

    const renderedContent = context.task.taskType === "conditional_push"
      ? String(context.task.content || "")
      : String(final.content || "");
    if (!renderedContent.trim()) throw new Error("group automation final content is empty");
    const mentionRoleIds = Array.isArray(context.task.mentionRoleIds)
      ? context.task.mentionRoleIds
      : [];
    const rolesById = new Map(context.roles.map((role) => [String(role.id), role]));
    const mentionNames = mentionRoleIds
      .map((roleId) => rolesById.get(String(roleId))?.currentName)
      .filter(Boolean);
    const frozenPayload = {
      targetGroupName: context.deliveryGroupName,
      content: renderedContent,
      atList: [...new Set(mentionNames)],
      mentionRoleIds,
      evidenceMessageIds
    };
    db.transitionGroupAutomationOccurrence({
      occurrenceId: occurrence.id,
      owner: occurrence.leaseOwner,
      fromStages: ["finalizing"],
      toStage: "send_pending",
      patch: {
        conditionAchieved: context.task.taskType === "conditional_push" ? true : null,
        decisionNote: final.decisionNote,
        evidenceMessageIds,
        renderedContent,
        mentionRoleIds,
        mentionNames: frozenPayload.atList,
        frozenPayload
      },
      now: instantFrom(now).toISOString()
    });
    Object.assign(occurrence, sendPending, { stage: "send_pending", frozenPayload });
    if (typeof sendGroupMessage !== "function") return db.getGroupAutomationOccurrence({
      occurrenceId: occurrence.id
    });
    const completed = await deliverFrozenPayload(occurrence);
    const completedAt = instantFrom(now);
    logPhased(logger, "info", "group_automation.target.completed", stageMetrics({
      occurrence,
      stage: "sent",
      startedAt,
      finishedAt: completedAt,
      messageCount: deltaMessages.length,
      transcriptChars: deltaTranscript.lines.reduce((total, line) => total + line.length, deltaTranscript.header.length),
      chunkCount: deltaAnalysis?.chunks || 0,
      modelCalls: (deltaAnalysis?.modelCalls || 0) + 1,
      coveredFrom: occurrence.preanalysisCutoffAt,
      coveredUntil: occurrence.scheduledFor
    }));
    return completed;
  }

  async function failStage(occurrence, error) {
    const current = db.getGroupAutomationOccurrence({ occurrenceId: occurrence.id }) || occurrence;
    const retryStage = current.stage;
    let retried = null;
    if (["preanalysis", "delta_analysis", "finalizing"].includes(retryStage)) {
      try {
        retried = db.transitionGroupAutomationOccurrence({
          occurrenceId: occurrence.id,
          owner: current.leaseOwner || occurrence.leaseOwner,
          fromStages: [retryStage],
          toStage: "retry_wait",
          patch: {
            retryMetadata: {
              ...(current.retryMetadata || {}),
              retryStage,
              lastError: String(error?.message || error)
            },
            nextRetryAt: new Date(instantFrom(now).getTime() + PHASED_RETRY_DELAY_MS).toISOString(),
            errorMessage: String(error?.message || error)
          },
          now: instantFrom(now).toISOString()
        });
      } catch (transitionError) {
        logPhased(logger, "warn", "group_automation.stage.retry_transition_failed", {
          botId: occurrence.botId,
          groupId: occurrence.groupId,
          occurrenceId: occurrence.id,
          stage: retryStage,
          error: String(transitionError?.message || transitionError)
        });
      }
    }
    logPhased(logger, "error", "group_automation.stage.failed", {
      botId: occurrence.botId,
      groupId: occurrence.groupId,
      occurrenceId: occurrence.id,
      stage: retryStage,
      messageCount: 0,
      chunkCount: 0,
      stageDurationMs: 0,
      error: String(error?.message || error)
    });
    return retried || db.getGroupAutomationOccurrence({ occurrenceId: occurrence.id }) || current;
  }

  async function processOccurrence({ occurrenceId, owner }) {
    const occurrence = db.getGroupAutomationOccurrence({ occurrenceId });
    if (!occurrence) throw new Error("group automation occurrence not found");
    if (occurrence.leaseOwner !== owner) throw new Error("group automation occurrence lease is not owned");
    const context = occurrenceSnapshotContext(db, occurrence);
    try {
      if (occurrence.stage === "preanalysis") return await processPreanalysis(occurrence, context);
      if (occurrence.stage === "delta_analysis") return await processTarget(occurrence, context);
      if (occurrence.stage === "send_pending" && typeof sendGroupMessage === "function") {
        return await deliverFrozenPayload(occurrence);
      }
      return occurrence;
    } catch (error) {
      return failStage(occurrence, error);
    }
  }

  async function runOccurrenceTick({ owner, limit = 10 } = {}) {
    const normalizedOwner = String(owner || "").trim();
    if (!normalizedOwner) throw new Error("group automation occurrence owner is required");
    const timestamp = instantFrom(now).toISOString();
    const results = [];
    const preparatory = db.claimPreparatoryGroupAutomationOccurrences({
      owner: normalizedOwner,
      now: timestamp,
      prepareBeforeMs: 600_000,
      leaseMs,
      limit
    });
    for (const occurrence of preparatory) {
      results.push(await processOccurrence({ occurrenceId: occurrence.id, owner: normalizedOwner }));
    }
    const remaining = Math.max(0, Number(limit) - results.length);
    if (remaining && typeof db.claimTargetGroupAutomationOccurrences === "function") {
      const targets = db.claimTargetGroupAutomationOccurrences({
        owner: normalizedOwner,
        now: timestamp,
        leaseMs,
        limit: remaining
      });
      for (const occurrence of targets) {
        results.push(await processOccurrence({ occurrenceId: occurrence.id, owner: normalizedOwner }));
      }
    }
    return results;
  }

  async function recoverExpiredLeases({ owner = `group-automation:${process.pid}`, limit = 10 } = {}) {
    db.cleanupGroupAutomationChunkCheckpoints?.({
      before: new Date(instantFrom(now).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    });
    return runOccurrenceTick({ owner, limit });
  }

  return {
    recoverExpiredLeases,
    runOccurrenceTick,
    processOccurrence,
    sendGroupMessage
  };
}

export function createGroupAutomationWorker(options = {}) {
  return createPhasedGroupAutomationWorker(options);
}

function extractWorktoolMessageId(response) {
  const candidates = [
    response?.messageId,
    typeof response?.data === "string" || typeof response?.data === "number"
      ? response.data
      : "",
    response?.data?.messageId,
    response?.data?.msgId,
    response?.msgId
  ];
  return String(candidates.find(Boolean) || "");
}
