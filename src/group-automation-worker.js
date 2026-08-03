import {
  buildGroupLedgerAgentRequest,
  buildGroupOccurrenceAgentRequest,
  parseGroupOccurrenceAgentReply,
  parseGroupLedgerAgentReply
} from "./group-automation-agent.js";
import { groupAutomationCycleWindow } from "./group-automation-schedule.js";
import {
  isCumulativeSummaryVariable,
  parseGroupSummaryTemplate,
  renderGroupSummaryTemplate
} from "./group-summary-template.js";

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

export function createGroupAutomationWorker({
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
