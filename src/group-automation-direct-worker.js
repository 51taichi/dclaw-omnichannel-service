const DEFAULT_PREPARE_HORIZON_MS = 600_000;

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

function frozenMentionNames(occurrence) {
  const snapshot = occurrence?.taskSnapshot || {};
  const rolesById = new Map((Array.isArray(snapshot.roles) ? snapshot.roles : [])
    .map((role) => [String(role?.id || ""), role]));
  const names = [];
  const warnings = [];
  for (const rawRoleId of occurrence?.mentionRoleIds || snapshot.mentionRoleIds || []) {
    const roleId = String(rawRoleId || "").trim();
    const name = String(rolesById.get(roleId)?.currentName || "").trim();
    if (name) names.push(name);
    else warnings.push(`Mention role ${roleId} was unavailable in the frozen task snapshot`);
  }
  return { names: [...new Set(names)], warnings };
}

function log(logger, level, event, details = {}) {
  const fn = logger?.[level];
  if (typeof fn === "function") fn(event, details);
}

export function createDirectGroupAutomationWorker({
  db,
  getBinding,
  executeAgentTask,
  sendGroupMessage,
  now = () => new Date(),
  logger = console,
  leaseMs = 300_000,
  prepareHorizonMs = DEFAULT_PREPARE_HORIZON_MS,
  onOccurrenceChanged = null
} = {}) {
  if (!db || typeof db !== "object") throw new Error("group automation db is required");
  if (typeof getBinding !== "function") throw new Error("group automation binding resolver is required");
  if (typeof executeAgentTask !== "function") throw new Error("group automation Agent executor is required");
  if (typeof sendGroupMessage !== "function") throw new Error("group automation sender is required");

  function currentIso() {
    return instantFrom(now).toISOString();
  }

  function publish(occurrence) {
    if (occurrence && typeof onOccurrenceChanged === "function") {
      onOccurrenceChanged(occurrence);
    }
    return occurrence;
  }

  function loadExecutionContext(occurrence) {
    const currentGroup = db.getGroupById({
      botId: occurrence.botId,
      groupId: occurrence.groupId
    });
    if (!currentGroup) throw new Error("group automation group is unavailable");
    const conversation = db.getConversation(currentGroup.conversationKey);
    if (!conversation) throw new Error("group automation conversation is unavailable");
    const binding = getBinding(occurrence.botId);
    if (!binding?.enabled) throw new Error("group automation Agent binding is unavailable");
    const snapshot = occurrence.taskSnapshot || {};
    return {
      binding,
      conversation,
      task: snapshot,
      roles: Array.isArray(snapshot.roles) ? snapshot.roles : [],
      group: {
        ...(snapshot.group || {}),
        id: occurrence.groupId,
        currentName: snapshot.group?.currentName || currentGroup.currentName
      },
      deliveryGroupName: currentGroup.currentName
    };
  }

  async function withLeaseHeartbeat(occurrence, operation) {
    if (typeof db.heartbeatGroupAutomationOccurrence !== "function") {
      return operation();
    }
    const heartbeatEveryMs = Math.max(1000, Math.min(30_000, Math.floor(leaseMs / 3)));
    const timer = setInterval(() => {
      try {
        db.heartbeatGroupAutomationOccurrence({
          occurrenceId: occurrence.id,
          owner: occurrence.leaseOwner,
          now: currentIso(),
          leaseMs
        });
      } catch (error) {
        log(logger, "warn", "group_automation.heartbeat_failed", {
          occurrenceId: occurrence.id,
          error: String(error?.message || error)
        });
      }
    }, heartbeatEveryMs);
    timer.unref?.();
    try {
      return await operation();
    } finally {
      clearInterval(timer);
    }
  }

  async function deliverFrozenPayload(occurrence) {
    const frozenPayload = occurrence.frozenPayload || {};
    if (!String(frozenPayload.content || "").trim()) {
      throw new Error("frozen group automation payload is unavailable");
    }
    let current = occurrence;
    if (current.stage === "send_pending") {
      current = db.transitionGroupAutomationOccurrence({
        occurrenceId: current.id,
        owner: current.leaseOwner,
        fromStages: ["send_pending"],
        toStage: "sending",
        patch: { deliveryState: "sending" },
        now: currentIso()
      });
    }
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await sendGroupMessage({
          robotId: current.botId,
          targets: [frozenPayload.targetGroupName],
          content: frozenPayload.content,
          atList: frozenPayload.atList || [],
          occurrenceId: current.id
        });
        assertWorktoolAccepted(response);
        return publish(db.transitionGroupAutomationOccurrence({
          occurrenceId: current.id,
          owner: current.leaseOwner,
          fromStages: ["sending"],
          toStage: "awaiting_confirmation",
          patch: {
            deliveryState: "awaiting_confirmation",
            worktoolMessageId: extractWorktoolMessageId(response),
            worktoolResponse: response,
            retryMetadata: {
              ...(current.retryMetadata || {}),
              sendAttempts: attempt
            }
          },
          now: currentIso()
        }));
      } catch (error) {
        if (error?.worktoolExplicitRejection === true) {
          if (attempt < 3) continue;
          return publish(db.transitionGroupAutomationOccurrence({
            occurrenceId: current.id,
            owner: current.leaseOwner,
            fromStages: ["sending"],
            toStage: "failed",
            patch: {
              deliveryState: "rejected",
              errorMessage: String(error?.message || error),
              retryMetadata: {
                ...(current.retryMetadata || {}),
                sendAttempts: attempt
              }
            },
            now: currentIso()
          }));
        }
        if (typeof db.markGroupAutomationSendUnknown === "function") {
          return publish(db.markGroupAutomationSendUnknown({
            occurrenceId: current.id,
            owner: current.leaseOwner,
            transportReference: String(error?.transportReference || ""),
            error: String(error?.message || error),
            now: currentIso()
          }));
        }
        return publish(db.transitionGroupAutomationOccurrence({
          occurrenceId: current.id,
          owner: current.leaseOwner,
          fromStages: ["sending"],
          toStage: "delivery_unknown",
          patch: {
            deliveryState: "unknown",
            errorMessage: String(error?.message || error)
          },
          now: currentIso()
        }));
      }
    }
    throw new Error("unreachable group automation delivery state");
  }

  async function evaluateAndDeliver(occurrence) {
    const context = loadExecutionContext(occurrence);
    const result = await withLeaseHeartbeat(occurrence, () => executeAgentTask({
      binding: context.binding,
      conversation: context.conversation,
      group: context.group,
      roles: context.roles,
      task: context.task,
      occurrence
    }));
    if (result?.taskType !== context.task.taskType) {
      throw new Error("group automation Agent result task type does not match occurrence");
    }
    const evidence = db.validateGroupAutomationEvidenceMessageIds({
      botId: occurrence.botId,
      groupId: occurrence.groupId,
      messageIds: result.evidenceMessageIds
    });
    if (evidence.invalidIds.length) {
      throw new Error(
        `group automation evidence does not belong to this group: ${evidence.invalidIds.join(",")}`
      );
    }
    if (context.task.taskType === "conditional_push" && result.achieved !== true) {
      return publish(db.transitionGroupAutomationOccurrence({
        occurrenceId: occurrence.id,
        owner: occurrence.leaseOwner,
        fromStages: ["evaluating"],
        toStage: "skipped",
        patch: {
          conditionAchieved: false,
          decisionNote: result.decisionNote,
          evidenceMessageIds: evidence.validIds,
          deliveryState: "not_required"
        },
        now: currentIso()
      }));
    }
    const content = context.task.taskType === "conditional_push"
      ? String(context.task.content || "").trim()
      : String(result.content || "").trim();
    if (!content) throw new Error("group automation rendered content is unavailable");
    const mentions = frozenMentionNames(occurrence);
    const targetDelayMs = Math.max(
      0,
      instantFrom(now).getTime() - new Date(occurrence.scheduledFor).getTime()
    );
    const frozenPayload = {
      targetGroupName: context.deliveryGroupName,
      content,
      atList: mentions.names,
      taskType: context.task.taskType,
      scheduledFor: occurrence.scheduledFor
    };
    const pending = db.transitionGroupAutomationOccurrence({
      occurrenceId: occurrence.id,
      owner: occurrence.leaseOwner,
      fromStages: ["evaluating"],
      toStage: "send_pending",
      patch: {
        conditionAchieved: context.task.taskType === "conditional_push" ? true : null,
        decisionNote: result.decisionNote,
        evidenceMessageIds: evidence.validIds,
        renderedContent: content,
        mentionNames: mentions.names,
        warnings: mentions.warnings,
        frozenPayload,
        deliveryState: "pending",
        targetDelayMs
      },
      now: currentIso()
    });
    return deliverFrozenPayload(pending);
  }

  async function processOccurrence({ occurrenceId, owner }) {
    const occurrence = db.getGroupAutomationOccurrence({ occurrenceId });
    if (!occurrence) throw new Error("group automation occurrence not found");
    if (occurrence.leaseOwner !== owner) {
      throw new Error("group automation occurrence lease is not owned");
    }
    try {
      if (occurrence.stage === "send_pending") return await deliverFrozenPayload(occurrence);
      if (occurrence.stage === "evaluating") return await evaluateAndDeliver(occurrence);
      return occurrence;
    } catch (error) {
      const current = db.getGroupAutomationOccurrence({ occurrenceId }) || occurrence;
      if (current.stage === "evaluating" && current.leaseOwner === owner) {
        log(logger, "error", "group_automation.execution_failed", {
          botId: current.botId,
          groupId: current.groupId,
          occurrenceId: current.id,
          error: String(error?.message || error)
        });
        return publish(db.transitionGroupAutomationOccurrence({
          occurrenceId: current.id,
          owner,
          fromStages: ["evaluating"],
          toStage: "failed",
          patch: {
            errorMessage: String(error?.message || error),
            deliveryState: "not_sent"
          },
          now: currentIso()
        }));
      }
      throw error;
    }
  }

  async function runOccurrenceTick({ owner, limit = 10 } = {}) {
    const normalizedOwner = String(owner || "").trim();
    if (!normalizedOwner) throw new Error("group automation occurrence owner is required");
    db.prepareGroupAutomationOccurrences({
      now: currentIso(),
      horizonMs: prepareHorizonMs,
      limit
    });
    const occurrences = db.claimDueGroupAutomationOccurrences({
      owner: normalizedOwner,
      now: currentIso(),
      leaseMs,
      limit
    });
    const results = [];
    for (const occurrence of occurrences) {
      results.push(await processOccurrence({
        occurrenceId: occurrence.id,
        owner: normalizedOwner
      }));
    }
    return results;
  }

  async function recoverExpiredLeases({ owner, limit = 10 } = {}) {
    db.recoverLegacyGroupAutomationOccurrences?.({ now: currentIso() });
    return runOccurrenceTick({ owner, limit });
  }

  return {
    recoverExpiredLeases,
    runOccurrenceTick,
    processOccurrence,
    sendGroupMessage
  };
}
