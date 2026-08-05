import crypto from "node:crypto";

import {
  buildGroupLedgerAgentRequest,
  buildGroupOccurrenceAgentRequest,
  parseGroupOccurrenceAgentReply,
  parseGroupLedgerAgentReply
} from "./group-automation-agent.js";
import { groupAutomationCycleWindow } from "./group-automation-schedule.js";
import {
  detectGroupAutomationHistoryScope,
  isCumulativeSummaryVariable,
  parseGroupSummaryTemplate,
  renderGroupSummaryTemplate
} from "./group-summary-template.js";
import {
  buildCompactGroupTranscript,
  packTranscriptChunks
} from "./group-history-transcript.js";

const LEDGER_RETRY_DELAYS_MS = [60_000, 180_000, 600_000];
const OCCURRENCE_RETRY_DELAYS_MS = [60_000, 180_000, 600_000];
const CUSTOMER_VISIBLE_DISCLOSURE_MARKERS = [
  "群背景",
  "事实账本",
  "后台配置",
  "后台记录",
  "内部配置",
  "角色配置",
  "系统记录",
  "系统资料",
  "提示词",
  "privateContext"
];
const CUSTOMER_VISIBLE_SOURCE_DISCLOSURE_PATTERNS = [
  /(?:根据|按照|依照|依据|来自|参考|从).{0,16}角色\s*(?:的)?\s*(?:配置|设定|资料|备注)/u,
  /(?:根据|按照|依照|依据|来自|参考|从).{0,16}(?:系统|后台|内部)\s*(?:里|内|中|里面|内部)?\s*(?:的)?\s*(?:记录|资料|配置|数据|信息)/u,
  /(?:根据|按照|依照|依据|来自|参考|从).{0,16}(?:提示词|提示\s*(?:里|内|中|里面)?\s*(?:的)?\s*(?:内容|要求)|指令)/u
];

function instantFrom(value) {
  const result = typeof value === "function" ? value() : value;
  const instant = result instanceof Date ? result : new Date(result || Date.now());
  if (Number.isNaN(instant.getTime())) throw new Error("invalid group automation worker time");
  return instant;
}

function agentText(result) {
  if (typeof result === "string") return result;
  if (typeof result?.response === "string") return result.response;
  if (typeof result?.reply === "string") return result.reply;
  if (typeof result?.text === "string") return result.text;
  throw new Error("group automation Agent returned no text");
}

function assertWorktoolAccepted(response) {
  if (response?.code == null) return;
  const code = Number(response.code);
  if (code === 0 || code === 200) return;
  const error = new Error(`WorkTool explicitly rejected the command: ${response.code} ${response.message || ""}`.trim());
  error.worktoolExplicitRejection = true;
  throw error;
}

function buildBoundedLedgerRequest(input) {
  let messages = input.messages;
  while (messages.length) {
    try {
      return {
        messages,
        request: buildGroupLedgerAgentRequest({ ...input, messages })
      };
    } catch (error) {
      if (error.message !== "group automation Agent request exceeds maxChars"
        || messages.length === 1) {
        throw error;
      }
      messages = messages.slice(0, Math.max(1, Math.floor(messages.length / 2)));
    }
  }
  return {
    messages,
    request: buildGroupLedgerAgentRequest({ ...input, messages })
  };
}

