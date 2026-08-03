import {
  buildGroupLedgerAgentRequest,
  parseGroupLedgerAgentReply
} from "./group-automation-agent.js";
import { groupAutomationCycleWindow } from "./group-automation-schedule.js";

const LEDGER_RETRY_DELAYS_MS = [60_000, 180_000, 600_000];

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
      return db.applyGroupLedgerEvaluation({
        jobId: job.id,
        botId: job.botId,
        groupId: job.groupId,
        throughMessageId: job.throughMessageId,
        facts: [],
        conditionStates: []
      });
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
    const request = buildGroupLedgerAgentRequest({
      binding,
      group,
      roles,
      tasks: analysisTasks,
      projection,
      messages
    });
    const rawReply = await invokeAgent({
      binding,
      request,
      priority: "background",
      key: group.conversationKey,
      purpose: "group-ledger"
    });
    const parsed = parseGroupLedgerAgentReply(agentText(rawReply), {
      allowedMessageIds: messages.map((message) => message.id),
      allowedTaskIds: analysisTasks
        .filter((task) => task.taskType === "conditional_push")
        .map((task) => task.id),
      allowedFactKeys: projection.facts.map((fact) => fact.semanticKey),
      allowedRoleIds: roles.map((role) => role.id)
    });
    return db.applyGroupLedgerEvaluation({
      jobId: job.id,
      botId: job.botId,
      groupId: job.groupId,
      throughMessageId: job.throughMessageId,
      facts: parsed.facts,
      conditionStates: parsed.conditionStates
    });
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

  async function runOccurrenceTick() {
    if (occurrenceBusy) return [];
    occurrenceBusy = true;
    try {
      return [];
    } finally {
      occurrenceBusy = false;
    }
  }

  async function retryOccurrence() {
    throw new Error("group automation occurrence retry is not implemented");
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