function createLegacyGroupAutomationWorker({
  db,
  getBinding,
  invokeAgent,
  sendText = null,
  publish = () => {},
  now = () => new Date(),
  logger = console,
  batchSize = 10,
  leaseMs = 300000
}) {
  if (!db || typeof getBinding !== "function" || typeof invokeAgent !== "function") {
    throw new Error("group automation worker dependencies are required");
  }
  let ledgerBusy = false;
  let occurrenceBusy = false;

  async function enqueueLive({ botId, groupId, throughMessageId }) {
    return db.enqueueGroupLedgerJob({
      botId,
      groupId,
      mode: "live",
      throughMessageId
    });
  }

  async function enqueueReindex({ botId, groupId, reason = "configuration_changed" }) {
    const throughMessageId = Number(
      db.getLatestInboundGroupMessageId?.({ botId, groupId }) || 0
    );
    if (!throughMessageId) return null;
    logger.info?.("group_automation.ledger.reindex_enqueued", {
      botId,
      groupId,
      reason,
      throughMessageId
    });
    return db.enqueueGroupLedgerJob({
      botId,
      groupId,
      mode: "reindex",
      fromMessageId: 0,
      throughMessageId
    });
  }

  async function processLedgerJob(job) {
    const binding = getBinding(job.botId);
    const group = db.getGroupById({ botId: job.botId, groupId: job.groupId });
    if (!binding?.enabled || !group) {
      throw new Error("group ledger binding or managed group is unavailable");
    }
    const allTasks = db.listGroupAutomationTasks({
      botId: job.botId,
      groupId: job.groupId
    }).filter((task) => task.enabled);
    const analysisTasks = allTasks
      .filter((task) => (
        (task.taskType === "conditional_push" && task.conditionText.trim())
        || (task.taskType === "periodic_summary" && task.summaryTemplate.trim())
      ))
      .map((task) => ({
        ...task,
        currentCycle: groupAutomationCycleWindow(task.cadence, instantFrom(now).toISOString())
      }));
    if (!analysisTasks.length) {
      const result = db.applyGroupLedgerEvaluation({
        jobId: job.id,
        botId: job.botId,
        groupId: job.groupId,
        throughMessageId: job.throughMessageId,
        facts: [],
        conditionStates: []
      });
      publish({ botId: job.botId, groupId: job.groupId, ledgerUpdated: true });
      return result;
    }

    const roles = db.listGroupRoles({ botId: job.botId, groupId: job.groupId });
    const projection = db.listGroupLedgerProjection({
      botId: job.botId,
      groupId: job.groupId
    });
    const messages = db.listInboundGroupMessagesForLedger({
      botId: job.botId,
      groupId: job.groupId,
      afterMessageId: job.fromMessageId,
      throughMessageId: job.throughMessageId,
      limit: 120
    });
    const bounded = buildBoundedLedgerRequest({
      binding,
      group,
      roles,
      tasks: analysisTasks,
      projection,
      messages
    });
    const rawReply = await invokeAgent({
      binding,
      request: bounded.request,
      priority: "background",
      key: group.conversationKey,
      purpose: "group-ledger"
    });
    const parsed = parseGroupLedgerAgentReply(agentText(rawReply), {
      allowedMessageIds: bounded.messages.map((message) => message.id),
      allowedTaskIds: analysisTasks
        .filter((task) => task.taskType === "conditional_push")
        .map((task) => task.id),
      allowedFactKeys: projection.facts.map((fact) => fact.semanticKey),
      allowedRoleIds: roles.map((role) => role.id)
    });
    const processedThroughMessageId = Number(
      bounded.messages.at(-1)?.id || job.throughMessageId
    );
    const result = db.applyGroupLedgerEvaluation({
      jobId: job.id,
      botId: job.botId,
      groupId: job.groupId,
      throughMessageId: processedThroughMessageId,
      facts: parsed.facts,
      conditionStates: parsed.conditionStates
    });
    publish({ botId: job.botId, groupId: job.groupId, ledgerUpdated: true });
    return result;
  }

  async function runLedgerTick() {
    if (ledgerBusy) return [];
    ledgerBusy = true;
    const results = [];
    try {
      const claimTime = instantFrom(now);
      const jobs = db.claimGroupLedgerJobs({
        nowIso: claimTime.toISOString(),
        limit: batchSize,
        leaseMs
      });
      for (const job of jobs) {
        try {
          results.push(await processLedgerJob(job));
        } catch (error) {
          const delay = LEDGER_RETRY_DELAYS_MS[Math.min(
            Math.max(0, job.attempts - 1),
            LEDGER_RETRY_DELAYS_MS.length - 1
          )];
          const terminal = job.attempts >= LEDGER_RETRY_DELAYS_MS.length;
          const nextRetryAt = terminal
            ? ""
            : new Date(claimTime.getTime() + delay).toISOString();
          db.failGroupLedgerJob({
            jobId: job.id,
            botId: job.botId,
            errorMessage: error.message,
            nextRetryAt,
            terminal
          });
          logger.warn?.("group_automation.ledger.failed", {
            botId: job.botId,
            groupId: job.groupId,
            jobId: job.id,
            attempt: job.attempts,
            terminal,
            error: error.message
          });
        }
      }
      return results;
    } finally {
      ledgerBusy = false;
    }
  }

  async function ensureLedgerCurrent({ botId, groupId, throughMessageId }) {
    const maximumBatches = 250;
    for (let batch = 0; batch < maximumBatches; batch += 1) {
      const state = db.getGroupLedgerState({ botId, groupId });
      if (Number(state.liveCursorMessageId || 0) >= throughMessageId) return state;
      const results = await runLedgerTick();
      const refreshed = db.getGroupLedgerState({ botId, groupId });
      if (Number(refreshed.liveCursorMessageId || 0) >= throughMessageId) return refreshed;
      if (!results.length) {
        throw new Error("group ledger could not advance through the latest inbound message");
      }
    }
    throw new Error("group ledger catch-up exceeded the bounded batch limit");
  }

  async function ensureReindexComplete({ botId, groupId }) {
    if (typeof db.hasUnfinishedGroupLedgerReindex !== "function") return;
    const maximumBatches = 250;
    for (let batch = 0; batch < maximumBatches; batch += 1) {
      if (!db.hasUnfinishedGroupLedgerReindex({ botId, groupId })) return;
      const results = await runLedgerTick();
      if (!results.length) {
        throw new Error("group ledger reindex could not advance");
      }
    }
    throw new Error("group ledger reindex exceeded the bounded batch limit");
  }

  async function runOccurrenceTick() {
    if (occurrenceBusy) return [];
    occurrenceBusy = true;
    const results = [];
    try {
      const claimTime = instantFrom(now);
      const occurrences = db.claimDueGroupAutomationOccurrences({
        nowIso: claimTime.toISOString(),
        limit: batchSize,
        leaseMs
      });
      for (const occurrence of occurrences) {
        let sendingStarted = false;
        try {
          const task = db.getGroupAutomationTask({
            botId: occurrence.botId,
            taskId: occurrence.taskId
          });
          const group = db.getGroupById({
            botId: occurrence.botId,
            groupId: occurrence.groupId
          });
          const binding = getBinding(occurrence.botId);
          if (!task || task.deletedAt || !task.enabled || !group || !binding?.enabled) {
            results.push(db.completeGroupAutomationOccurrence({
              botId: occurrence.botId,
              occurrenceId: occurrence.id,
              executionToken: occurrence.executionToken,
              status: "canceled",
              reason: "任务、群或 Bot 已停用"
            }));
            continue;
          }

          await ensureReindexComplete({
            botId: occurrence.botId,
            groupId: occurrence.groupId
          });

          const latestInboundMessageId = Number(
            db.getLatestInboundGroupMessageId?.({
              botId: occurrence.botId,
              groupId: occurrence.groupId
            }) || 0
          );
          const ledgerState = db.getGroupLedgerState?.({
            botId: occurrence.botId,
            groupId: occurrence.groupId
          }) || { liveCursorMessageId: 0 };
          if (latestInboundMessageId > Number(ledgerState.liveCursorMessageId || 0)) {
            await enqueueLive({
              botId: occurrence.botId,
              groupId: occurrence.groupId,
              throughMessageId: latestInboundMessageId
            });
            const refreshedState = await ensureLedgerCurrent({
              botId: occurrence.botId,
              groupId: occurrence.groupId,
              throughMessageId: latestInboundMessageId
            });
            if (Number(refreshedState.liveCursorMessageId || 0) < latestInboundMessageId) {
              throw new Error("group ledger is not current through the latest inbound message");
            }
          }

          const roles = db.listGroupRoles({
            botId: occurrence.botId,
            groupId: occurrence.groupId
          });
          const projection = db.listGroupLedgerProjection({
            botId: occurrence.botId,
            groupId: occurrence.groupId
          });
          const allFactsByKey = new Map(
            projection.facts.map((fact) => [fact.semanticKey, fact])
          );
          const parsedSummaryTemplate = task.taskType === "periodic_summary"
            ? parseGroupSummaryTemplate(task.summaryTemplate)
            : null;
          const cumulativeSummary = parsedSummaryTemplate?.variables.some(
            isCumulativeSummaryVariable
          ) || false;
          const aggregateFactKeys = [...new Set(
            Object.values(projection.aggregates || {})
              .flatMap((aggregate) => aggregate.evidenceFactKeys || [])
              .map(String)
          )];
          const cycleStart = new Date(occurrence.cycleStartAt).getTime();
          const cycleEnd = new Date(occurrence.cycleEndAt).getTime();
          projection.facts = projection.facts.filter((fact) => {
            const happenedAt = new Date(fact.happenedAt).getTime();
            return fact.active !== false
              && happenedAt >= cycleStart
              && happenedAt < cycleEnd;
          });
          if (!cumulativeSummary) projection.aggregates = {};
          const factsByKey = new Map(
            projection.facts.map((fact) => [fact.semanticKey, fact])
          );
          const cycleFactKeys = [...factsByKey.keys()];
          if (cumulativeSummary) {
            for (const aggregate of Object.values(projection.aggregates || {})) {
              for (const key of aggregate.evidenceFactKeys || []) {
                const fact = allFactsByKey.get(key);
                if (fact) factsByKey.set(key, fact);
              }
            }
          }
          let renderedContent = task.content;
          let conditionAchieved = null;
          let reason = task.conditionText ? "" : "无条件固定推送";
          let variableValues = {};
          let referencedFactKeys = [];

          if (task.taskType === "conditional_push" && task.conditionText.trim()) {
            const request = buildGroupOccurrenceAgentRequest({
              binding,
              group,
              roles,
              task,
              cycle: {
                cycleKey: occurrence.cycleKey,
                startAt: occurrence.cycleStartAt,
                endAt: occurrence.cycleEndAt
              },
              projection
            });
            const reply = await invokeAgent({
              binding,
              request,
              priority: "background",
              key: group.conversationKey,
              purpose: "group-automation-occurrence"
            });
            const decision = parseGroupOccurrenceAgentReply(agentText(reply), {
              taskType: task.taskType,
              allowedFactKeys: [...factsByKey.keys()]
            });
            conditionAchieved = decision.achieved;
            reason = decision.reason;
            referencedFactKeys = [
              ...decision.supportingFactKeys,
              ...decision.contradictingFactKeys
            ];
            if (!decision.achieved) {
              const evidence = evidenceForFactKeys(factsByKey, referencedFactKeys);
              const completed = db.completeGroupAutomationOccurrence({
                botId: occurrence.botId,
                occurrenceId: occurrence.id,
                executionToken: occurrence.executionToken,
                status: "skipped",
                conditionAchieved: false,
                reason,
                factIds: evidence.factIds,
                evidenceMessageIds: evidence.messageIds
              });
              publish({
                botId: occurrence.botId,
                groupId: occurrence.groupId,
                taskId: task.id,
                occurrence: completed
              });
              results.push(completed);
              continue;
            }
          } else if (task.taskType === "periodic_summary") {
            const parsedTemplate = parsedSummaryTemplate;
            const request = buildGroupOccurrenceAgentRequest({
              binding,
              group,
              roles,
              task,
              cycle: {
                cycleKey: occurrence.cycleKey,
                startAt: occurrence.cycleStartAt,
                endAt: occurrence.cycleEndAt
              },
              projection
            });
            const reply = await invokeAgent({
              binding,
              request,
              priority: "background",
              key: group.conversationKey,
              purpose: "group-automation-occurrence"
            });
            const summary = parseGroupOccurrenceAgentReply(agentText(reply), {
              taskType: task.taskType,
              allowedFactKeys: [...factsByKey.keys()],
              allowedCycleFactKeys: cycleFactKeys,
              allowedAggregateFactKeys: aggregateFactKeys,
              variables: parsedTemplate.variables.map((variable) => ({
                ...variable,
                scope: isCumulativeSummaryVariable(variable) ? "cumulative" : "cycle"
              }))
            });
            variableValues = Object.fromEntries(
              summary.variables.map((variable) => [variable.name, variable.value])
            );
            referencedFactKeys = summary.variables.flatMap((variable) => variable.factKeys);
            reason = summary.variables.map((variable) => (
              `${variable.name}：${variable.reason}`
            )).join("；");
            renderedContent = renderGroupSummaryTemplate(parsedTemplate, variableValues);
            assertNoPrivateContextDisclosure(renderedContent, { group, roles });
          } else if (task.taskType !== "conditional_push") {
            throw new Error("unsupported group automation task type");
          }

          const mentionResolution = db.resolveGroupAutomationMentionNames({
            botId: occurrence.botId,
            groupId: occurrence.groupId,
            roleIds: task.mentionRoleIds
          });
          const evidence = evidenceForFactKeys(factsByKey, referencedFactKeys);
          db.markGroupAutomationOccurrenceSending({
            botId: occurrence.botId,
            occurrenceId: occurrence.id,
            executionToken: occurrence.executionToken,
            renderedContent,
            mentionRoleIds: task.mentionRoleIds,
            mentionNames: mentionResolution.names,
            reason,
            conditionAchieved,
            variableValues,
            factIds: evidence.factIds,
            evidenceMessageIds: evidence.messageIds,
            warnings: mentionResolution.warnings
          });
          sendingStarted = true;
          const worktoolResponse = await sendText({
            robotId: occurrence.botId,
            targets: [group.currentName],
            content: renderedContent,
            atList: mentionResolution.names
          });
          assertWorktoolAccepted(worktoolResponse);
          const worktoolMessageId = extractWorktoolMessageId(worktoolResponse);
          db.insertConversationMessage({
            botId: occurrence.botId,
            conversationKey: group.conversationKey,
            direction: "outbound",
            senderName: binding.botName || binding.agentName || "机器人",
            content: renderedContent,
            rawPayload: {
              source: "group_automation",
              occurrenceId: occurrence.id,
              taskId: task.id,
              atList: mentionResolution.names,
              messageId: worktoolMessageId,
              worktoolResponse
            }
          });
          const completed = db.completeGroupAutomationOccurrence({
            botId: occurrence.botId,
            occurrenceId: occurrence.id,
            executionToken: occurrence.executionToken,
            status: "sent",
            conditionAchieved,
            reason,
            variableValues,
            factIds: evidence.factIds,
            evidenceMessageIds: evidence.messageIds,
            mentionRoleIds: task.mentionRoleIds,
            mentionNames: mentionResolution.names,
            renderedContent,
            worktoolMessageId,
            worktoolResponse
          });
          publish({
            botId: occurrence.botId,
            groupId: occurrence.groupId,
            taskId: task.id,
            occurrence: completed
          });
          results.push(completed);
        } catch (error) {
          if (sendingStarted) {
            const retrySafe = error.worktoolExplicitRejection === true
              || (Number(error.worktoolStatus) >= 400 && Number(error.worktoolStatus) < 500);
            if (retrySafe) {
              const terminal = occurrence.attempts >= OCCURRENCE_RETRY_DELAYS_MS.length;
              if (!terminal) {
                const delay = OCCURRENCE_RETRY_DELAYS_MS[Math.max(0, occurrence.attempts - 1)];
                const retry = db.scheduleGroupAutomationOccurrenceRetry({
                  botId: occurrence.botId,
                  occurrenceId: occurrence.id,
                  executionToken: occurrence.executionToken,
                  nextRetryAt: new Date(claimTime.getTime() + delay).toISOString(),
                  errorMessage: error.message
                });
                results.push(retry);
              } else {
                results.push(db.failGroupAutomationOccurrence({
                  botId: occurrence.botId,
                  occurrenceId: occurrence.id,
                  executionToken: occurrence.executionToken,
                  errorMessage: error.message
                }));
              }
              continue;
            }
            const unknown = db.completeGroupAutomationOccurrence({
              botId: occurrence.botId,
              occurrenceId: occurrence.id,
              executionToken: occurrence.executionToken,
              status: "delivery_unknown",
              errorMessage: error.message,
              reason: "发送请求结果不明确，已停止自动重试"
            });
            publish({
              botId: occurrence.botId,
              groupId: occurrence.groupId,
              taskId: occurrence.taskId,
              occurrence: unknown
            });
            results.push(unknown);
            continue;
          }
          const terminal = occurrence.attempts >= OCCURRENCE_RETRY_DELAYS_MS.length;
          if (!terminal && typeof db.scheduleGroupAutomationOccurrenceRetry === "function") {
            const delay = OCCURRENCE_RETRY_DELAYS_MS[Math.max(0, occurrence.attempts - 1)];
            const retry = db.scheduleGroupAutomationOccurrenceRetry({
              botId: occurrence.botId,
              occurrenceId: occurrence.id,
              executionToken: occurrence.executionToken,
              nextRetryAt: new Date(claimTime.getTime() + delay).toISOString(),
              errorMessage: error.message
            });
            results.push(retry);
          } else {
            results.push(db.failGroupAutomationOccurrence({
              botId: occurrence.botId,
              occurrenceId: occurrence.id,
              executionToken: occurrence.executionToken,
              errorMessage: error.message
            }));
          }
          logger.warn?.("group_automation.occurrence.failed", {
            botId: occurrence.botId,
            groupId: occurrence.groupId,
            occurrenceId: occurrence.id,
            attempt: occurrence.attempts,
            terminal,
            error: error.message
          });
        }
      }
      return results;
    } finally {
      occurrenceBusy = false;
    }
  }

  async function retryOccurrence({ botId, groupId = "", occurrenceId }) {
    if (typeof db.retryGroupAutomationOccurrence !== "function") {
      throw new Error("group automation occurrence retry is unavailable");
    }
    return db.retryGroupAutomationOccurrence({
      botId,
      groupId,
      occurrenceId,
      nextRetryAt: instantFrom(now).toISOString()
    });
  }

  async function recover() {
    const ledger = await runLedgerTick();
    const occurrences = await runOccurrenceTick();
    return { ledger, occurrences };
  }

  return {
    enqueueLive,
    enqueueReindex,
    runLedgerTick,
    runOccurrenceTick,
    retryOccurrence,
    recover,
    sendText,
    publish
  };
}

const PHASED_RETRY_DELAY_MS = 60_000;
const DEFAULT_TRANSCRIPT_MAX_CHARS = 8_000;
const DEFAULT_MERGE_BATCH_MAX_ITEMS = 8;

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
    db.transitionGroupAutomationOccurrence({
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
    occurrence.stage = "send_pending";
    if (typeof sendGroupMessage !== "function") return db.getGroupAutomationOccurrence({
      occurrenceId: occurrence.id
    });
    db.transitionGroupAutomationOccurrence({
      occurrenceId: occurrence.id,
      owner: occurrence.leaseOwner,
      fromStages: ["send_pending"],
      toStage: "sending",
      patch: { deliveryState: "sending" },
      now: instantFrom(now).toISOString()
    });
    occurrence.stage = "sending";
    const response = await sendGroupMessage({
      robotId: occurrence.botId,
      targets: [frozenPayload.targetGroupName],
      content: frozenPayload.content,
      atList: frozenPayload.atList,
      occurrenceId: occurrence.id
    });
    assertWorktoolAccepted(response);
    const completedAt = instantFrom(now);
    const completed = db.transitionGroupAutomationOccurrence({
      occurrenceId: occurrence.id,
      owner: occurrence.leaseOwner,
      fromStages: ["sending"],
      toStage: "sent",
      patch: {
        deliveryState: "sent",
        actualCompletedAt: completedAt.toISOString(),
        targetDelayMs: Math.max(0, completedAt.getTime() - new Date(occurrence.scheduledFor).getTime())
      },
      now: completedAt.toISOString()
    });
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
  return options.historySyncWorker
    ? createPhasedGroupAutomationWorker(options)
    : createLegacyGroupAutomationWorker(options);
}

function evidenceForFactKeys(factsByKey, factKeys) {
  const factIds = [];
  const messageIds = [];
  for (const key of [...new Set(factKeys || [])]) {
    const fact = factsByKey.get(key);
    if (!fact) continue;
    if (fact.id) factIds.push(fact.id);
    messageIds.push(...(fact.evidenceMessageIds || []));
  }
  return {
    factIds: [...new Set(factIds)],
    messageIds: [...new Set(messageIds.map(Number).filter(Number.isSafeInteger))]
  };
}

function assertNoPrivateContextDisclosure(content, { group = null, roles = [] } = {}) {
  const text = String(content || "");
  const marker = CUSTOMER_VISIBLE_DISCLOSURE_MARKERS.find((item) => text.includes(item));
  if (marker) throw new Error(`summary contains private context disclosure marker: ${marker}`);
  const disclosurePattern = CUSTOMER_VISIBLE_SOURCE_DISCLOSURE_PATTERNS.find((pattern) => (
    pattern.test(text)
  ));
  if (disclosurePattern) throw new Error("summary reveals a private context source");
  const privateTexts = [
    group?.background,
    ...(Array.isArray(roles) ? roles.map((role) => role.description) : [])
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const fragment = privateTexts
    .flatMap((value) => value.split(/[，。！？；,.!?;\n]/u))
    .map((value) => value.trim())
    .filter((value) => value.length >= 6)
    .find((value) => text.includes(value));
  if (fragment) throw new Error("summary repeats private context text");
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
