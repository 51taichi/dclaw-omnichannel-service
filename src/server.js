import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeInlineActions } from "./action-chips.js";
import { activationDelayMs } from "./activation-timing.js";
import { loadBotBindingsFromConfig } from "./config.js";
import { runConversationResetRequests } from "./conversation-reset.js";
import { createConversationResetWorker } from "./conversation-reset-worker.js";
import {
  buildGroupAgentTurns,
  formatGroupAgentTurns
} from "./group-agent-turns.js";
import {
  buildDclawActivationRequest,
  buildDclawAttachmentSourceRetryRequest,
  buildDclawConversationMemoryClearRequest,
  buildDclawConversationResetRequest,
  buildDclawHandoffTranscriptRequest,
  buildDclawLegacyHistoryAnalysisRequest,
  buildDclawProactiveEventRequest,
  buildDclawRequest,
  buildDclawTagActivationRequest,
  getDclawAgentMaxAttempts,
  getDclawFormatRetryTimeoutMs,
  getDclawAgentTimeoutMs,
  getAgentReplySendabilityIssue,
  invokeDclawAgent,
  invokeDclawAgentWithRetry
} from "./dclaw.js";
import {
  sendabilityIssueToValidationError,
  validateAgentResponseText,
  validateAndRetryAgentResponse
} from "./agent-response-gateway.js";
import { buildAgentResponseValidationOptions } from "./agent-response-validation-options.js";
import { createAgentInvocationQueue } from "./agent-invocation-queue.js";
import { createCockpitEventRecorder } from "./cockpit-events.js";
import { cockpitPeriodCandidates, periodBounds } from "./cockpit-domain.js";
import {
  COCKPIT_STATISTICS_VERSION,
  createCockpitAggregator
} from "./cockpit-aggregator.js";
import { createCockpitReportGenerator } from "./cockpit-report-generator.js";
import { createCockpitDeliveryService } from "./cockpit-delivery.js";
import { createCockpitWorker } from "./cockpit-worker.js";
import { createCockpitBootstrap } from "./cockpit-bootstrap.js";
import { logError, logInfo, logWarn } from "./logger.js";
import {
  createBotSession,
  deleteBotSession,
  deleteBotSessionsForBot,
  getBotSession,
  publicBotView,
  verifyAccessKey
} from "./auth.js";
import {
  changeAdminPassword,
  createAdminSession,
  deleteAdminSession,
  getAdminSession,
  initializeAdminAuth,
  verifyAdminPassword
} from "./admin-auth.js";
import {
  createWorkspace,
  createWorkspaceSessionForAdmin,
  getWorkspaceChallenge,
  logoutWorkspace,
  publicWorkspaceView,
  removeWorkspace,
  resolveWorkspaceSession,
  unlockWorkspace,
  updateWorkspace
} from "./workspaces.js";
import {
  beginMessageProcessing,
  beginFriendAddedFlowEntry,
  buildMessageKey,
  cancelFlowActivationTasks,
  cancelTagActivationTasks,
  claimDueFlowActivationTasks,
  claimDueTagActivationTasks,
  claimDueGroupAutomationOccurrences,
  claimNextProactiveTarget,
  cancelProactiveTask,
  clearConversationForReset,
  claimNextConversationResetTask,
  completeConversationResetTask,
  createOrGetGroup,
  createGroupAutomationTask,
  createLegacyFlowSession,
  createProactiveTask,
  createCockpitJob,
  createCockpitDelivery,
  createCockpitReport,
  createCockpitReportRevision,
  deleteAgent,
  deleteBotData,
  finishAgentInvocation,
  finishMessageProcessing,
  getAgent,
  getBotBinding,
  getConversation,
  getCockpitConfig,
  getCockpitDailyCounters,
  getCockpitBaselineCharts,
  getCockpitReport,
  getCockpitAggregationCursor,
  getCockpitAggregationState,
  getLatestCockpitSnapshot,
  getConversationKey,
  getConversationResetPending,
  getConversationAssets,
  getActiveTagSyncRun,
  getSubmittedTagSyncCommand,
  getTagSyncConfig,
  getTagSyncStatus,
  backfillManagedGroupConversationDateTags,
  ensureLegacyHistoryDateTag,
  ensureManagedGroupConversationDateTag,
  getFlowMachineForBot,
  getFlowActivationProgress,
  getFlowSession,
  getFlowSessionForBot,
  getGroupByConversationKey,
  getGroupById,
  getGroupAutomationTask,
  getGroupAutomationOccurrence,
  hasCachedWorktoolMessageId,
  hasRecentBotMessageProcessing,
  ensureConversationDateTag,
  ensureCockpitDefinitionVersion,
  initializeLegacyDateTagRuleEffectiveTimes,
  isCockpitStageCompleted,
  isFlowActivationTaskProcessing,
  getOrCreateConversationSession,
  getOrCreateFlowSession,
  getSetting,
  getProactiveTask,
  failConversationResetTask,
  incrementFlowActivationGeneration,
  incrementCockpitDailyCounter,
  insertAgentInvocationStart,
  insertAgentResponseValidationFailure,
  insertAgentTagEvaluations,
  updateAgentResponseValidationRetryOutcome,
  insertConversationMessage as insertConversationMessageDb,
  insertImportedConversationMessages,
  insertCommandCallback,
  insertIncomingMessage,
  appendCockpitEvent,
  backfillCockpitEventsFromBusiness,
  insertOutgoingMessage,
  insertMockProactiveTargets,
  resetBotFlowStateForAgentRebind,
  resetConversationForFriendGreeting,
  applyAgentTagOutcome,
  applyConversationTagChanges,
  getAgentTagSchema,
  listConversationMessages,
  listCockpitReports,
  listCockpitEvents,
  listConversationMessagesAround,
  listConversationTags,
  listGroupRoles,
  listGroupAutomationTasks,
  listGroupAutomationOccurrences,
  listGroupsPage,
  listUnreadTagAlerts,
  listCachedApiMessages,
  listFlowMachines,
  listFlowSessionsPage,
  listFlowStateEvents,
  listImportedConversationMessages,
  listLegacyFlowSessionTargets,
  listTagActivationTasks,
  listProactiveAddressBookTargetsPage,
  listProactiveTargetTags,
  listProactiveTasksPage,
  listProactiveTaskTargets,
  listAgents,
  listBotBindings,
  listRunnableTagSyncConfigs,
  listUnassignedBotBindings,
  listWorkspaceBots,
  listWorkspaces,
  mergeGroupAlias,
  finalizeFlowActivationTaskDelivery,
  listRecords,
  markFlowActionExecutionFailed,
  markFlowActionExecutionSucceeded,
  markFlowActivationTaskFailed,
  markTagActivationTaskFailed,
  markTagActivationTaskSent,
  markTagSyncCommandSubmitted,
  markTagSyncCommandSubmitFailed,
  markConversationFriendAddedSignal,
  markCockpitStageCompleted,
  markConversationResetHandledForEpoch,
  markLegacyHistoryContextSent,
  markTagAlertRead,
  markProactiveTargetFailed,
  markProactiveTargetAgentSync,
  markProactiveTargetSent,
  mergeFlowSessionData,
  migrateLegacyHistoryOutboundSenderNames,
  migrateTagSyncNightlyDefaultEnabled,
  normalizeActivationConfig,
  prepareConversationResetForNewActivity,
  resetInterruptedProactiveTargets,
  recoverExpiredTagSyncLeases,
  reserveFlowActionExecution,
  reserveTagActivationTaskForSend,
  resolveConversationMessageEvidence,
  scheduleFlowActivationTask,
  scheduleTagActivationTask,
  saveGroupConfig,
  saveGroupRoles,
  prepareGroupAutomationOccurrences,
  recoverLegacyGroupAutomationOccurrences,
  validateGroupAutomationEvidenceMessageIds,
  finalizeObsoleteGroupHistoryRemoval,
  disableLegacyConditionalTasksWithoutCondition,
  heartbeatGroupAutomationOccurrence,
  transitionGroupAutomationOccurrence,
  resolveGroupAutomationMentionNames,
  markGroupAutomationSendUnknown,
  confirmGroupAutomationDelivery,
  prepareManualGroupAutomationRetry,
  updateGroupAutomationTask,
  duplicateGroupAutomationTask,
  softDeleteGroupAutomationTask,
  saveTagSyncConfig,
  setSetting,
  setBotAccessKey,
  touchFlowSession,
  updateFlowSessionHandoff,
  updateFlowSessionNode,
  updateLegacyHistorySync,
  updateTagSyncRunStatus,
  updateProactiveTargetFromCommandCallback,
  updateOutgoingMessageFromCommandCallback,
  updateGroupAutomationOccurrenceFromCommandCallback,
  upsertAgent,
  upsertAgentTagSchema,
  upsertFlowMachine,
  upsertProactiveAddressBookTarget,
  upsertBotBinding,
  upsertConversation,
  upsertCockpitConfig,
  saveCockpitAggregationCursor,
  saveCockpitAggregationState,
  saveCockpitSnapshot,
  claimDueCockpitDeliveries,
  finishCockpitDelivery,
  upsertWorktoolApiMessageCache
} from "./db.js";
import { createGroupAutomationWorker } from "./group-automation-worker.js";
import {
  nextGroupAutomationRunAt,
  normalizeGroupAutomationSchedule
} from "./group-automation-schedule.js";
import {
  executeGroupAutomationAgentTask
} from "./group-automation-agent.js";
import { parseGroupSummaryTemplate } from "./group-summary-template.js";
import { createGroupAutomationStreamHub } from "./group-automation-stream.js";
import {
  claimNextTagSyncBatch,
  ensureTagSyncInitialBackfill,
  finishTagSyncRunIfDrained,
  resolveTagSyncCommandCallback,
  startTagSyncRun
} from "./db.js";
import {
  buildGroupAgentContext,
  buildGroupTagContext,
  resolveGroupReplyDecision
} from "./groups.js";
import {
  assignBotsToWorkspace,
  getWorkspaceById,
  transferBotToWorkspace,
  unassignBotFromWorkspace
} from "./db.js";
import {
  buildRawMediaCommand,
  bindCommandCallback,
  bindMessageCallback,
  createExternalGroup,
  getCallbackConfig,
  getRobotInfo,
  listWorkToolGroups,
  sendGroupInviteCommand,
  sendRawCommand,
  sendMediaMessage,
  syncFriendTags,
  sendTextMessage,
  unbindCommandCallback,
  unbindMessageCallback
} from "./worktool.js";
import {
  shouldProcessInboundForAgent
} from "./message-rules.js";
import { inboundAttachmentPlaceholder } from "./inbound-attachments.js";
import {
  DEFAULT_FRIEND_ADDED_SIGNAL_DEDUPE_MS,
  isFriendAddedSignalDuplicate,
  resolveFriendAddedSignal
} from "./friend-added-signals.js";
import { normalizeUploadedFilename } from "./filenames.js";
import { createInboundMessageCoalescer } from "./inbound-coalescer.js";
import { createTagAlertStreamHub } from "./tag-alert-stream.js";
import { normalizeHistoryAnalysisConfig } from "./history-analysis.js";
import { createLegacyCustomerHistoryService } from "./legacy-customer-history.js";
import { createKeyedSingleFlight, isLegacyCustomerCandidate } from "./legacy-history.js";
import { listApiCommandPage, listCustomerHistory } from "./worktool-history.js";
import { createWorktoolHistoryCache } from "./worktool-history-cache.js";
import { filterConfiguredCollectedDataPatch } from "./flow-assets.js";
import { getTagSyncWindowState } from "./tag-sync.js";
import { createTagSyncWorker } from "./tag-sync-worker.js";
import {
  adjudicateTagDecision,
  compactTagRulesForAgent,
  normalizeTagSchema
} from "./tags.js";

const cockpitEventRecorder = createCockpitEventRecorder({
  appendEvent: appendCockpitEvent,
  incrementCounter: incrementCockpitDailyCounter,
  logWarn
});

const app = express();
const tagAlertStreamHub = createTagAlertStreamHub();
const groupAutomationStreamHub = createGroupAutomationStreamHub();
const port = Number(process.env.PORT || 8765);
const host = process.env.HOST || "0.0.0.0";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");
const consoleIndexPath = path.join(publicDir, "console", "index.html");
const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR || "data");
const uploadDir = path.join(dataDir, "uploads");
const uploadMaxMb = Number(process.env.UPLOAD_MAX_MB || 100);
const uploadAllowedOrigins = String(process.env.UPLOAD_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const DEFAULT_AGENT_FAILURE_FALLBACK_REPLY = "刚刚这边有点忙，我稍后回复你哈";
const agentFailureFallbackReply =
  process.env.AGENT_FAILURE_FALLBACK_REPLY || DEFAULT_AGENT_FAILURE_FALLBACK_REPLY;
const uploadRetentionMs = Number(process.env.UPLOAD_RETENTION_HOURS || 24) * 60 * 60 * 1000;
const uploadCleanupIntervalMs =
  Number(process.env.UPLOAD_CLEANUP_INTERVAL_MINUTES || 60) * 60 * 1000;
const worktoolHistoryCacheIntervalMs =
  Number(process.env.WORKTOOL_HISTORY_CACHE_INTERVAL_MINUTES || 10) * 60 * 1000;
const TAG_SYNC_WORKER_INTERVAL_MS = Math.max(
  500,
  Number(process.env.TAG_SYNC_WORKER_INTERVAL_MS || 2000)
);
const TAG_SYNC_WORKER_LEASE_MS = Math.max(
  30_000,
  Number(process.env.TAG_SYNC_WORKER_LEASE_MS || 120_000)
);
const TAG_SYNC_REALTIME_ACTIVITY_TTL_MS = Math.max(
  60_000,
  Number(process.env.TAG_SYNC_REALTIME_ACTIVITY_TTL_MS || 15 * 60 * 1000)
);
fs.mkdirSync(uploadDir, { recursive: true });

function getUploadFolderName(botId) {
  return crypto.createHash("sha256").update(String(botId)).digest("hex");
}

function getBotUploadDir(botId) {
  return path.join(uploadDir, getUploadFolderName(botId));
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const destination = getBotUploadDir(req.uploadBotId);
      fs.mkdir(destination, { recursive: true }, (error) => cb(error, destination));
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "");
      cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
    }
  }),
  limits: {
    fileSize: uploadMaxMb * 1024 * 1024
  }
});

app.use(express.json({ limit: "2mb" }));
app.get("/console", (req, res) => res.redirect(302, "/admin/"));
app.get("/console/", (req, res) => res.redirect(302, "/admin/"));
app.get(/^\/console\/[^/]+\/$/, (req, res) => res.redirect(302, req.path.slice(0, -1)));
app.use("/shared", express.static(path.join(publicDir, "shared")));
app.use("/admin", express.static(path.join(publicDir, "admin")));
app.get("/console/:slug", (req, res, next) => {
  if (!/^[a-z0-9-]{3,32}$/.test(req.params.slug)) {
    next();
    return;
  }
  res.type("html").send(fs.readFileSync(consoleIndexPath, "utf8"));
});
app.use("/console", express.static(path.join(publicDir, "console")));
app.use("/uploads", express.static(uploadDir));

async function cleanupUploadCache() {
  if (!Number.isFinite(uploadRetentionMs) || uploadRetentionMs <= 0) return;
  const cutoff = Date.now() - uploadRetentionMs;
  let removed = 0;
  async function cleanDirectory(directory) {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await cleanDirectory(filePath);
        const remaining = await fs.promises.readdir(filePath);
        if (!remaining.length) await fs.promises.rmdir(filePath);
        return;
      }
      if (!entry.isFile()) return;
      const stat = await fs.promises.stat(filePath);
      if (stat.mtimeMs >= cutoff) return;
      await fs.promises.unlink(filePath);
      removed += 1;
    }));
  }
  await cleanDirectory(uploadDir);
  if (removed > 0) {
    logInfo("uploads.cleanup", {
      removed,
      retentionHours: uploadRetentionMs / 60 / 60 / 1000
    });
  }
}

cleanupUploadCache().catch((error) => {
  logWarn("uploads.cleanup_failed", { error: error.message });
});
setInterval(() => {
  cleanupUploadCache().catch((error) => {
    logWarn("uploads.cleanup_failed", { error: error.message });
  });
}, uploadCleanupIntervalMs).unref();

await loadBotBindingsFromConfig();
const adminAuthState = initializeAdminAuth({
  bootstrapPassword: process.env.ADMIN_API_KEY
});
if (!adminAuthState.ready) {
  logWarn("admin_auth.not_ready", { reason: adminAuthState.reason });
}
resetInterruptedProactiveTargets();
const migratedLegacyHistorySenderCount = migrateLegacyHistoryOutboundSenderNames();
logInfo("legacy_history.outbound_senders_migrated", {
  messageCount: migratedLegacyHistorySenderCount
});
const migratedTagSyncConfigCount = migrateTagSyncNightlyDefaultEnabled();
logInfo("tag_sync.default_enabled_migrated", {
  configCount: migratedTagSyncConfigCount
});

const tagSyncWorker = createTagSyncWorker({
  getConfig: getTagSyncConfig,
  listConfigs: listRunnableTagSyncConfigs,
  getActiveRun: getActiveTagSyncRun,
  startRun: startTagSyncRun,
  setRunStatus: updateTagSyncRunStatus,
  hasRealtimeActivity(botId) {
    return hasRecentBotMessageProcessing({
      botId,
      sinceIso: new Date(Date.now() - TAG_SYNC_REALTIME_ACTIVITY_TTL_MS).toISOString()
    });
  },
  claimBatch: claimNextTagSyncBatch,
  markSubmitted: markTagSyncCommandSubmitted,
  markSubmitFailed: markTagSyncCommandSubmitFailed,
  getSubmittedCommand: getSubmittedTagSyncCommand,
  resolveCallback: resolveTagSyncCommandCallback,
  finishRunIfDrained: finishTagSyncRunIfDrained,
  recoverLeases: recoverExpiredTagSyncLeases,
  sendTags: syncFriendTags,
  getWindowState: getTagSyncWindowState,
  leaseMs: TAG_SYNC_WORKER_LEASE_MS,
  log(event, fields) {
    if (event.endsWith("failed")) logWarn(event, fields);
    else logInfo(event, fields);
  }
});

const recoveredTagSyncLeaseCount = tagSyncWorker.recover(new Date());
logInfo("tag_sync.leases.recovered", { count: recoveredTagSyncLeaseCount });
setInterval(() => {
  void tagSyncWorker.tick(new Date()).catch((error) => {
    logWarn("tag_sync.worker.failed", { error });
  });
}, TAG_SYNC_WORKER_INTERVAL_MS).unref();

const legacyCustomerHistory = createLegacyCustomerHistoryService({
  listCustomerHistory,
  createLegacyFlowSession,
  updateLegacyHistorySync,
  insertImportedConversationMessages,
  listImportedConversationMessages,
  listCachedApiMessages,
  listLegacyFlowSessionTargets,
  resolveBotSenderName(botId) {
    const binding = getBotBinding(botId);
    return binding?.botName || binding?.agentName || "机器人";
  },
  onEvent(event, fields) {
    if (event === "failed") {
      logWarn("legacy_history.failed", fields);
      return;
    }
    logInfo(`legacy_history.${event}`, fields);
  }
});

const worktoolHistoryCache = createWorktoolHistoryCache({
  listPage: listApiCommandPage,
  upsertItems: upsertWorktoolApiMessageCache,
  hasMessageId: hasCachedWorktoolMessageId,
  async onRefreshed({ robotId }) {
    const backfill = await legacyCustomerHistory.backfillCachedHistoryForBot({ botId: robotId });
    logInfo("worktool_history_cache.backfilled", { botId: robotId, ...backfill });
  }
});

async function refreshWorktoolHistoryCaches() {
  for (const binding of listBotBindings().filter((item) => item.enabled)) {
    try {
      const result = await worktoolHistoryCache.refreshBot({ robotId: binding.botId });
      logInfo("worktool_history_cache.refreshed", { botId: binding.botId, ...result });
    } catch (error) {
      logWarn("worktool_history_cache.failed", {
        botId: binding.botId,
        error: error.message
      });
    }
  }
}

void refreshWorktoolHistoryCaches();
if (Number.isFinite(worktoolHistoryCacheIntervalMs) && worktoolHistoryCacheIntervalMs > 0) {
  setInterval(() => {
    void refreshWorktoolHistoryCaches();
  }, worktoolHistoryCacheIntervalMs).unref();
}

function assertCallbackSecret(req) {
  const expected = process.env.CALLBACK_SECRET;
  if (!expected) {
    const error = new Error("callback secret is not configured");
    error.status = 503;
    throw error;
  }
  if (req.query.secret !== expected) {
    const error = new Error("invalid callback secret");
    error.status = 401;
    throw error;
  }
}

function assertAdmin(req) {
  if (!adminAuthState.ready) {
    const error = new Error("admin API key is not configured");
    error.status = 503;
    throw error;
  }
  if (!verifyAdminPassword(getRequestAdminKey(req))) {
    const error = new Error("invalid admin api key");
    error.status = 401;
    throw error;
  }
}

function getRequestAdminKey(req) {
  return req.header("x-api-key") || req.header("authorization")?.replace(/^Bearer\s+/i, "");
}

function isAdminKey(req) {
  return verifyAdminPassword(getRequestAdminKey(req));
}

function getRequestAdminSession(req) {
  return getAdminSession(req.header("x-admin-session-token"));
}

function getRequestBotSession(req) {
  const token = req.header("x-bot-session-token");
  return getBotSession(token);
}

function assertAdminAccess(req) {
  if (isAdminKey(req)) return { role: "admin", botId: "*" };
  const adminSession = getRequestAdminSession(req);
  if (adminSession) return adminSession;
  const session = getRequestBotSession(req);
  if (session?.role === "admin") return session;
  const error = new Error("admin access required");
  error.status = 401;
  throw error;
}

function assertBotAccess(req, botId) {
  const expectedBotId = String(botId || "").trim();
  if (!expectedBotId) {
    const error = new Error("botId is required");
    error.status = 400;
    throw error;
  }
  if (isAdminKey(req)) return { role: "admin", botId: expectedBotId };
  const session = getRequestBotSession(req);
  if (session && session.botId === expectedBotId) return session;
  const error = new Error("bot access required");
  error.status = 401;
  throw error;
}

function assertAdminForBot(req, botId) {
  const expectedBotId = String(botId || "").trim();
  if (!expectedBotId) {
    const error = new Error("botId is required");
    error.status = 400;
    throw error;
  }
  if (isAdminKey(req)) return { role: "admin", botId: expectedBotId };
  const adminSession = getRequestAdminSession(req);
  if (adminSession) return { ...adminSession, botId: expectedBotId };
  const session = getRequestBotSession(req);
  if (session?.role === "admin" && session.botId === expectedBotId) return session;
  const error = new Error("admin access required");
  error.status = 401;
  throw error;
}

function getRequestWorkspaceToken(req) {
  return req.header("x-workspace-session-token") || "";
}

function assertWorkspaceAccess(req, slug) {
  const session = resolveWorkspaceSession(getRequestWorkspaceToken(req));
  if (!session || session.workspace.slug !== String(slug || "")) {
    const error = new Error("workspace access required");
    error.status = 401;
    throw error;
  }
  return session;
}

function assertConsoleAccess(req) {
  if (isAdminKey(req)) return { role: "admin", botId: "*" };
  const session = getRequestBotSession(req);
  if (session) return session;
  const error = new Error("console access required");
  error.status = 401;
  throw error;
}

function applyUploadCors(req, res, next) {
  const origin = req.header("origin");
  const allowAnyOrigin = uploadAllowedOrigins.includes("*");
  const isAllowedOrigin = origin && (allowAnyOrigin || uploadAllowedOrigins.includes(origin));

  if (isAllowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowAnyOrigin ? "*" : origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "x-api-key, x-admin-session-token, x-workspace-session-token, x-bot-session-token, authorization, content-type"
    );
    res.setHeader("Access-Control-Max-Age", "86400");
  }

  if (req.method === "OPTIONS") {
    res.status(isAllowedOrigin ? 204 : 403).end();
    return;
  }

  next();
}

function buildPublicCallbackUrl(botId, pathname) {
  const baseUrl = process.env.PUBLIC_BASE_URL;
  if (!baseUrl) {
    throw new Error("PUBLIC_BASE_URL is required for callback binding");
  }
  const fullPath = `/worktool/${encodeURIComponent(botId)}${pathname}`;
  const url = new URL(fullPath, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (process.env.CALLBACK_SECRET) {
    url.searchParams.set("secret", process.env.CALLBACK_SECRET);
  }
  return url.toString();
}

async function bindBotCallbacks(botId, { replyAll = 1 } = {}) {
  const messageCallbackUrl = buildPublicCallbackUrl(botId, "/message-callback");
  const commandCallbackUrl = buildPublicCallbackUrl(botId, "/command-callback");
  const messageResult = await bindMessageCallback({
    robotId: botId,
    callbackUrl: messageCallbackUrl,
    replyAll
  });
  const commandResult = await bindCommandCallback({
    robotId: botId,
    callBackUrl: commandCallbackUrl
  });

  return {
    ok: true,
    messageCallbackUrl,
    commandCallbackUrl,
    messageResult,
    commandResult
  };
}

async function unbindBotCallbacks(botId) {
  const [messageResult, commandResult] = await Promise.all([
    unbindMessageCallback({ robotId: botId }),
    unbindCommandCallback({ robotId: botId })
  ]);

  return {
    ok: true,
    messageResult,
    commandResult
  };
}

function buildPublicFileUrl(botId, filename) {
  const baseUrl = process.env.PUBLIC_BASE_URL;
  if (!baseUrl) {
    throw new Error("PUBLIC_BASE_URL is required for uploaded file URLs");
  }
  const url = new URL(
    `/uploads/${encodeURIComponent(getUploadFolderName(botId))}/${encodeURIComponent(filename)}`,
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  );
  return url.toString();
}

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

function getReplyTarget(message) {
  if (isGroupMessage(message) && message.groupName) {
    return message.groupName;
  }
  return message.receivedName;
}

function isGroupMessage(message) {
  const roomType = Number(message.roomType);
  return roomType === 1 || roomType === 3;
}

function isPrivateMessage(message) {
  const roomType = Number(message.roomType);
  return roomType === 2 || roomType === 4;
}

function shouldRecordConversationHistory(message) {
  return isPrivateMessage(message) || isGroupMessage(message);
}

function recordSystemFriendGreeting({ botId, binding, conversationKey, message }) {
  const conversation = upsertConversation({
    botId,
    agentId: binding?.agentId || "",
    conversationKey,
    message
  });
  insertConversationMessage({
    botId,
    conversationKey,
    direction: "inbound",
    senderName: message.receivedName || "",
    content: message.spoken || message.rawSpoken || "",
    rawPayload: {
      ...message,
      systemMessageType: "friend_greeting"
    }
  });
  return conversation;
}

function existingFriendAddedInCooldown({ botId, conversationKey, occurredAt }) {
  if (friendAddedReentryCooldownMs <= 0) return false;
  const session = getFlowSessionForBot({ botId, conversationKey });
  const lastFriendAddedAtMs = Date.parse(session?.lastFriendAddedAt || "");
  const occurredAtMs = Date.parse(occurredAt || "");
  return (
    Number.isFinite(lastFriendAddedAtMs) &&
    Number.isFinite(occurredAtMs) &&
    occurredAtMs - lastFriendAddedAtMs >= 0 &&
    occurredAtMs - lastFriendAddedAtMs < friendAddedReentryCooldownMs
  );
}

function isPrivateConversationKey(conversationKey) {
  return String(conversationKey || "").includes(":private:");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function activationDueAtForAttempt(anchorAt, intervalMinutes, attemptNumber) {
  return new Date(
    new Date(anchorAt).getTime() + activationDelayMs(intervalMinutes, attemptNumber)
  ).toISOString();
}

function activationMessageForAttempt(task) {
  if (!task?.messages?.length) return "";
  const index = Math.min(task.attemptNumber - 1, task.messages.length - 1);
  return task.messages[Math.max(0, index)] || "";
}

function privateTargetNameFromConversationKey(conversationKey) {
  return String(conversationKey || "").split(":private:")[1] || "";
}

function manualReplyTargetForConversation({ botId, conversationKey }) {
  const managedGroup = getGroupByConversationKey({ botId, conversationKey });
  return String(
    managedGroup?.currentName
    || privateTargetNameFromConversationKey(conversationKey)
    || ""
  ).trim();
}

function isConversationEpochCurrent({ botId, conversationKey, expectedEpoch }) {
  const current = getConversation(conversationKey);
  return Boolean(
    current &&
    current.botId === botId &&
    expectedEpoch &&
    current.conversationEpoch === expectedEpoch
  );
}

function invalidateFlowActivation({ conversationKey, reason }) {
  const session = incrementFlowActivationGeneration({ conversationKey, reason });
  cancelFlowActivationTasks({ conversationKey, reason });
  return session;
}

function assertConversationAiControlled({ botId, conversationKey }) {
  const session = getFlowSessionForBot({ botId, conversationKey });
  if (session?.handoffStatus !== "human") return;
  const error = new Error("human_handoff_before_send");
  error.code = "HUMAN_HANDOFF_BEFORE_SEND";
  throw error;
}

function applySystemDateTag({ botId, binding, conversationKey, firstSeenAt }) {
  if (!binding?.agentId) return null;
  return ensureConversationDateTag({
    botId,
    agentId: binding.agentId,
    conversationKey,
    firstSeenAt: firstSeenAt || new Date(),
    source: "friend_added"
  });
}

function isMentioned(message, binding) {
  const atMe = String(message.atMe ?? message.metadata?.atMe ?? "").toLowerCase();
  const raw = String(message.rawSpoken || message.rawMessage || message.spoken || "");
  if (atMe === "true") return true;

  const mentionNames = [binding?.botName, process.env.BOT_NAME]
    .filter(Boolean)
    .map((name) => String(name).trim());
  if (!mentionNames.length) {
    return raw.includes("@");
  }
  return mentionNames.some((name) => raw.includes(`@${name}`));
}

function shouldInvokeAgent(message, binding) {
  if (!isGroupMessage(message)) {
    return true;
  }
  return isMentioned(message, binding);
}

function resolveInboundConversation({ botId, message }) {
  if (!isGroupMessage(message)) {
    return {
      conversationKey: getConversationKey(botId, message),
      group: null
    };
  }
  const group = createOrGetGroup({
    botId,
    currentName: message.groupName || message.groupRemark || "unknown",
    currentRemark: message.groupRemark || "",
    source: "callback"
  });
  return {
    conversationKey: group.conversationKey,
    group
  };
}

function resolveInboundGroupPolicy({ botId, group, message }) {
  if (!group) {
    return { invokeAgent: true, reason: "private", effectivePolicy: "always" };
  }
  const speakerName = String(message?.receivedName || "").trim();
  const role = listGroupRoles({ botId, groupId: group.id }).find(
    (item) => item.currentName === speakerName || item.aliases.includes(speakerName)
  );
  const originalAtMe = isMentioned(message, getBotBinding(botId));
  const decision = resolveGroupReplyDecision({
    groupPolicy: group.replyPolicy,
    rolePolicy: role?.replyPolicy || "inherit",
    atMe: originalAtMe
  });
  return {
    ...decision,
    groupPolicy: group.replyPolicy,
    rolePolicy: role?.replyPolicy || "inherit",
    originalAtMe,
    matchedRole: role ? {
      id: role.id,
      currentName: role.currentName,
      replyPolicy: role.replyPolicy
    } : null
  };
}

function normalizeMessageForAgent(message, binding, groupReplyDecision = null) {
  if (
    !isGroupMessage(message)
    || (!groupReplyDecision?.invokeAgent && !isMentioned(message, binding))
  ) {
    return message;
  }
  const originalAtMe = message.atMe ?? message.metadata?.atMe ?? "";
  return {
    ...message,
    atMe: "true",
    metadata: {
      ...(message.metadata || {}),
      atMe: "true",
      originalAtMe,
      ...(groupReplyDecision?.invokeAgent
        ? {
            groupReplyAuthorized: true,
            groupReplyReason: groupReplyDecision.reason,
            effectiveGroupReplyPolicy: groupReplyDecision.effectivePolicy,
            matchedGroupRoleName: groupReplyDecision.matchedRole?.currentName || ""
          }
        : {})
    }
  };
}

function getFlowNode(machine, nodeId) {
  const nodes = machine?.config?.nodes || machine?.nodes || [];
  return nodes.find((node) => node.id === nodeId) || null;
}

function persistInboundConversation({
  botId,
  binding,
  conversationKey,
  message,
  resetPending = false,
  skipFirstSeenDateTag = false,
  managedGroup = null
}) {
  const conversation = upsertConversation({
    botId,
    agentId: binding?.agentId || "",
    conversationKey,
    message,
    resetPending,
    skipFirstSeenDateTag
  });
  if (managedGroup && binding?.agentId) {
    ensureManagedGroupConversationDateTag({
      botId,
      agentId: binding.agentId,
      conversationKey,
      groupCreatedAt: managedGroup.groupCreatedAt
    });
  }
  const flowMachine = getFlowMachineForBot(botId);
  if (binding?.enabled) {
    if (isGroupMessage(message) || !flowMachine?.enabled) {
      getOrCreateConversationSession({ botId, conversationKey });
    } else {
      getOrCreateFlowSession({
        botId,
        conversationKey,
        machine: flowMachine.config
      });
      touchFlowSession(conversationKey);
    }
  }
  const messageRecord = shouldRecordConversationHistory(message)
    ? insertConversationMessage({
      botId,
      conversationKey,
      direction: "inbound",
      senderName: message.receivedName || "",
      content: message.spoken || message.rawSpoken || inboundAttachmentPlaceholder(message) || "",
      rawPayload: message
    })
    : null;
  return { conversation, messageRecord };
}

function buildFlowContext({ botId, conversationKey, message }) {
  if (!isPrivateMessage(message)) return null;
  const machine = getFlowMachineForBot(botId);
  if (!machine || !machine.enabled) return null;
  const session = getOrCreateFlowSession({ botId, conversationKey, machine });
  const currentNode = getFlowNode(machine, session.currentNodeId) ||
    getFlowNode(machine, machine.entryNodeId);
  return {
    machine: {
      name: machine.name,
      version: machine.version,
      entryNodeId: machine.entryNodeId,
      generalRule: machine.config.generalRule || "",
      nodes: machine.config.nodes
    },
    session,
    currentNode
  };
}

function scheduleCurrentActivation({ botId, binding, conversationKey, machine, session, anchorAt }) {
  const node = getFlowNode(machine, session?.currentNodeId);
  const activation = normalizeActivationConfig(node?.activation || {});
  const progress = getFlowActivationProgress({ conversationKey, nodeId: node?.id });
  const activationMessage = activation.messages[progress.messageIndex];
  if (!activation.enabled || !activationMessage) return null;

  const attemptNumber = progress.sentCount + 1;
  return scheduleFlowActivationTask({
    botId,
    agentId: binding.agentId,
    conversationKey,
    nodeId: node.id,
    generation: session.activationGeneration,
    activation,
    anchorAt,
    dueAt: activationDueAtForAttempt(anchorAt, activationMessage.intervalMinutes, attemptNumber),
    attemptNumber,
    messageIndex: progress.messageIndex
  });
}

function scheduleActivationAfterFlowReply({ botId, binding, conversationKey, flow, sentAt = new Date() }) {
  if (!flow || !isPrivateConversationKey(conversationKey)) return null;
  const machine = getFlowMachineForBot(botId);
  // A successful reply supersedes every earlier reminder, even if the current
  // node does not have activation enabled.
  const session = incrementFlowActivationGeneration({
    conversationKey,
    reason: "flow_reply_sent"
  });
  const anchorAt = sentAt.toISOString();
  return scheduleCurrentActivation({
    botId,
    binding,
    conversationKey,
    machine,
    session,
    anchorAt
  });
}

function cancelTagTasksForAcceptedChanges({ botId, binding, conversationKey, accepted = [] }) {
  if (!binding?.agentId) return 0;
  let canceled = 0;
  for (const change of accepted) {
    for (const oldTagId of change.oldTagIds || []) {
      canceled += cancelTagActivationTasks({
        botId,
        agentId: binding.agentId,
        conversationKey,
        groupId: change.groupId,
        tagId: oldTagId,
        reason: "tag_changed"
      });
    }
    if (change.action === "remove") {
      canceled += cancelTagActivationTasks({
        botId,
        agentId: binding.agentId,
        conversationKey,
        groupId: change.groupId,
        tagId: change.tagId,
        reason: "tag_removed"
      });
    }
  }
  return canceled;
}

function scheduleTagActivationsForAcceptedChanges({ botId, binding, conversationKey, accepted = [] }) {
  if (!binding?.agentId) return [];
  const schema = normalizeTagSchema(getAgentTagSchema(binding.agentId)?.config || {});
  const scheduled = [];
  for (const change of accepted) {
    if (!["add", "replace"].includes(change.action)) continue;
    const group = schema.groups.find((item) => item.id === change.groupId);
    const tag = group?.tags.find((item) => item.id === change.tagId);
    const activation = tag?.activation || {};
    if (!activation.enabled || !activation.messages?.length) continue;
    const firstMessage = activation.messages[0];
    const task = scheduleTagActivationTask({
      botId,
      agentId: binding.agentId,
      conversationKey,
      groupId: group.id,
      tagId: tag.id,
      activation,
      dueAt: activationDueAtForAttempt(new Date().toISOString(), firstMessage.intervalMinutes, 1),
      attemptNumber: 1,
      messageIndex: 0
    });
    scheduled.push(task);
  }
  return scheduled;
}

function buildTagContext({ binding, conversationKey, group = null }) {
  if (!binding?.agentId) return null;
  const schema = normalizeTagSchema(getAgentTagSchema(binding.agentId)?.config || {});
  if (!schema.groups.length) return null;
  const currentTags = listConversationTags({
    botId: binding.botId,
    agentId: binding.agentId,
    conversationKey
  }).filter((tag) => tag.tagType !== "date");
  if (group) {
    return buildGroupTagContext({
      schema,
      boundTagGroupIds: group.tagGroupIds,
      currentTags
    });
  }
  return compactTagRulesForAgent({ schema, currentTags });
}

function buildTagEvidenceCandidates({ items = [], legacyHistoryAnalysis = null }) {
  const candidates = [];
  for (const historyMessage of legacyHistoryAnalysis?.selectedMessages || []) {
    const conversationMessageId = Number(historyMessage?.id);
    const text = String(historyMessage?.content || "").trim();
    if (!Number.isInteger(conversationMessageId) || conversationMessageId <= 0 || !text) continue;
    candidates.push({
      id: String(conversationMessageId),
      conversationMessageId,
      text
    });
  }
  for (const item of items) {
    const conversationMessageId = Number(item?.conversationMessageId);
    const text = String(item?.message?.spoken || item?.message?.rawSpoken || "").trim();
    if (!Number.isInteger(conversationMessageId) || conversationMessageId <= 0 || !text) continue;
    candidates.push({
      id: String(conversationMessageId),
      conversationMessageId,
      text
    });
  }
  return [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
}

function applyAgentTagDecision({
  botId,
  binding,
  conversationKey,
  agentReply,
  evidenceCandidates = []
}) {
  if (!binding?.agentId) return null;
  const schema = normalizeTagSchema(getAgentTagSchema(binding.agentId)?.config || {});
  if (!schema.groups.length) return null;
  const currentTags = listConversationTags({
    botId,
    agentId: binding.agentId,
    conversationKey
  });
  const result = adjudicateTagDecision({
    schema,
    currentTags: currentTags.filter((tag) => tag.tagType !== "date"),
    decision: agentReply?.tagDecision || {}
  });
  if (!result.accepted.length && !result.rejected.length) {
    return {
      tags: currentTags,
      accepted: [],
      rejected: [],
      scheduledTagActivationTasks: [],
      alerts: []
    };
  }

  const anchorAt = new Date().toISOString();
  const candidateMessageIds = evidenceCandidates
    .map((candidate) => candidate.conversationMessageId)
    .filter(Boolean);
  const activationCandidates = [];
  const alertCandidates = [];
  const conversation = getConversation(conversationKey);
  for (const change of result.accepted) {
    if (!["add", "replace"].includes(change.action)) continue;
    const group = schema.groups.find((item) => item.id === change.groupId);
    const tag = group?.tags.find((item) => item.id === change.tagId);
    if (!group || !tag) continue;

    const firstActivationMessage = tag.activation?.messages?.[0];
    if (tag.activation?.enabled && firstActivationMessage) {
      activationCandidates.push({
        groupId: group.id,
        tagId: tag.id,
        activation: tag.activation,
        dueAt: activationDueAtForAttempt(
          anchorAt,
          firstActivationMessage.intervalMinutes,
          1
        ),
        attemptNumber: 1,
        messageIndex: 0
      });
    }
    if (!tag.voiceAlertEnabled) continue;
    const evidence = resolveConversationMessageEvidence({
      botId,
      conversationKey,
      evidenceMessageId: change.evidenceMessageId,
      evidenceText: change.evidenceText,
      candidateMessageIds
    });
    alertCandidates.push({
      groupId: group.id,
      tagId: tag.id,
      customerName: conversation?.receivedName || privateTargetNameFromConversationKey(conversationKey),
      evidenceMessageId: evidence?.id || null,
      evidenceText: evidence?.content || change.evidenceText || ""
    });
  }

  return applyAgentTagOutcome({
    botId,
    agentId: binding.agentId,
    conversationKey,
    accepted: result.accepted,
    rejected: result.rejected,
    nextTags: result.nextTags,
    source: "agent_decision",
    activationCandidates,
    alertCandidates
  });
}

function publishCommittedTagAlerts({ botId, invocationId, tagResult }) {
  const alerts = tagResult?.alerts || [];
  if (!alerts.length) return;
  tagAlertStreamHub.publishCreated({
    botId,
    batchId: `invocation:${invocationId}`,
    alerts
  });
}

function scheduleNextTagActivationTask({ task, sentAt }) {
  if (!task?.messages?.length) return null;
  sentAt = sentAt || new Date().toISOString();
  const activation = {
    enabled: true,
    polishByAgent: task.polishByAgent,
    messages: task.messages
  };

  if (task.attemptNumber < task.maxTimes) {
    const attemptNumber = task.attemptNumber + 1;
    return scheduleTagActivationTask({
      botId: task.botId,
      agentId: task.agentId,
      conversationKey: task.conversationKey,
      groupId: task.groupId,
      tagId: task.tagId,
      activation,
      dueAt: activationDueAtForAttempt(sentAt, task.intervalMinutes, attemptNumber),
      attemptNumber,
      messageIndex: task.messageIndex
    });
  }

  const nextMessage = task.messages[task.messageIndex + 1];
  if (!nextMessage) return null;
  return scheduleTagActivationTask({
    botId: task.botId,
    agentId: task.agentId,
    conversationKey: task.conversationKey,
    groupId: task.groupId,
    tagId: task.tagId,
    activation,
    dueAt: activationDueAtForAttempt(sentAt, nextMessage.intervalMinutes, 1),
    attemptNumber: 1,
    messageIndex: task.messageIndex + 1
  });
}

function isValidFlowNode(machine, nodeId) {
  const nodes = machine?.config?.nodes || machine?.nodes || [];
  return Boolean(nodes.some((node) => node.id === nodeId));
}

async function executeFlowActions({
  source,
  botId,
  binding,
  conversationKey,
  nodeId,
  activationTaskId = "",
  actions = []
}) {
  if (!Array.isArray(actions) || actions.length === 0) return [];
  if (!binding?.agentId) {
    logWarn("flow_action.skipped", {
      botId,
      conversationKey,
      nodeId,
      activationTaskId,
      source,
      reason: "missing_agent_binding"
    });
    return [];
  }
  if (!isPrivateConversationKey(conversationKey)) {
    logInfo("flow_action.skipped", {
      botId,
      agentId: binding?.agentId || "",
      conversationKey,
      nodeId,
      activationTaskId,
      source,
      reason: "non_private_conversation"
    });
    return [];
  }

  const target = privateTargetNameFromConversationKey(conversationKey);
  if (!target) {
    logWarn("flow_action.skipped", {
      botId,
      agentId: binding?.agentId || "",
      conversationKey,
      nodeId,
      activationTaskId,
      source,
      reason: "missing_current_contact"
    });
    return [];
  }

  const results = [];
  for (const action of actions) {
    if (!action || action.type !== "invite_to_group") continue;
    if (action.target !== "current_contact") {
      logInfo("flow_action.skipped", {
        botId,
        agentId: binding?.agentId || "",
        conversationKey,
        nodeId,
        activationTaskId,
        source,
        actionId: action.id || "",
        actionType: action.type || "",
        reason: "unsupported_target"
      });
      continue;
    }

    let reservation;
    try {
      reservation = reserveFlowActionExecution({
        botId,
        agentId: binding.agentId,
        conversationKey,
        source,
        nodeId,
        activationTaskId,
        action
      });
    } catch (error) {
      logWarn("flow_action.invalid", {
        botId,
        agentId: binding?.agentId || "",
        conversationKey,
        nodeId,
        activationTaskId,
        source,
        actionId: action.id || "",
        actionType: action.type || "",
        error: error.message
      });
      continue;
    }

    if (!reservation?.reserved) {
      logInfo("flow_action.duplicate_skipped", {
        botId,
        agentId: binding.agentId,
        conversationKey,
        nodeId,
        activationTaskId,
        source,
        actionId: action.id || "",
        executionId: reservation?.execution?.id || ""
      });
      continue;
    }

    try {
      const result = await sendGroupInviteCommand({
        robotId: botId,
        groupName: action.groupName,
        targets: [target],
        showMessageHistory: false
      });
      const worktoolMessageId = String(result?.data || "");
      const execution = markFlowActionExecutionSucceeded({
        id: reservation.execution.id,
        worktoolMessageId,
        worktoolResponse: result
      });
      insertOutgoingMessage({
        botId,
        agentId: binding.agentId,
        conversationKey,
        messageId: worktoolMessageId,
        targetName: target,
        content: `拉入群：${target} -> ${action.groupName}`,
        worktoolResponse: {
          ...(result || {}),
          source: "flow_action",
          flowActionSource: source,
          flowActionExecutionId: execution?.id || reservation.execution.id,
          actionId: action.id || "",
          actionType: action.type || "",
          nodeId,
          activationTaskId,
          groupName: action.groupName,
          targetName: target
        }
      });
      logInfo("flow_action.sent", {
        botId,
        agentId: binding.agentId,
        conversationKey,
        nodeId,
        activationTaskId,
        source,
        actionId: action.id || "",
        executionId: execution?.id || reservation.execution.id,
        groupName: action.groupName,
        targetName: target,
        worktoolMessageId,
        worktoolCode: result?.code
      });
      results.push({ action, execution, result });
    } catch (error) {
      markFlowActionExecutionFailed({
        id: reservation.execution.id,
        errorMessage: error.message
      });
      logWarn("flow_action.failed", {
        botId,
        agentId: binding.agentId,
        conversationKey,
        nodeId,
        activationTaskId,
        source,
        actionId: action.id || "",
        executionId: reservation.execution.id,
        groupName: action.groupName,
        targetName: target,
        error: error.message
      });
    }
  }

  return results;
}

async function applyFlowDecision({
  botId,
  binding,
  conversationKey,
  message,
  flow,
  decision,
  fillOnlyMissing = false
}) {
  if (!flow || !decision || typeof decision !== "object") return;
  const rawPatch = decision.collectedDataPatch || decision.collectedFields || decision.dataPatch || {};
  const patch = filterConfiguredCollectedDataPatch({
    flow,
    patch: rawPatch,
    fillOnlyMissing
  });
  if (Object.keys(patch).length) {
    mergeFlowSessionData({ conversationKey, patch });
  }

  const completedNode = getFlowNode(flow.machine, flow.session.currentNodeId);
  const configuredNextNodeId = String(completedNode?.nextNodeId || "").trim();
  if (
    decision.nodeCompleted === true &&
    configuredNextNodeId &&
    configuredNextNodeId !== flow.session.currentNodeId &&
    isValidFlowNode(flow.machine, configuredNextNodeId)
  ) {
    const appliedDecision = {
      ...decision,
      nextNodeId: configuredNextNodeId
    };
    updateFlowSessionNode({
      botId,
      conversationKey,
      nextNodeId: configuredNextNodeId,
      reason: decision.reason || "Agent 判断节点完成",
      decision: appliedDecision
    });
    invalidateFlowActivation({ conversationKey, reason: "node_transition" });
    await executeFlowActions({
      source: "node_complete",
      botId,
      binding,
      conversationKey,
      nodeId: completedNode?.id || flow.session.currentNodeId,
      actions: completedNode?.actionsOnComplete || []
    });
  }
}

function looksLikeInternalNonReplyAnalysis(reply) {
  const text = String(reply || "");
  return (
    text.includes("输出空字符串") ||
    text.includes("我不应该回复") ||
    text.includes("不需要回复")
  ) && (
    text.includes("根据规则") ||
    text.includes("让我分析") ||
    text.includes("atMe") ||
    text.includes("群聊")
  );
}

const defaultDebugReplyConfig = {
  enabled: false,
  trigger: "ping",
  reply: "pong"
};

const proactiveWorkerConfig = {
  enabled: process.env.PROACTIVE_WORKER_ENABLED !== "false",
  intervalMs: Number(process.env.PROACTIVE_WORKER_INTERVAL_MS || 2000),
  maxAttempts: Number(process.env.PROACTIVE_MAX_ATTEMPTS || 2)
};

const activationWorkerConfig = {
  enabled: process.env.ACTIVATION_WORKER_ENABLED !== "false",
  intervalMs: Number(process.env.ACTIVATION_WORKER_INTERVAL_MS || 10000),
  batchSize: Number(process.env.ACTIVATION_WORKER_BATCH_SIZE || 20),
  staleProcessingMs: Number(process.env.ACTIVATION_WORKER_STALE_PROCESSING_MS || 300000),
  sendDelayMs: Number(process.env.ACTIVATION_SEND_DELAY_MS || 500),
  maxConcurrentAgentCalls: Number(process.env.ACTIVATION_MAX_CONCURRENT_AGENT_CALLS || 2)
};
const tagActivationWorkerConfig = {
  enabled: process.env.TAG_ACTIVATION_WORKER_ENABLED !== "false",
  intervalMs: Number(process.env.TAG_ACTIVATION_WORKER_INTERVAL_MS || 10000),
  batchSize: Number(process.env.TAG_ACTIVATION_WORKER_BATCH_SIZE || 20),
  staleProcessingMs: Number(process.env.TAG_ACTIVATION_WORKER_STALE_PROCESSING_MS || 300000),
  sendDelayMs: Number(process.env.TAG_ACTIVATION_SEND_DELAY_MS || 500),
  maxConcurrentAgentCalls: Number(process.env.TAG_ACTIVATION_MAX_CONCURRENT_AGENT_CALLS || 2)
};
const groupAutomationWorkerConfig = {
  enabled: process.env.GROUP_AUTOMATION_WORKER_ENABLED !== "false",
  occurrenceIntervalMs: Math.max(
    500,
    Number(process.env.GROUP_AUTOMATION_OCCURRENCE_INTERVAL_MS || 2000)
  ),
  leaseMs: Math.max(
    30_000,
    Number(process.env.GROUP_AUTOMATION_LEASE_MS || 300000)
  ),
  batchSize: Math.max(
    1,
    Math.min(100, Number(process.env.GROUP_AUTOMATION_BATCH_SIZE || 10))
  )
};
const friendAddedReentryCooldownMs = Math.max(
  0,
  Number(process.env.FRIEND_ADDED_REENTRY_COOLDOWN_MINUTES || 0) * 60 * 1000
);
const configuredFriendAddedSignalDedupeSeconds = Number(
  process.env.FRIEND_ADDED_SIGNAL_DEDUPE_SECONDS || 30
);
const friendAddedSignalDedupeMs = Number.isFinite(configuredFriendAddedSignalDedupeSeconds)
  && configuredFriendAddedSignalDedupeSeconds > 0
  ? Math.max(1_000, configuredFriendAddedSignalDedupeSeconds * 1000)
  : DEFAULT_FRIEND_ADDED_SIGNAL_DEDUPE_MS;

const configuredReplyMaxParts = Number(process.env.WORKTOOL_REPLY_MAX_PARTS || 3);
const configuredReplyPartDelayMs = Number(process.env.WORKTOOL_REPLY_PART_DELAY_MS || 1000);
const replySplitConfig = {
  enabled: process.env.WORKTOOL_SPLIT_AGENT_REPLY !== "false",
  splitGroup: process.env.WORKTOOL_SPLIT_GROUP_REPLY === "true",
  maxParts: Number.isFinite(configuredReplyMaxParts)
    ? Math.max(1, configuredReplyMaxParts)
    : 3,
  delayMs: Number.isFinite(configuredReplyPartDelayMs)
    ? Math.max(0, configuredReplyPartDelayMs)
    : 1000
};

const inboundCoalesceDefaults = {
  baseQuietMs: 10_000,
  incrementMs: 5_000
};

let proactiveWorkerBusy = false;
let activationWorkerBusy = false;
let tagActivationWorkerBusy = false;
const agentInvocationQueue = createAgentInvocationQueue({
  concurrency: process.env.DCLAW_AGENT_CONCURRENCY || 3
});

function groupAutomationExecutionCapability(botId) {
  const binding = getBotBinding(botId);
  if (!binding?.enabled || !String(binding?.agentApiUrl || "").trim()) {
    return {
      executionAvailable: false,
      technicalReason: "DClaw Agent 未启用或未完成配置"
    };
  }
  return { executionAvailable: true, technicalReason: "" };
}

const insertConversationMessage = insertConversationMessageDb;

function inboundCoalesceKey(botId, conversationKey) {
  return `${String(botId || "")}\u0000${String(conversationKey || "")}`;
}

function buildCoalescedAgentMessage(messages) {
  const ordered = messages.filter(Boolean);
  const last = ordered.at(-1) || {};
  if (ordered.length <= 1) return last;
  const mentioned = ordered.some(
    (message) => message.atMe === true || String(message.atMe || "").toLowerCase() === "true"
  );
  const lines = ordered.map(
    (message, index) => `${index + 1}. ${String(message.spoken || message.rawSpoken || "").trim()}`
  );
  const spoken = `客户连续发送了以下消息，请结合上下文统一回答：\n${lines.join("\n")}`;
  return {
    ...last,
    spoken,
    rawSpoken: spoken,
    atMe: mentioned ? "true" : last.atMe,
    metadata: {
      ...(last.metadata || {}),
      coalescedMessages: ordered.map((message, index) => ({
        index,
        messageId: message.messageId || "",
        spoken: message.spoken || message.rawSpoken || "",
        receivedName: message.receivedName || "",
        roomType: message.roomType ?? null,
        groupName: message.groupName || ""
      }))
    }
  };
}

function finishCoalescedMessageProcessing({ batch, status, error = "" }) {
  for (const item of batch?.items || []) {
    finishMessageProcessing({ messageKey: item.messageKey, status, error });
  }
}

function cancelInboundBatch(key, reason) {
  const items = inboundCoalescer.cancel(key, reason);
  for (const item of items) {
    finishMessageProcessing({
      messageKey: item.messageKey,
      status: "coalesced_canceled",
      error: reason
    });
  }
  return items;
}

function cancelInboundBatchesForBot(botId, reason) {
  const batches = inboundCoalescer.cancelByBot(botId, reason);
  for (const batch of batches) {
    for (const item of batch.items) {
      finishMessageProcessing({
        messageKey: item.messageKey,
        status: "coalesced_canceled",
        error: reason
      });
    }
  }
  return batches;
}

const inboundCoalesceEventNames = {
  started: "incoming.coalesce.started",
  appended: "incoming.coalesce.appended",
  flushed: "incoming.coalesce.flushed",
  canceled: "incoming.coalesce.canceled"
};

const inboundCoalescer = createInboundMessageCoalescer({
  baseQuietMs: inboundCoalesceDefaults.baseQuietMs,
  incrementMs: inboundCoalesceDefaults.incrementMs,
  onFlush: processCoalescedIncomingBatch,
  onEvent: (name, details) => {
    const event = inboundCoalesceEventNames[name] || `incoming.coalesce.${name}`;
    const fields = {
      batchId: details.id,
      botId: details.botId,
      conversationKey: details.conversationKey,
      messageCount: details.itemCount,
      reason: details.reason || "",
      waitMs: details.waitMs ?? null,
      scheduledDelayMs: details.scheduledDelayMs ?? null
    };
    if (name === "canceled") logWarn(event, fields);
    else logInfo(event, fields);
  }
});

function enqueueAgentInvocation(task, options) {
  return agentInvocationQueue.enqueue(task, options);
}

const obsoleteGroupHistoryRemoval = finalizeObsoleteGroupHistoryRemoval();
if (obsoleteGroupHistoryRemoval.removed) {
  logInfo("group_history.obsolete_runtime_removed", {});
}

const groupAutomationWorker = createGroupAutomationWorker({
  db: {
    prepareGroupAutomationOccurrences,
    recoverLegacyGroupAutomationOccurrences,
    claimDueGroupAutomationOccurrences,
    getGroupById,
    getConversation,
    upsertConversation,
    getGroupAutomationOccurrence,
    validateGroupAutomationEvidenceMessageIds,
    heartbeatGroupAutomationOccurrence,
    transitionGroupAutomationOccurrence,
    markGroupAutomationSendUnknown
  },
  getBinding: getBotBinding,
  executeAgentTask: (input) => executeGroupAutomationAgentTask({
    ...input,
    invokeAgent: ({ binding, request, signal }) => enqueueAgentInvocation(
      () => invokeDclawAgent({ binding, request, signal }),
      { priority: "background", key: input.conversation.conversationKey }
    )
  }),
  sendGroupMessage: sendTextMessage,
  now: () => new Date(),
  logger: {
    info: logInfo,
    warn: logWarn,
    error: logError
  },
  onOccurrenceChanged: publishGroupAutomationCallbackResult,
  leaseMs: groupAutomationWorkerConfig.leaseMs
});

function publishGroupAutomationCallbackResult(occurrence) {
  if (!occurrence) return;
  groupAutomationStreamHub.publish({
    botId: occurrence.botId,
    groupId: occurrence.groupId,
    occurrence: serializeGroupAutomationOccurrence(occurrence)
  });
}

const conversationResetTimeoutMs = Math.max(
  1000,
  Number(process.env.DCLAW_CONVERSATION_RESET_TIMEOUT_MS || 20000)
);
const conversationResetWorkerConfig = {
  enabled: process.env.CONVERSATION_RESET_WORKER_ENABLED !== "false",
  intervalMs: Math.max(
    500,
    Number(process.env.CONVERSATION_RESET_WORKER_INTERVAL_MS || 2000)
  ),
  staleProcessingMs: Math.max(
    1000,
    Number(process.env.CONVERSATION_RESET_WORKER_STALE_PROCESSING_MS || 120000)
  ),
  retryDelayMs: Math.max(
    1000,
    Number(process.env.CONVERSATION_RESET_RETRY_DELAY_MS || 5000)
  )
};

export async function syncConversationResetToAgent({
  binding,
  conversationKey,
  conversationEpoch,
  reason = "console_reset",
  invoke = null
}) {
  if (!binding?.enabled) {
    return { status: "skipped" };
  }

  const request = buildDclawConversationResetRequest({
    binding,
    conversationKey,
    conversationEpoch,
    reason,
    generalRule: getFlowMachineForBot(binding.botId)?.config?.generalRule || ""
  });
  const memoryClearRequest = buildDclawConversationMemoryClearRequest({
    binding,
    conversationKey,
    conversationEpoch,
    reason
  });
  const invocationId = insertAgentInvocationStart({
    botId: binding.botId,
    agentId: binding.agentId,
    conversationKey,
    incomingMessageId: `conversation_reset:${Date.now()}`,
    request
  });
  const startedAt = Date.now();

  try {
    const invokeResetRequest = async (nextRequest) => {
      if (invoke) return invoke({ binding, request: nextRequest });
      return invokeDclawAgentWithRetry({
        binding,
        request: nextRequest,
        maxAttempts: 1,
        timeoutMs: conversationResetTimeoutMs
      });
    };
    const runReset = () => runConversationResetRequests({
      workspaceRequest: request,
      memoryClearRequest,
      invoke: invokeResetRequest
    });
    const result = await enqueueAgentInvocation(
      runReset,
      { priority: "background", key: conversationKey }
    );
    if (!result.ok) {
      const errors = [result.workspaceError, result.memoryError].filter(Boolean);
      const error = new Error(errors.map((item) => item.message).join("; "));
      error.resetResult = result;
      throw error;
    }
    finishAgentInvocation({
      id: invocationId,
      response: {
        workspaceReset: result.workspaceInvocation?.response || null,
        memoryClear: result.memoryInvocation?.response || null
      },
      status: "success"
    });
    markConversationResetHandledForEpoch(conversationKey, conversationEpoch);
    logInfo("agent.conversation_reset.success", {
      botId: binding.botId,
      agentId: binding.agentId,
      conversationKey,
      invocationId,
      durationMs: Date.now() - startedAt
    });
    return { status: "synced" };
  } catch (error) {
    const resetResult = error.resetResult || null;
    finishAgentInvocation({
      id: invocationId,
      response: resetResult
        ? {
            workspaceReset: resetResult.workspaceInvocation?.response || null,
            memoryClear: resetResult.memoryInvocation?.response || null
          }
        : null,
      status: "failed",
      error: error.message
    });
    logWarn("agent.conversation_reset.failed", {
      botId: binding.botId,
      agentId: binding.agentId,
      conversationKey,
      invocationId,
      durationMs: Date.now() - startedAt,
      error: error.message
    });
    return { status: "pending", error: error.message };
  }
}

const conversationResetWorker = createConversationResetWorker({
  claimTask: () => claimNextConversationResetTask({
    staleBeforeIso: new Date(
      Date.now() - conversationResetWorkerConfig.staleProcessingMs
    ).toISOString()
  }),
  getBinding: getBotBinding,
  syncTask: syncConversationResetToAgent,
  completeTask: completeConversationResetTask,
  failTask: failConversationResetTask,
  retryDelayMs: conversationResetWorkerConfig.retryDelayMs,
  onEvent: (event, details) => {
    const fields = {
      resetTaskId: details.task.id,
      botId: details.task.botId,
      agentId: details.task.agentId,
      conversationKey: details.task.conversationKey,
      attemptNumber: details.task.attemptNumber,
      durationMs: details.durationMs ?? null,
      error: details.error || ""
    };
    if (event === "failed") logWarn("conversation_reset.worker.failed", fields);
    else logInfo(`conversation_reset.worker.${event}`, fields);
  }
});

if (conversationResetWorkerConfig.enabled) {
  setInterval(() => {
    conversationResetWorker.wake();
  }, conversationResetWorkerConfig.intervalMs).unref();
  setImmediate(() => conversationResetWorker.wake());
}

function invalidSendabilityAgentReply(rawReply, sendabilityIssue) {
  return {
    valid: false,
    reply: "",
    attachments: [],
    sources: [],
    flowDecision: null,
    tagEvaluation: [],
    tagDecision: { add: [], remove: [] },
    raw: rawReply,
    sendabilityIssue
  };
}

function invalidValidationAgentReply(rawReply, validationErrors) {
  return {
    valid: false,
    reply: "",
    attachments: [],
    sources: [],
    flowDecision: null,
    tagEvaluation: [],
    tagDecision: { add: [], remove: [] },
    raw: rawReply,
    validationErrors
  };
}

function persistAgentTagAudit({
  invocationId,
  botId,
  binding,
  conversationKey,
  incomingMessageId,
  agentReply
}) {
  if (!agentReply?.tagEvaluation?.length) return [];
  const records = insertAgentTagEvaluations({
    invocationId,
    botId,
    agentId: binding.agentId,
    conversationKey,
    incomingMessageId,
    evaluations: agentReply.tagEvaluation,
    decision: agentReply.tagDecision
  });
  logInfo("agent.tag_audit.persisted", {
    botId,
    agentId: binding.agentId,
    conversationKey,
    invocationId,
    evaluationCount: records.length,
    matchedCount: records.filter((record) => record.matched).length
  });
  return records;
}

function validateStrictAgentReply({
  invocation,
  request,
  attemptNumber,
  stage,
  retryRequested,
  onValidationFailure,
  onLocalRepair
}) {
  const result = validateAgentResponseText(invocation?.reply || "", agentResponseValidationOptions(request));
  if (!result.valid) {
    onValidationFailure?.({
      attemptNumber,
      stage,
      retryRequested,
      errors: result.errors,
      rawReply: result.rawText,
      rawReplyLength: String(result.rawText || "").length,
      normalizations: result.normalizations
    });
  } else if (result.repairs.length) {
    onLocalRepair?.({
      attemptNumber,
      stage,
      errors: result.originalErrors,
      rawReply: result.rawText,
      rawReplyLength: String(result.rawText || "").length,
      repairs: result.repairs
    });
  }
  return result;
}

function recordAgentResponseValidationFailures({
  invocationId,
  botId,
  agentId,
  conversationKey,
  incomingMessageId,
  attemptNumber,
  stage,
  retryRequested,
  errors,
  rawReply,
  retryOutcome,
  repairActions = []
}) {
  for (const error of errors || []) {
    insertAgentResponseValidationFailure({
      invocationId,
      botId,
      agentId,
      conversationKey,
      incomingMessageId,
      attemptNumber,
      stage,
      errorType: error.type,
      errorPath: error.path,
      errorMessage: error.message,
      line: error.line,
      column: error.column,
      rawResponseText: rawReply,
      retryRequested,
      retryOutcome,
      repairActions
    });
  }
}

function recordAgentResponseLocalRepair({
  invocationId,
  botId,
  agentId,
  conversationKey,
  incomingMessageId,
  eventPrefix,
  attemptNumber,
  errors,
  rawReply,
  repairs
}) {
  recordAgentResponseValidationFailures({
    invocationId,
    botId,
    agentId,
    conversationKey,
    incomingMessageId,
    attemptNumber,
    stage: "local_repair",
    retryRequested: false,
    retryOutcome: "locally_repaired",
    errors,
    rawReply,
    repairActions: repairs
  });
  logInfo(`${eventPrefix}.validation_locally_repaired`, {
    botId,
    agentId,
    conversationKey,
    incomingMessageId,
    invocationId,
    attemptNumber,
    repairs
  });
}

function recordAgentValidationRetryOutcome({
  invocationId,
  botId,
  agentId,
  conversationKey,
  incomingMessageId,
  eventPrefix,
  outcome,
  attemptNumber,
  error
}) {
  updateAgentResponseValidationRetryOutcome({
    invocationId,
    outcome,
    errorMessage: error?.message || ""
  });
  const eventName = `${eventPrefix}.validation_retry_${outcome}`;
  const log = outcome === "succeeded" ? logInfo : logWarn;
  log(eventName, {
    botId,
    agentId,
    conversationKey,
    incomingMessageId,
    invocationId,
    attemptNumber,
    outcome,
    error: error?.message || ""
  });
}

function recordAgentFailure({
  invocationId,
  botId,
  agentId,
  conversationKey,
  incomingMessageId,
  error
}) {
  insertAgentResponseValidationFailure({
    invocationId,
    botId,
    agentId,
    conversationKey,
    incomingMessageId,
    attemptNumber: error?.attemptNumber || 1,
    stage: "fallback",
    errorType: error?.errorType || "agent_invocation",
    errorMessage: error?.message || "Agent invocation failed",
    rawResponseText: error?.rawReply || "",
    retryRequested: false,
    retryOutcome: "not_attempted"
  });
}

async function invokeStrictAgentReply({
  binding,
  request,
  queuePriority = "realtime",
  queueKey = "",
  onRetry,
  onFormatRetry,
  onAttachmentSourceRetry,
  onInvalidAttachmentSource,
  onValidationFailure,
  onValidationRetryOutcome,
  onLocalRepair
}) {
  const validationGateway = await validateAndRetryAgentResponse({
    request,
    validationOptions: buildAgentResponseValidationOptions(request),
    invoke: ({ request: attemptRequest, attemptNumber }) => enqueueAgentInvocation(
      () => invokeDclawAgentWithRetry({
        binding,
        request: attemptRequest,
        timeoutMs: attemptNumber > 1 ? getDclawFormatRetryTimeoutMs() : undefined,
        onRetry
      }),
      { priority: queuePriority, key: queueKey }
    ),
    onRetryRequested: ({ rawReplyLength }) => {
      onFormatRetry?.({ rawReplyLength });
    },
    onValidationFailure,
    onRetryOutcome: onValidationRetryOutcome,
    onLocalRepair
  });
  const firstAttempt = validationGateway.attempts[0];
  const first = firstAttempt.invocation;
  let formatAttempts = validationGateway.attempts.length;
  let attachmentSourceAttempts = 1;
  let totalAttempts = validationGateway.attempts.reduce(
    (sum, attempt) => sum + Number(attempt.invocation?.attempts || 1),
    0
  );
  let currentInvocation = validationGateway.invocation;
  let responseChain = validationGateway.attempts.length > 1
    ? {
        initial: validationGateway.attempts[0].invocation.response,
        validationRetry: validationGateway.attempts[1].invocation.response
      }
    : null;
  let validation = validationGateway.validation;

  if (!validationGateway.valid) {
    return {
      invocation: {
        ...currentInvocation,
        request,
        response: responseChain || currentInvocation.response,
        attempts: totalAttempts
      },
      agentReply: invalidValidationAgentReply(currentInvocation.reply, validation.errors),
      formatAttempts,
      attachmentSourceAttempts
    };
  }

  let agentReply = validation.agentReply;
  const sendabilityIssue = getAgentReplySendabilityIssue(agentReply);
  if (!sendabilityIssue) {
    return {
      invocation: {
        ...currentInvocation,
        request,
        response: responseChain || currentInvocation.response,
        attempts: totalAttempts
      },
      agentReply,
      formatAttempts,
      attachmentSourceAttempts
    };
  }

  onAttachmentSourceRetry?.({
    rawReplyLength: String(currentInvocation.reply || "").length,
    issue: sendabilityIssue
  });
  onValidationFailure?.({
    attemptNumber: formatAttempts,
    stage: "sendability",
    retryRequested: true,
    errors: [sendabilityIssueToValidationError(sendabilityIssue)],
    rawReply: currentInvocation.reply || "",
    rawReplyLength: String(currentInvocation.reply || "").length,
    normalizations: validation.normalizations
  });

  const attachmentRetryRequest = buildDclawAttachmentSourceRetryRequest(request, sendabilityIssue);
  const retried = await enqueueAgentInvocation(
    () => invokeDclawAgentWithRetry({
      binding,
      request: attachmentRetryRequest,
      timeoutMs: getDclawFormatRetryTimeoutMs(),
      onRetry
    }),
    { priority: queuePriority, key: queueKey }
  );
  attachmentSourceAttempts = 2;
  totalAttempts += Number(retried.attempts || 1);
  responseChain = {
    initial: first.response,
    ...(responseChain?.validationRetry ? { validationRetry: responseChain.validationRetry } : {}),
    attachmentSourceRetry: retried.response
  };
  validation = validateStrictAgentReply({
    invocation: retried,
    request,
    attemptNumber: formatAttempts + 1,
    stage: "attachment_source_retry",
    retryRequested: true,
    onValidationFailure,
    onLocalRepair
  });
  if (!validation.valid) {
    return {
      invocation: {
        ...retried,
        request,
        response: responseChain,
        attempts: totalAttempts
      },
      agentReply: invalidValidationAgentReply(retried.reply, validation.errors),
      formatAttempts,
      attachmentSourceAttempts
    };
  }

  agentReply = validation.agentReply;
  const retryIssue = getAgentReplySendabilityIssue(agentReply);
  if (retryIssue) {
    onInvalidAttachmentSource?.({
      rawReplyLength: String(retried.reply || "").length,
      issue: retryIssue
    });
    onValidationFailure?.({
      attemptNumber: formatAttempts + 1,
      stage: "attachment_source_retry_sendability",
      retryRequested: false,
      errors: [sendabilityIssueToValidationError(retryIssue)],
      rawReply: retried.reply || "",
      rawReplyLength: String(retried.reply || "").length,
      normalizations: validation.normalizations
    });
    agentReply = invalidSendabilityAgentReply(retried.reply, retryIssue);
  }

  return {
    invocation: {
      ...retried,
      request,
      response: responseChain,
      attempts: totalAttempts
    },
    agentReply,
    formatAttempts,
    attachmentSourceAttempts
  };
}

function getDebugReplySettingKey(botId) {
  return `debug_reply:${String(botId || "").trim()}`;
}

function getReplyWaitSettingKey(botId) {
  return `reply_wait:${String(botId || "").trim()}`;
}

function getHistoryAnalysisSettingKey(botId) {
  return `history_analysis:${String(botId || "").trim()}`;
}

function normalizeReplyWaitConfig(config = {}) {
  const baseSeconds = Number(config.baseSeconds);
  const incrementSeconds = Number(config.incrementSeconds);
  const fallbackReply = String(config.fallbackReply ?? agentFailureFallbackReply).trim();
  return {
    baseSeconds: Number.isFinite(baseSeconds) ? Math.max(1, Math.round(baseSeconds)) : 10,
    incrementSeconds: Number.isFinite(incrementSeconds) ? Math.max(0, Math.round(incrementSeconds)) : 5,
    fallbackReply: fallbackReply || agentFailureFallbackReply
  };
}

function getReplyWaitConfig(botId) {
  return normalizeReplyWaitConfig(getSetting(getReplyWaitSettingKey(botId), null) || {});
}

function getHistoryAnalysisConfig(botId) {
  return normalizeHistoryAnalysisConfig(
    getSetting(getHistoryAnalysisSettingKey(botId), null) || {}
  );
}

const legacyHistoryDynamicAssetsRolloutKey =
  "legacy_history_dynamic_assets_v1_rollout_at";
let legacyHistoryDynamicAssetsRolloutAt = "";

function getLegacyHistoryDynamicAssetsRolloutAt() {
  if (legacyHistoryDynamicAssetsRolloutAt) {
    return legacyHistoryDynamicAssetsRolloutAt;
  }
  const stored = String(
    getSetting(legacyHistoryDynamicAssetsRolloutKey, "") || ""
  ).trim();
  if (Number.isFinite(Date.parse(stored))) {
    legacyHistoryDynamicAssetsRolloutAt = stored;
    return stored;
  }
  const rolloutAt = new Date().toISOString();
  setSetting(legacyHistoryDynamicAssetsRolloutKey, rolloutAt);
  legacyHistoryDynamicAssetsRolloutAt = rolloutAt;
  return rolloutAt;
}

function shouldAnalyzeLegacyHistoryForSession(session) {
  if (
    !session
    || session.customerOrigin !== "legacy"
    || session.historySyncStatus !== "success"
  ) {
    return false;
  }
  const historyContextSentAt = String(session.historyContextSentAt || "").trim();
  if (!historyContextSentAt) return true;
  const historyContextTime = Date.parse(historyContextSentAt);
  const rolloutTime = Date.parse(getLegacyHistoryDynamicAssetsRolloutAt());
  if (!Number.isFinite(historyContextTime) || !Number.isFinite(rolloutTime)) {
    return true;
  }
  return historyContextTime < rolloutTime;
}

const legacyHistoryAnalysisFlights = createKeyedSingleFlight();

async function runLegacyHistoryAnalysis({
  botId,
  binding,
  conversationKey,
  message,
  expectedEpoch
}) {
  const conversation = getConversation(conversationKey);
  if (
    !conversation
    || conversation.botId !== botId
    || conversation.conversationEpoch !== expectedEpoch
  ) {
    return { status: "stale" };
  }
  const flow = buildFlowContext({ botId, conversationKey, message });
  if (!shouldAnalyzeLegacyHistoryForSession(flow?.session)) {
    return { status: "not_required" };
  }
  const historyAnalysisConfig = getHistoryAnalysisConfig(botId);
  const legacyHistoryAnalysis = legacyCustomerHistory.buildStoredLegacyAnalysis({
    botId,
    conversationKey,
    maxChars: historyAnalysisConfig.historyCustomerTextMaxChars
  });
  if (!legacyHistoryAnalysis?.text) {
    return { status: "empty" };
  }
  const tagContext = buildTagContext({ binding, conversationKey });
  const tagEvidenceCandidates = buildTagEvidenceCandidates({
    legacyHistoryAnalysis
  });
  const request = buildDclawLegacyHistoryAnalysisRequest({
    binding,
    conversation,
    message,
    flow,
    tagContext,
    tagEvidenceCandidates,
    legacyHistoryAnalysis,
    conversationReset: false,
    generalRule: getFlowMachineForBot(botId)?.config?.generalRule || ""
  });
  const incomingMessageId = `legacy_history_analysis:${message.messageId || Date.now()}`;
  const invocationId = insertAgentInvocationStart({
    botId,
    agentId: binding.agentId,
    conversationKey,
    incomingMessageId,
    request
  });
  const startedAt = Date.now();
  logInfo("legacy_history.background.start", {
    botId,
    agentId: binding.agentId,
    conversationKey,
    invocationId,
    selectedCount: Number(legacyHistoryAnalysis.selectedCount || 0),
    selectedChars: Number(legacyHistoryAnalysis.selectedChars || 0)
  });

  try {
    const strictInvocation = await invokeStrictAgentReply({
      binding,
      request,
      queuePriority: "background",
      queueKey: conversationKey,
      onRetry: (retry) => {
        logWarn("legacy_history.background.retry", {
          botId,
          agentId: binding.agentId,
          conversationKey,
          invocationId,
          attempt: retry.attempt,
          maxAttempts: retry.maxAttempts,
          timeoutMs: retry.timeoutMs,
          error: retry.error.message
        });
      },
      onValidationFailure: ({
        attemptNumber,
        stage,
        retryRequested,
        errors,
        rawReply
      }) => {
        recordAgentResponseValidationFailures({
          invocationId,
          botId,
          agentId: binding.agentId,
          conversationKey,
          incomingMessageId: message.messageId,
          attemptNumber,
          stage,
          retryRequested,
          errors,
          rawReply
        });
      },
      onLocalRepair: ({ attemptNumber, errors, rawReply, repairs }) => {
        recordAgentResponseLocalRepair({
          invocationId,
          botId,
          agentId: binding.agentId,
          conversationKey,
          incomingMessageId: message.messageId,
          eventPrefix: "legacy_history.background",
          attemptNumber,
          errors,
          rawReply,
          repairs
        });
      },
      onValidationRetryOutcome: ({ outcome, attemptNumber, error }) => {
        recordAgentValidationRetryOutcome({
          invocationId,
          botId,
          agentId: binding.agentId,
          conversationKey,
          incomingMessageId: message.messageId,
          eventPrefix: "legacy_history.background",
          outcome,
          attemptNumber,
          error
        });
      }
    });
    if (!strictInvocation.agentReply.valid) {
      const error = new Error("invalid_legacy_history_analysis_reply");
      error.response = strictInvocation.invocation?.response || null;
      throw error;
    }
    if (!isConversationEpochCurrent({ botId, conversationKey, expectedEpoch })) {
      finishAgentInvocation({
        id: invocationId,
        response: strictInvocation.invocation?.response || null,
        status: "stale",
        error: "conversation_epoch_changed"
      });
      return { status: "stale" };
    }

    const latestFlow = buildFlowContext({ botId, conversationKey, message });
    const agentReply = strictInvocation.agentReply;
    persistAgentTagAudit({
      invocationId,
      botId,
      binding,
      conversationKey,
      incomingMessageId,
      agentReply
    });
    const tagResult = tagContext
      ? applyAgentTagDecision({
          botId,
          binding,
          conversationKey,
          agentReply,
          evidenceCandidates: tagEvidenceCandidates
        })
      : null;
    publishCommittedTagAlerts({ botId, invocationId, tagResult });
    const rawPatch = agentReply.flowDecision?.collectedDataPatch
      || agentReply.flowDecision?.collectedFields
      || agentReply.flowDecision?.dataPatch
      || {};
    const patch = filterConfiguredCollectedDataPatch({
      flow: latestFlow,
      patch: rawPatch,
      fillOnlyMissing: true
    });
    if (Object.keys(patch).length) {
      mergeFlowSessionData({ conversationKey, patch });
    }
    markLegacyHistoryContextSent({ botId, conversationKey });
    finishAgentInvocation({
      id: invocationId,
      response: strictInvocation.invocation.response,
      status: "success"
    });
    logInfo("legacy_history.background.success", {
      botId,
      agentId: binding.agentId,
      conversationKey,
      invocationId,
      durationMs: Date.now() - startedAt,
      acceptedTagCount: Number(tagResult?.accepted?.length || 0),
      rejectedTagCount: Number(tagResult?.rejected?.length || 0),
      collectedFieldNames: Object.keys(patch)
    });
    return { status: "success" };
  } catch (error) {
    finishAgentInvocation({
      id: invocationId,
      response: error.response || null,
      status: "failed",
      error: error.message
    });
    logWarn("legacy_history.background.failed", {
      botId,
      agentId: binding.agentId,
      conversationKey,
      invocationId,
      durationMs: Date.now() - startedAt,
      error: error.message
    });
    return { status: "failed", error: error.message };
  }
}

function scheduleLegacyHistoryAnalysis(input) {
  void legacyHistoryAnalysisFlights
    .run(input.conversationKey, () => runLegacyHistoryAnalysis(input))
    .catch((error) => {
      logWarn("legacy_history.background.schedule_failed", {
        botId: input.botId,
        agentId: input.binding?.agentId || "",
        conversationKey: input.conversationKey,
        error: error.message
      });
    });
}

function getAgentFailureFallbackReply(botId) {
  return getReplyWaitConfig(botId).fallbackReply;
}

function getDebugReplyConfig(botId) {
  const config = getSetting(getDebugReplySettingKey(botId), defaultDebugReplyConfig);
  return {
    ...defaultDebugReplyConfig,
    ...(config || {})
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitAgentReplyForWorkTool(reply, { allowSplit = true } = {}) {
  const text = String(reply || "").trim();
  if (!text) return [];
  if (!replySplitConfig.enabled || !allowSplit) return [text];

  const parts = text
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [text];
  if (parts.length <= replySplitConfig.maxParts) return parts;

  return [
    ...parts.slice(0, replySplitConfig.maxParts - 1),
    parts.slice(replySplitConfig.maxParts - 1).join("\n\n")
  ];
}

async function sendTextReplyParts({ robotId, target, reply, allowSplit, beforeSend = null }) {
  const parts = splitAgentReplyForWorkTool(reply, { allowSplit });
  const results = [];
  for (const [index, content] of parts.entries()) {
    if (index > 0 && replySplitConfig.delayMs > 0) {
      await sleep(replySplitConfig.delayMs);
    }
    try {
      beforeSend?.();
    } catch (error) {
      error.sentTextParts = results;
      throw error;
    }
    const result = await sendTextMessage({
      robotId,
      targets: [target],
      content
    });
    results.push({ content, result });
  }
  return results;
}

const supportedAgentMediaTypes = new Set(["image", "file", "video", "audio"]);

function normalizeAgentAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") return null;
  const url = String(attachment.url || attachment.fileUrl || attachment.href || "").trim();
  if (!url) return null;
  const type = String(attachment.type || attachment.fileType || attachment.kind || "link").trim().toLowerCase();
  return {
    type,
    url,
    name: String(attachment.name || attachment.objectName || attachment.filename || attachment.fileName || "").trim(),
    title: String(attachment.title || attachment.label || "").trim()
  };
}

function formatLinkAttachmentsForText(attachments = []) {
  const lines = attachments
    .map(normalizeAgentAttachment)
    .filter((attachment) => attachment && !supportedAgentMediaTypes.has(attachment.type))
    .map((attachment) => {
      const label = attachment.title || attachment.name || "链接";
      return `${label}：${attachment.url}`;
    });
  return lines.length ? lines.join("\n") : "";
}

function appendLinkAttachmentsToReply(reply, attachments = []) {
  const links = formatLinkAttachmentsForText(attachments);
  return [String(reply || "").trim(), links].filter(Boolean).join("\n\n");
}

async function sendAgentAttachments({ robotId, target, attachments = [], beforeSend = null }) {
  const sent = [];
  for (const attachment of attachments.map(normalizeAgentAttachment).filter(Boolean)) {
    if (!supportedAgentMediaTypes.has(attachment.type)) continue;
    try {
      beforeSend?.();
    } catch (error) {
      error.sentAttachments = sent;
      throw error;
    }
    const result = await sendMediaMessage({
      robotId,
      targets: [target],
      fileUrl: attachment.url,
      objectName: attachment.name || attachment.title || attachment.url.split("/").pop() || "",
      fileType: attachment.type
    });
    sent.push({ attachment, result });
  }
  return sent;
}

async function sendAgentFailureFallback({
  botId,
  binding,
  conversationKey,
  message,
  invocationId,
  logContext,
  error
}) {
  if (!isPrivateMessage(message)) return false;
  const reply = String(getAgentFailureFallbackReply(botId) || "").trim();
  if (!reply) return false;
  const target = getReplyTarget(message);
  if (!target) return false;

  const sentParts = await sendTextReplyParts({
    robotId: botId,
    target,
    reply,
    allowSplit: false,
    beforeSend: () => assertConversationAiControlled({ botId, conversationKey })
  });
  const worktoolMessageIds = sentParts.map((part) => part.result?.data || "").filter(Boolean);

  insertConversationMessage({
    botId,
    conversationKey,
    direction: "outbound",
    senderName: binding?.botName || binding?.agentName || "机器人",
    content: reply,
    rawPayload: {
      fallback: true,
      reason: error?.errorType || "agent_invocation_failed",
      error: error.message,
      worktoolMessageId: worktoolMessageIds[0] || "",
      worktoolMessageIds,
      replyParts: sentParts.map((part) => part.content)
    }
  });

  for (const [index, part] of sentParts.entries()) {
    insertOutgoingMessage({
      botId,
      agentId: binding?.agentId || "",
      conversationKey,
      messageId: part.result?.data || "",
      targetName: target,
      content: part.content,
      worktoolResponse: {
        ...(part.result || {}),
        fallback: true,
        replyPartIndex: index,
        replyPartCount: sentParts.length,
        originalReply: reply
      }
    });
  }

  logWarn("agent.fallback_replied", {
    ...logContext,
    agentId: binding?.agentId || "",
    invocationId,
    targetName: target,
    worktoolMessageIds,
    error: error.message
  });
  return true;
}

function messageLogFields({ botId, conversationKey, message }) {
  return {
    botId,
    conversationKey,
    messageId: message?.messageId || "",
    roomType: message?.roomType ?? null,
    textType: message?.textType ?? null,
    receivedName: message?.receivedName || "",
    groupName: message?.groupName || "",
    atMe: message?.atMe ?? message?.metadata?.atMe ?? "",
    spokenLength: String(message?.spoken || "").length,
    rawSpokenLength: String(message?.rawSpoken || message?.rawMessage || "").length
  };
}

async function handleFriendAddedEvent({
  botId,
  binding,
  message,
  trigger,
  logContext,
  conversationKey
}) {
  const friendName = String(message?.receivedName || message?.groupName || "").trim();
  logInfo("friend_added.received", {
    ...logContext,
    friendName,
    trigger
  });
  if (!friendName) {
    logInfo("friend_added.skipped", {
      ...logContext,
      trigger,
      reason: "missing_friend_name"
    });
    return "skipped";
  }
  if (!binding?.enabled) {
    logInfo("friend_added.skipped", {
      ...logContext,
      friendName,
      trigger,
      reason: "no_enabled_binding"
    });
    return "skipped";
  }

  const existingConversation = getConversation(conversationKey);
  const entryAnchorAt = new Date().toISOString();
  if (isFriendAddedSignalDuplicate({
    lastFriendAddedAt: existingConversation?.lastFriendAddedSignalAt,
    occurredAt: entryAnchorAt,
    dedupeMs: friendAddedSignalDedupeMs
  })) {
    logInfo("friend_added.skipped", {
      ...logContext,
      friendName,
      conversationKey,
      trigger,
      reason: "friend_added_signal_duplicate",
      elapsedMs: Date.parse(entryAnchorAt)
        - Date.parse(existingConversation.lastFriendAddedSignalAt)
    });
    return "skipped";
  }
  let conversation = existingConversation;
  if (!conversation) {
    conversation = upsertConversation({
      botId,
      agentId: binding?.agentId || "",
      conversationKey,
      message
    });
  }
  if (existingConversation && existingFriendAddedInCooldown({ botId, conversationKey, occurredAt: entryAnchorAt })) {
    logInfo("friend_added.skipped", {
      ...logContext,
      friendName,
      conversationKey,
      trigger,
      reason: "friend_added_cooldown"
    });
    return "skipped";
  }
  if (existingConversation) {
    cancelInboundBatch(
      inboundCoalesceKey(botId, conversationKey),
      "friend_added_reentry"
    );
    void syncConversationResetToAgent({
      binding,
      conversationKey,
      conversationEpoch: existingConversation.conversationEpoch,
      reason: "friend_added_reentry"
    });
    resetConversationForFriendGreeting({
      botId,
      agentId: binding.agentId,
      conversationKey,
      timestamp: entryAnchorAt
    });
    logInfo("friend_added.conversation_reset", {
      ...logContext,
      friendName,
      conversationKey,
      trigger
    });
  }
  if (trigger === "system_greeting") {
    conversation = recordSystemFriendGreeting({ botId, binding, conversationKey, message });
  } else if (existingConversation) {
    conversation = upsertConversation({
      botId,
      agentId: binding?.agentId || "",
      conversationKey,
      message
    });
  }
  const dateTags = applySystemDateTag({
    botId,
    binding,
    conversationKey,
    firstSeenAt: entryAnchorAt || conversation.createdAt
  });
  if (dateTags) {
    logInfo("friend_added.date_tag.applied", {
      ...logContext,
      conversationKey,
      agentId: binding.agentId,
      trigger,
      tagCount: dateTags.length
    });
  }
  const machine = getFlowMachineForBot(botId);
  if (!machine?.enabled) {
    markConversationFriendAddedSignal({
      botId,
      conversationKey,
      occurredAt: entryAnchorAt
    });
    logInfo("friend_added.skipped", {
      ...logContext,
      friendName,
      conversationKey,
      trigger,
      reason: "no_enabled_flow_machine"
    });
    return "skipped";
  }
  const entryNode = getFlowNode(machine, machine.entryNodeId);
  const activation = normalizeActivationConfig(entryNode?.activation || {});
  const canScheduleActivation = activation.enabled && activation.messages.length > 0;
  const entryResult = beginFriendAddedFlowEntry({
    botId,
    conversationKey,
    machine,
    cooldownMs: friendAddedReentryCooldownMs,
    occurredAt: entryAnchorAt,
    forceReentry: Boolean(existingConversation),
    activationTask: canScheduleActivation
      ? {
          agentId: binding.agentId,
          activation,
          anchorAt: entryAnchorAt,
          dueAt: activationDueAtForAttempt(entryAnchorAt, activation.messages[0].intervalMinutes, 1)
        }
      : null
  });
  markConversationFriendAddedSignal({
    botId,
    conversationKey,
    occurredAt: entryAnchorAt
  });
  if (entryResult.status === "cooldown") {
    logInfo("friend_added.skipped", {
      ...logContext,
      friendName,
      conversationKey,
      trigger,
      reason: "friend_added_cooldown"
    });
    return "skipped";
  }
  if (entryResult.status === "duplicate") {
    logInfo("friend_added.skipped", {
      ...logContext,
      friendName,
      conversationKey,
      trigger,
      reason: "friend_added_duplicate"
    });
    return "skipped";
  }
  if (!canScheduleActivation) {
    logInfo("friend_added.skipped", {
      ...logContext,
      friendName,
      conversationKey,
      trigger,
      entryStatus: entryResult.status,
      reason: "entry_activation_not_configured"
    });
    return entryResult.status;
  }

  const task = entryResult.task;
  logInfo("friend_added.activation.scheduled", {
    ...logContext,
    friendName,
    conversationKey,
    trigger,
    entryStatus: entryResult.status,
    activationTaskId: task?.id || "",
    nodeId: task?.nodeId || entryResult.session.currentNodeId,
    dueAt: task?.dueAt || ""
  });
  return task ? "scheduled" : "skipped";
}

function commandCallbackLogFields({ botId, payload, outgoingMatched = false }) {
  const successList = Array.isArray(payload?.successList) ? payload.successList : [];
  const failList = Array.isArray(payload?.failList) ? payload.failList : [];
  return {
    botId,
    messageId: payload?.messageId || "",
    errorCode: payload?.errorCode ?? null,
    errorReason: payload?.errorReason || payload?.errorMsg || "",
    type: payload?.type ?? null,
    successCount: successList.length,
    failCount: failList.length,
    successList,
    failList,
    timeCost: payload?.timeCost ?? null,
    runTime: payload?.runTime ?? null,
    outgoingMatched
  };
}

async function handleDebugPing({ botId, message, conversationKey }) {
  const config = getDebugReplyConfig(botId);
  if (!config.enabled) return false;
  const spoken = String(message.spoken || "").trim().toLowerCase();
  const trigger = String(config.trigger || "ping").trim().toLowerCase();
  if (!trigger || spoken !== trigger) return false;

  const target = getReplyTarget(message);
  if (!target) return true;

  const content = String(config.reply || "pong");
  const result = await sendTextMessage({
    robotId: botId,
    targets: [target],
    content
  });
  insertOutgoingMessage({
    botId,
    conversationKey,
    targetName: target,
    content,
    messageId: result.data,
    worktoolResponse: result
  });
  return true;
}

function normalizeProactiveTargets(targets) {
  if (!Array.isArray(targets)) return [];
  const seen = new Set();
  return targets
    .map((target) => {
      if (typeof target === "string") {
        return { targetType: "private", targetName: target.trim() };
      }
      return {
        targetType: target.targetType === "group" ? "group" : "private",
        targetName: String(target.targetName || target.name || "").trim()
      };
    })
    .filter((target) => target.targetName)
    .filter((target) => {
      const key = `${target.targetType}:${target.targetName}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeMessageType(value) {
  if (["text", "media"].includes(value)) return value;
  return "text";
}

function fileTypeLabel(fileType) {
  return {
    image: "图片",
    file: "文件",
    video: "视频",
    audio: "音频",
    0: "图片",
    1: "文件",
    2: "视频",
    3: "音频"
  }[String(fileType)] || "媒体";
}

function detectFileTypeFromName(name) {
  const ext = String(name || "").split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "heif"].includes(ext)) {
    return "image";
  }
  if (["mp4", "mov", "m4v", "avi", "mkv", "webm", "flv", "wmv"].includes(ext)) {
    return "video";
  }
  if (["mp3", "wav", "m4a", "aac", "flac", "ogg", "amr", "wma"].includes(ext)) {
    return "audio";
  }
  return "file";
}

function fileNameFromUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return normalizeUploadedFilename(decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || ""));
  } catch {
    return "";
  }
}

function normalizeProactiveAttachments(body) {
  const rawAttachments = Array.isArray(body.attachments) ? body.attachments : [];
  const legacyAttachment = body.fileUrl
    ? [{
      fileUrl: body.fileUrl,
      objectName: body.objectName,
      fileType: body.fileType
    }]
    : [];
  const attachments = (rawAttachments.length ? rawAttachments : legacyAttachment)
    .map((attachment) => {
      const fileUrl = String(attachment.fileUrl || attachment.url || "").trim();
      if (!fileUrl) return null;
      const objectName = normalizeUploadedFilename(attachment.objectName || attachment.name) || fileNameFromUrl(fileUrl);
      return {
        fileUrl,
        objectName,
        fileType: String(attachment.fileType || attachment.type || detectFileTypeFromName(objectName || fileUrl)).trim()
      };
    })
    .filter(Boolean);
  if (attachments.length > 5) throw new Error("attachments supports up to 5 files");
  return attachments;
}

function normalizeProactiveMessage(body) {
  const attachments = normalizeProactiveAttachments(body);
  const messageType = normalizeMessageType(body.messageType || (attachments.length ? "media" : "text"));
  if (messageType === "media") {
    const payload = {
      extraText: String(body.extraText || body.content || "").trim(),
      sendType: Number(body.sendType || 0)
    };
    if (!attachments.length) throw new Error("attachments is required");
    for (const [index, attachment] of attachments.entries()) {
      buildRawMediaCommand({
        targets: ["validate"],
        ...attachment,
        extraText: index === 0 ? payload.extraText : "",
        sendType: payload.sendType
      });
    }
    const firstAttachment = attachments[0];
    const messagePayload = { ...payload, attachments };
    Object.assign(messagePayload, firstAttachment);
    return {
      messageType,
      content: payload.extraText || attachments
        .map((attachment) => `${fileTypeLabel(attachment.fileType)}：${attachment.objectName || attachment.fileUrl}`)
        .join("\n"),
      messagePayload
    };
  }

  const content = String(body.content || "").trim();
  if (!content) throw new Error("content is required");
  return {
    messageType: "text",
    content,
    messagePayload: { content }
  };
}

function normalizeProactiveScheduledAt(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(raw);
  if (!match) {
    const error = new Error("scheduledAt must use Asia/Shanghai (UTC+8) time in YYYY-MM-DDTHH:mm format");
    error.status = 400;
    throw error;
  }
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  ) {
    const error = new Error("scheduledAt is not a valid Beijing date and time");
    error.status = 400;
    throw error;
  }
  const scheduledAt = new Date(Date.UTC(year, month - 1, day, hour - 8, minute));
  if (scheduledAt.getTime() <= Date.now()) {
    const error = new Error("scheduledAt must be later than now");
    error.status = 400;
    throw error;
  }
  return scheduledAt.toISOString();
}

function proactiveTagFiltersFromRequest(req) {
  const raw = req.query.tagFilters;
  if (raw) {
    try {
      const parsed = JSON.parse(String(raw));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      const error = new Error("tagFilters must be valid JSON");
      error.status = 400;
      throw error;
    }
  }
  if (!req.query.tagId) return [];
  return [{
    tagType: String(req.query.tagType || "normal"),
    groupId: String(req.query.groupId || ""),
    tagId: String(req.query.tagId || "")
  }];
}

function buildCommandForTarget(target) {
  const payload = target.messagePayload || {};
  if (target.messageType === "media") {
    return buildRawMediaCommand({
      targets: [target.targetName],
      ...payload
    });
  }
  return null;
}

async function sendProactiveTargetMediaAttachments(target) {
  const payload = target.messagePayload || {};
  const attachments = Array.isArray(payload.attachments) && payload.attachments.length
    ? payload.attachments
    : [payload];
  const results = [];
  for (const [index, attachment] of attachments.entries()) {
    const result = await sendRawCommand({
      robotId: target.botId,
      command: buildRawMediaCommand({
        targets: [target.targetName],
        ...attachment,
        extraText: index === 0 ? payload.extraText : "",
        sendType: payload.sendType
      })
    });
    results.push(result);
  }
  return results;
}

function getProactiveConversationKey(target) {
  return `${target.botId}:${target.targetType === "group" ? "group" : "private"}:${target.targetName}`;
}

function buildProactiveConversationMessage(target) {
  const isGroup = target.targetType === "group";
  return {
    roomType: isGroup ? 1 : 2,
    receivedName: isGroup ? "" : target.targetName,
    groupName: isGroup ? target.targetName : ""
  };
}

function proactiveConversationContent(target) {
  if (target.messageType !== "media") return target.content || "";
  const payload = target.messagePayload || {};
  const attachments = Array.isArray(payload.attachments) && payload.attachments.length
    ? payload.attachments
    : [payload];
  const parts = attachments.map((attachment) => {
    const label = fileTypeLabel(attachment.fileType || "media");
    return `[${label}] ${attachment.objectName || attachment.fileUrl || ""}`.trim();
  });
  if (payload.extraText) parts.push(payload.extraText);
  return parts.filter(Boolean).join("\n");
}

async function syncProactiveTargetToAgent({ target, messageId, worktoolResponse }) {
  const binding = getBotBinding(target.botId);
  if (!binding || !binding.enabled) {
    markProactiveTargetAgentSync({
      id: target.id,
      status: "skipped",
      error: "no enabled DClaw binding"
    });
    return;
  }

  const conversationKey = getProactiveConversationKey(target);
  const conversation = upsertConversation({
    botId: target.botId,
    agentId: binding.agentId,
    conversationKey,
    message: buildProactiveConversationMessage(target)
  });
  const request = buildDclawProactiveEventRequest({
    binding,
    conversation,
    target,
    worktoolMessageId: messageId,
    worktoolResponse,
    generalRule: getFlowMachineForBot(target.botId)?.config?.generalRule || ""
  });
  const invocationId = insertAgentInvocationStart({
    botId: target.botId,
    agentId: binding.agentId,
    conversationKey,
    incomingMessageId: `proactive:${target.id}`,
    request
  });
  const startedAt = Date.now();
  markProactiveTargetAgentSync({ id: target.id, status: "syncing" });
  logInfo("proactive.agent_sync.start", {
    targetId: target.id,
    taskId: target.taskId,
    botId: target.botId,
    agentId: binding.agentId,
    conversationKey,
    invocationId
  });

  try {
    const invocation = await enqueueAgentInvocation(
      () => invokeDclawAgentWithRetry({
        binding,
        request,
        onRetry: (retry) => {
          logWarn("proactive.agent_sync.retry", {
            targetId: target.id,
            taskId: target.taskId,
            botId: target.botId,
            agentId: binding.agentId,
            conversationKey,
            invocationId,
            attempt: retry.attempt,
            maxAttempts: retry.maxAttempts,
            timeoutMs: retry.timeoutMs,
            error: retry.error.message
          });
        }
      }),
      { priority: "background", key: conversationKey }
    );
    finishAgentInvocation({
      id: invocationId,
      response: invocation.response,
      status: "success"
    });
    markProactiveTargetAgentSync({
      id: target.id,
      status: "synced",
      response: invocation.response
    });
    logInfo("proactive.agent_sync.success", {
      targetId: target.id,
      taskId: target.taskId,
      botId: target.botId,
      agentId: binding.agentId,
      conversationKey,
      invocationId,
      durationMs: Date.now() - startedAt,
      replyLength: String(invocation.reply || "").trim().length,
      sessionId: invocation.sessionId || ""
    });
  } catch (error) {
    finishAgentInvocation({
      id: invocationId,
      response: null,
      status: "failed",
      error: error.message
    });
    markProactiveTargetAgentSync({
      id: target.id,
      status: "failed",
      error: error.message
    });
    logWarn("proactive.agent_sync.failed", {
      targetId: target.id,
      taskId: target.taskId,
      botId: target.botId,
      agentId: binding.agentId,
      conversationKey,
      invocationId,
      durationMs: Date.now() - startedAt,
      error: error.message
    });
  }
}

function isStaleActivationTask(task) {
  const session = getFlowSession(task.conversationKey);
  return (
    !session ||
    session.handoffStatus === "human" ||
    session.currentNodeId !== task.nodeId ||
    Number(session.activationGeneration || 0) !== Number(task.generation || 0)
  );
}

function assertActivationTaskStillSendable(task) {
  if (!isFlowActivationTaskProcessing({ id: task.id }) || isStaleActivationTask(task)) {
    const error = new Error("stale_activation_task");
    error.code = "STALE_ACTIVATION_TASK";
    throw error;
  }
}

function recordActivationOutbound({ task, binding, target, content, result, rawPayload = {} }) {
  insertConversationMessage({
    botId: task.botId,
    conversationKey: task.conversationKey,
    direction: "outbound",
    senderName: binding?.botName || binding?.agentName || "机器人",
    content,
    rawPayload: {
      source: "flow_activation",
      activationTaskId: task.id,
      attemptNumber: task.attemptNumber,
      nodeId: task.nodeId,
      messageId: result?.data || "",
      worktoolResponse: result || null,
      ...rawPayload
    }
  });
  insertOutgoingMessage({
    botId: task.botId,
    agentId: task.agentId || binding?.agentId || "",
    conversationKey: task.conversationKey,
    messageId: result?.data || "",
    targetName: target,
    content,
    worktoolResponse: {
      ...(result || {}),
      source: "flow_activation",
      activationTaskId: task.id,
      attemptNumber: task.attemptNumber
    }
  });
}

function activationDeliveryForTask(task) {
  const message = Array.isArray(task.messages)
    ? task.messages[Number(task.messageIndex || 0)] || {}
    : {};
  const mergedActivation = mergeInlineActions({
    content: message.content ?? task.messageContent ?? "",
    actions: message.actionsAfterSend || []
  });
  return {
    visibleActivationContent: mergedActivation.content,
    mergedActivationActions: mergedActivation.actions
  };
}

async function sendActivationRawMessages({ task, binding, delivery }) {
  const target = privateTargetNameFromConversationKey(task.conversationKey);
  if (!target) throw new Error("missing activation target");
  const visibleActivationContent = String(delivery?.visibleActivationContent || "").trim();
  assertActivationTaskStillSendable(task);
  if (!visibleActivationContent) return [];
  const result = await sendTextMessage({
    robotId: task.botId,
    targets: [target],
    content: visibleActivationContent
  });
  recordActivationOutbound({
    task,
    binding,
    target,
    content: visibleActivationContent,
    result,
    rawPayload: {
      polishByAgent: false,
      activationMessageIndex: task.messageIndex
    }
  });
  return [result.data || ""].filter(Boolean);
}

async function sendActivationPolishedMessage({ task, binding, delivery }) {
  const target = privateTargetNameFromConversationKey(task.conversationKey);
  if (!target) throw new Error("missing activation target");
  const activationMessage = String(delivery?.visibleActivationContent || "").trim();
  if (!activationMessage) {
    assertActivationTaskStillSendable(task);
    return [];
  }
  const machine = getFlowMachineForBot(task.botId);
  const session = getFlowSession(task.conversationKey);
  const conversation = getConversation(task.conversationKey);
  if (!conversation) throw new Error("missing activation conversation");
  const flow = machine && session
    ? {
        machine: {
          name: machine.name,
          version: machine.version,
          entryNodeId: machine.entryNodeId,
          generalRule: machine.config.generalRule || "",
          nodes: machine.config.nodes
        },
        session,
        currentNode: getFlowNode(machine, session.currentNodeId)
      }
    : null;
  const request = buildDclawActivationRequest({
    binding,
    conversation,
    task: {
      ...task,
      messages: [activationMessage]
    },
    flow
  });
  const invocationId = insertAgentInvocationStart({
    botId: task.botId,
    agentId: binding.agentId,
    conversationKey: task.conversationKey,
    incomingMessageId: `activation:${task.id}`,
    request
  });
  let strictInvocation;
  try {
    strictInvocation = await invokeStrictAgentReply({
      binding,
      request,
      queueKey: task.conversationKey,
      onRetry: (retry) => {
        logWarn("activation.agent.retry", {
          activationTaskId: task.id,
          botId: task.botId,
          agentId: binding.agentId,
          conversationKey: task.conversationKey,
          invocationId,
          attempt: retry.attempt,
          maxAttempts: retry.maxAttempts,
          timeoutMs: retry.timeoutMs,
          error: retry.error.message
        });
      },
      onFormatRetry: ({ rawReplyLength }) => {
        logWarn("activation.agent.format_retry", {
          activationTaskId: task.id,
          botId: task.botId,
          agentId: binding.agentId,
          conversationKey: task.conversationKey,
          invocationId,
          rawReplyLength
        });
      },
      onAttachmentSourceRetry: ({ rawReplyLength, issue }) => {
        logWarn("activation.agent.attachment_source_retry", {
          activationTaskId: task.id,
          botId: task.botId,
          agentId: binding.agentId,
          conversationKey: task.conversationKey,
          invocationId,
          rawReplyLength,
          issueCode: issue?.code || "",
          attachmentUrls: issue?.attachmentUrls || []
        });
      },
      onInvalidAttachmentSource: ({ rawReplyLength, issue }) => {
        logWarn("activation.agent.invalid_attachment_source", {
          activationTaskId: task.id,
          botId: task.botId,
          agentId: binding.agentId,
          conversationKey: task.conversationKey,
          invocationId,
          rawReplyLength,
          issueCode: issue?.code || "",
          attachmentUrls: issue?.attachmentUrls || []
        });
      },
      onValidationFailure: ({ attemptNumber, stage, retryRequested, errors, rawReply, rawReplyLength }) => {
        recordAgentResponseValidationFailures({
          invocationId,
          botId: task.botId,
          agentId: binding.agentId,
          conversationKey: task.conversationKey,
          incomingMessageId: `activation:${task.id}`,
          attemptNumber,
          stage,
          retryRequested,
          errors,
          rawReply
        });
        logWarn("activation.agent.validation_failed", {
          activationTaskId: task.id,
          botId: task.botId,
          agentId: binding.agentId,
          conversationKey: task.conversationKey,
          invocationId,
          attemptNumber,
          stage,
          retryRequested,
          rawReplyLength,
          errors: (errors || []).map((error) => ({
            type: error.type,
            path: error.path,
            message: error.message,
            line: error.line || null,
            column: error.column || null
          }))
        });
      },
      onLocalRepair: ({ attemptNumber, errors, rawReply, repairs }) => {
        recordAgentResponseLocalRepair({
          invocationId,
          botId: task.botId,
          agentId: binding.agentId,
          conversationKey: task.conversationKey,
          incomingMessageId: `activation:${task.id}`,
          eventPrefix: "activation.agent",
          attemptNumber,
          errors,
          rawReply,
          repairs
        });
      },
      onValidationRetryOutcome: ({ outcome, attemptNumber, error }) => {
        recordAgentValidationRetryOutcome({
          invocationId,
          botId: task.botId,
          agentId: binding.agentId,
          conversationKey: task.conversationKey,
          incomingMessageId: `activation:${task.id}`,
          eventPrefix: "activation.agent",
          outcome,
          attemptNumber,
          error
        });
      }
    });
  } catch (error) {
    finishAgentInvocation({
      id: invocationId,
      response: null,
      status: "failed",
      error: error.message
    });
    throw error;
  }
  if (!strictInvocation.agentReply.valid) {
    const sendabilityIssue = strictInvocation.agentReply.sendabilityIssue;
    const errorCode = sendabilityIssue ? "invalid_agent_attachment_source" : "invalid_agent_reply_format";
    finishAgentInvocation({
      id: invocationId,
      response: strictInvocation.invocation.response,
      status: "failed",
      error: errorCode
    });
    logWarn(sendabilityIssue ? "activation.agent.invalid_attachment_source" : "activation.agent.invalid_format", {
      activationTaskId: task.id,
      botId: task.botId,
      agentId: binding.agentId,
      conversationKey: task.conversationKey,
      invocationId,
      formatAttempts: strictInvocation.formatAttempts,
      attachmentSourceAttempts: strictInvocation.attachmentSourceAttempts,
      issueCode: sendabilityIssue?.code || "",
      attachmentUrls: sendabilityIssue?.attachmentUrls || []
    });
    throw new Error(errorCode);
  }
  const invocation = strictInvocation.invocation;
  const agentReply = strictInvocation.agentReply;
  finishAgentInvocation({
    id: invocationId,
    response: invocation.response,
    status: "success"
  });
  const reply = String(agentReply.reply || "").trim();
  if (!reply) {
    throw new Error("empty activation reply");
  }
  assertActivationTaskStillSendable(task);
  const result = await sendTextMessage({
    robotId: task.botId,
    targets: [target],
    content: reply
  });
  recordActivationOutbound({
    task,
    binding,
    target,
    content: reply,
    result,
    rawPayload: {
      polishByAgent: true,
      flowActivationMessages: [activationMessage],
      agentReply: agentReply.raw
    }
  });
  return [result.data || ""].filter(Boolean);
}

async function processFlowActivationTask(task) {
  if (isStaleActivationTask(task)) {
    markFlowActivationTaskFailed({ id: task.id, error: "stale_activation_task" });
    logInfo("activation.stale_skipped", {
      activationTaskId: task.id,
      botId: task.botId,
      conversationKey: task.conversationKey,
      nodeId: task.nodeId,
      generation: task.generation
    });
    return;
  }
  const binding = getBotBinding(task.botId);
  if (!binding || !binding.enabled) {
    markFlowActivationTaskFailed({ id: task.id, error: "no enabled DClaw binding" });
    return;
  }

  try {
    const activationDelivery = activationDeliveryForTask(task);
    const { mergedActivationActions } = activationDelivery;
    const worktoolMessageIds = task.polishByAgent
      ? await sendActivationPolishedMessage({ task, binding, delivery: activationDelivery })
      : await sendActivationRawMessages({ task, binding, delivery: activationDelivery });
    const delivery = finalizeFlowActivationTaskDelivery({ id: task.id, worktoolMessageIds });
    if (!delivery) {
      logInfo("activation.stale_skipped", {
        activationTaskId: task.id,
        botId: task.botId,
        conversationKey: task.conversationKey,
        nodeId: task.nodeId,
        generation: task.generation,
        reason: "task_no_longer_processing_after_send"
      });
      return;
    }
    const { task: sentTask, progress } = delivery;
    if (!sentTask.wasCanceled) {
      await executeFlowActions({
        source: "activation_sent",
        botId: task.botId,
        binding,
        conversationKey: task.conversationKey,
        nodeId: task.nodeId,
        activationTaskId: String(task.id),
        actions: mergedActivationActions
      });
    }
    const session = getFlowSession(task.conversationKey);
    const nextTask = progress &&
      !sentTask.wasCanceled &&
      session?.currentNodeId === task.nodeId &&
      Number(session.activationGeneration || 0) === Number(task.generation || 0)
      ? scheduleCurrentActivation({
          botId: task.botId,
          binding,
          conversationKey: task.conversationKey,
          machine: getFlowMachineForBot(task.botId),
          session,
          anchorAt: sentTask.sentAt
        })
      : null;
    logInfo("activation.sent", {
      activationTaskId: task.id,
      nextActivationTaskId: nextTask?.id || "",
      botId: task.botId,
      agentId: binding.agentId,
      conversationKey: task.conversationKey,
      nodeId: task.nodeId,
      attemptNumber: task.attemptNumber,
      maxTimes: task.maxTimes,
      polishByAgent: task.polishByAgent,
      worktoolMessageIds
    });
  } catch (error) {
    const failedTask = markFlowActivationTaskFailed({ id: task.id, error: error.message });
    if (error.code === "STALE_ACTIVATION_TASK" || !failedTask) {
      logInfo("activation.stale_skipped", {
        activationTaskId: task.id,
        botId: task.botId,
        conversationKey: task.conversationKey,
        nodeId: task.nodeId,
        generation: task.generation,
        reason: error.code === "STALE_ACTIVATION_TASK" ? "stale_before_send" : "task_no_longer_processing"
      });
      return;
    }
    logWarn("activation.failed", {
      activationTaskId: task.id,
      botId: task.botId,
      conversationKey: task.conversationKey,
      nodeId: task.nodeId,
      attemptNumber: task.attemptNumber,
      error: error.message
    });
  }
}

async function processFlowActivationBatch() {
  if (!activationWorkerConfig.enabled || activationWorkerBusy) return;
  activationWorkerBusy = true;
  try {
    const nowDate = new Date();
    const staleBefore = new Date(nowDate.getTime() - activationWorkerConfig.staleProcessingMs).toISOString();
    const tasks = claimDueFlowActivationTasks({
      limit: activationWorkerConfig.batchSize,
      nowIso: nowDate.toISOString(),
      staleBeforeIso: staleBefore
    });
    if (tasks.length) {
      logInfo("activation.worker.claimed", {
        count: tasks.length,
        batchSize: activationWorkerConfig.batchSize,
        maxConcurrentAgentCalls: activationWorkerConfig.maxConcurrentAgentCalls
      });
    }
    for (const task of tasks) {
      await processFlowActivationTask(task);
    }
  } finally {
    activationWorkerBusy = false;
  }
}

function isTagStillActiveForTask(task) {
  return listConversationTags({
    botId: task.botId,
    agentId: task.agentId,
    conversationKey: task.conversationKey
  }).some((tag) => tag.groupId === task.groupId && tag.tagId === task.tagId);
}

function recordTagActivationOutbound({ task, binding, target, content, result, rawPayload = {} }) {
  insertConversationMessage({
    botId: task.botId,
    conversationKey: task.conversationKey,
    direction: "outbound",
    senderName: binding.botName || binding.agentName || "机器人",
    content,
    rawPayload: {
      source: "tag_activation",
      tagActivationTaskId: task.id,
      groupId: task.groupId,
      tagId: task.tagId,
      messageId: result?.data || "",
      worktoolResponse: result || null,
      ...rawPayload
    }
  });
  insertOutgoingMessage({
    botId: task.botId,
    agentId: task.agentId || binding.agentId || "",
    conversationKey: task.conversationKey,
    messageId: result?.data || "",
    targetName: target,
    content,
    worktoolResponse: {
      ...(result || {}),
      source: "tag_activation",
      tagActivationTaskId: task.id,
      groupId: task.groupId,
      tagId: task.tagId
    }
  });
}

async function buildPolishedTagActivationContent({ binding, task }) {
  const conversation = getConversation(task.conversationKey);
  if (!conversation) throw new Error("missing tag activation conversation");
  const request = buildDclawTagActivationRequest({
    binding,
    conversation,
    task,
    generalRule: getFlowMachineForBot(task.botId)?.config?.generalRule || ""
  });
  const invocationId = insertAgentInvocationStart({
    botId: task.botId,
    agentId: binding.agentId,
    conversationKey: task.conversationKey,
    incomingMessageId: `tag_activation:${task.id}`,
    request
  });
  let strictInvocation;
  try {
    strictInvocation = await invokeStrictAgentReply({
      binding,
      request,
      queueKey: task.conversationKey,
      onRetry: (retry) => {
        logWarn("tag.activation.agent.retry", {
          tagActivationTaskId: task.id,
          botId: task.botId,
          agentId: binding.agentId,
          conversationKey: task.conversationKey,
          invocationId,
          attempt: retry.attempt,
          maxAttempts: retry.maxAttempts,
          timeoutMs: retry.timeoutMs,
          error: retry.error.message
        });
      },
      onFormatRetry: ({ rawReplyLength }) => {
        logWarn("tag.activation.agent.format_retry", {
          tagActivationTaskId: task.id,
          botId: task.botId,
          agentId: binding.agentId,
          conversationKey: task.conversationKey,
          invocationId,
          rawReplyLength
        });
      },
      onAttachmentSourceRetry: ({ rawReplyLength, issue }) => {
        logWarn("tag.activation.agent.attachment_source_retry", {
          tagActivationTaskId: task.id,
          botId: task.botId,
          agentId: binding.agentId,
          conversationKey: task.conversationKey,
          invocationId,
          rawReplyLength,
          issueCode: issue?.code || "",
          attachmentUrls: issue?.attachmentUrls || []
        });
      },
      onInvalidAttachmentSource: ({ rawReplyLength, issue }) => {
        logWarn("tag.activation.agent.invalid_attachment_source", {
          tagActivationTaskId: task.id,
          botId: task.botId,
          agentId: binding.agentId,
          conversationKey: task.conversationKey,
          invocationId,
          rawReplyLength,
          issueCode: issue?.code || "",
          attachmentUrls: issue?.attachmentUrls || []
        });
      },
      onValidationFailure: ({ attemptNumber, stage, retryRequested, errors, rawReply, rawReplyLength }) => {
        recordAgentResponseValidationFailures({
          invocationId,
          botId: task.botId,
          agentId: binding.agentId,
          conversationKey: task.conversationKey,
          incomingMessageId: `tag_activation:${task.id}`,
          attemptNumber,
          stage,
          retryRequested,
          errors,
          rawReply
        });
        logWarn("tag.activation.agent.validation_failed", {
          tagActivationTaskId: task.id,
          botId: task.botId,
          agentId: binding.agentId,
          conversationKey: task.conversationKey,
          invocationId,
          attemptNumber,
          stage,
          retryRequested,
          rawReplyLength,
          errors: (errors || []).map((error) => ({
            type: error.type,
            path: error.path,
            message: error.message,
            line: error.line || null,
            column: error.column || null
          }))
        });
      },
      onLocalRepair: ({ attemptNumber, errors, rawReply, repairs }) => {
        recordAgentResponseLocalRepair({
          invocationId,
          botId: task.botId,
          agentId: binding.agentId,
          conversationKey: task.conversationKey,
          incomingMessageId: `tag_activation:${task.id}`,
          eventPrefix: "tag.activation.agent",
          attemptNumber,
          errors,
          rawReply,
          repairs
        });
      },
      onValidationRetryOutcome: ({ outcome, attemptNumber, error }) => {
        recordAgentValidationRetryOutcome({
          invocationId,
          botId: task.botId,
          agentId: binding.agentId,
          conversationKey: task.conversationKey,
          incomingMessageId: `tag_activation:${task.id}`,
          eventPrefix: "tag.activation.agent",
          outcome,
          attemptNumber,
          error
        });
      }
    });
  } catch (error) {
    finishAgentInvocation({
      id: invocationId,
      response: null,
      status: "failed",
      error: error.message
    });
    throw error;
  }

  if (!strictInvocation.agentReply.valid) {
    const sendabilityIssue = strictInvocation.agentReply.sendabilityIssue;
    const errorCode = sendabilityIssue ? "invalid_agent_attachment_source" : "invalid_agent_reply_format";
    finishAgentInvocation({
      id: invocationId,
      response: strictInvocation.invocation.response,
      status: "failed",
      error: errorCode
    });
    logWarn(
      sendabilityIssue ? "tag.activation.agent.invalid_attachment_source" : "tag.activation.agent.invalid_format",
      {
        tagActivationTaskId: task.id,
        botId: task.botId,
        agentId: binding.agentId,
        conversationKey: task.conversationKey,
        invocationId,
        formatAttempts: strictInvocation.formatAttempts,
        attachmentSourceAttempts: strictInvocation.attachmentSourceAttempts,
        issueCode: sendabilityIssue?.code || "",
        attachmentUrls: sendabilityIssue?.attachmentUrls || []
      }
    );
    throw new Error(errorCode);
  }

  const reply = String(strictInvocation.agentReply.reply || "").trim();
  if (!reply) {
    finishAgentInvocation({
      id: invocationId,
      response: strictInvocation.invocation.response,
      status: "failed",
      error: "empty_tag_activation_reply"
    });
    logWarn("tag.activation.agent.empty_reply", {
      tagActivationTaskId: task.id,
      botId: task.botId,
      agentId: binding.agentId,
      conversationKey: task.conversationKey,
      invocationId,
      formatAttempts: strictInvocation.formatAttempts,
      attachmentSourceAttempts: strictInvocation.attachmentSourceAttempts
    });
    throw new Error("empty_tag_activation_reply");
  }

  finishAgentInvocation({
    id: invocationId,
    response: strictInvocation.invocation.response,
    status: "success"
  });
  return {
    content: reply,
    agentReply: strictInvocation.agentReply.raw
  };
}

async function processTagActivationTask(task) {
  if (!isTagStillActiveForTask(task)) {
    markTagActivationTaskFailed({ id: task.id, error: "stale_tag_activation_task" });
    logInfo("tag.activation.stale_skipped", {
      tagActivationTaskId: task.id,
      botId: task.botId,
      conversationKey: task.conversationKey,
      groupId: task.groupId,
      tagId: task.tagId
    });
    return;
  }
  const binding = getBotBinding(task.botId);
  if (!binding || binding.agentId !== task.agentId || !binding.enabled) {
    markTagActivationTaskFailed({ id: task.id, error: "agent_binding_changed" });
    return;
  }

  try {
    const managedGroup = getGroupByConversationKey({
      botId: task.botId,
      conversationKey: task.conversationKey
    });
    const target = managedGroup?.currentName
      || privateTargetNameFromConversationKey(task.conversationKey);
    if (!target) throw new Error("missing tag activation target");
    const configuredContent = String(task.messageContent || "").trim();
    if (!configuredContent) throw new Error("empty tag activation message");
    const polished = task.polishByAgent
      ? await buildPolishedTagActivationContent({ binding, task })
      : null;
    if (!isTagStillActiveForTask(task)) {
      const error = new Error("stale_tag_activation_task");
      error.code = "STALE_TAG_ACTIVATION_TASK";
      throw error;
    }
    const finalContent = polished?.content || configuredContent;
    const sendReservation = reserveTagActivationTaskForSend({ id: task.id });
    if (!sendReservation.task) {
      const reason = sendReservation.skippedReason || "stale_tag_activation_task";
      const error = new Error(reason);
      error.code = reason === "stale_tag_activation_task"
        ? "STALE_TAG_ACTIVATION_TASK"
        : "CANCELED_TAG_ACTIVATION_TASK";
      throw error;
    }
    const result = await sendTextMessage({ robotId: task.botId, targets: [target], content: finalContent });
    const sentTask = markTagActivationTaskSent({
      id: task.id,
      worktoolMessageIds: [result.data || ""].filter(Boolean)
    });
    recordTagActivationOutbound({
      task,
      binding,
      target,
      content: finalContent,
      result,
      rawPayload: {
        polishByAgent: task.polishByAgent,
        configuredMessage: configuredContent,
        agentReply: polished?.agentReply || null
      }
    });
    logInfo("tag.activation.sent", {
      tagActivationTaskId: task.id,
      botId: task.botId,
      agentId: binding.agentId,
      conversationKey: task.conversationKey,
      groupId: task.groupId,
      tagId: task.tagId,
      polishByAgent: task.polishByAgent,
      worktoolMessageId: result.data || ""
    });
    if (sentTask && isTagStillActiveForTask(task)) {
      const nextTask = scheduleNextTagActivationTask({
        task,
        sentAt: sentTask.sentAt || new Date().toISOString()
      });
      if (nextTask) {
        logInfo("tag.activation.next_scheduled", {
          tagActivationTaskId: nextTask.id,
          previousTagActivationTaskId: task.id,
          botId: task.botId,
          agentId: binding.agentId,
          conversationKey: task.conversationKey,
          groupId: task.groupId,
          tagId: task.tagId,
          dueAt: nextTask.dueAt,
          attemptNumber: nextTask.attemptNumber,
          messageIndex: nextTask.messageIndex
        });
      }
    }
  } catch (error) {
    markTagActivationTaskFailed({ id: task.id, error: error.message });
    if (error.code === "STALE_TAG_ACTIVATION_TASK") {
      logInfo("tag.activation.stale_skipped", {
        tagActivationTaskId: task.id,
        botId: task.botId,
        conversationKey: task.conversationKey,
        groupId: task.groupId,
        tagId: task.tagId,
        reason: "stale_before_send"
      });
      return;
    }
    if (error.code === "CANCELED_TAG_ACTIVATION_TASK") {
      logInfo("tag.activation.canceled_skipped", {
        tagActivationTaskId: task.id,
        botId: task.botId,
        conversationKey: task.conversationKey,
        groupId: task.groupId,
        tagId: task.tagId,
        reason: error.message
      });
      return;
    }
    logWarn("tag.activation.failed", {
      tagActivationTaskId: task.id,
      botId: task.botId,
      conversationKey: task.conversationKey,
      groupId: task.groupId,
      tagId: task.tagId,
      error: error.message
    });
  }
}

async function processTagActivationBatch() {
  if (!tagActivationWorkerConfig.enabled || tagActivationWorkerBusy) return;
  tagActivationWorkerBusy = true;
  try {
    const nowDate = new Date();
    const staleBefore = new Date(nowDate.getTime() - tagActivationWorkerConfig.staleProcessingMs).toISOString();
    const tasks = claimDueTagActivationTasks({
      limit: tagActivationWorkerConfig.batchSize,
      nowIso: nowDate.toISOString(),
      staleBeforeIso: staleBefore
    });
    if (tasks.length) {
      logInfo("tag.activation.worker.claimed", {
        count: tasks.length,
        batchSize: tagActivationWorkerConfig.batchSize,
        maxConcurrentAgentCalls: tagActivationWorkerConfig.maxConcurrentAgentCalls
      });
    }
    for (const task of tasks) {
      await processTagActivationTask(task);
      if (tagActivationWorkerConfig.sendDelayMs > 0) {
        await delay(tagActivationWorkerConfig.sendDelayMs);
      }
    }
  } finally {
    tagActivationWorkerBusy = false;
  }
}

async function processNextProactiveTarget() {
  if (!proactiveWorkerConfig.enabled || proactiveWorkerBusy) return;
  proactiveWorkerBusy = true;
  try {
    const target = claimNextProactiveTarget({ nowIso: new Date().toISOString() });
    if (!target) return;

    try {
      const mediaResults = [];
      const result = target.messageType === "text"
        ? await sendTextMessage({
          robotId: target.botId,
          targets: [target.targetName],
          content: target.content
        })
        : (mediaResults.push(...await sendProactiveTargetMediaAttachments(target)), mediaResults[0]);
      const worktoolMessageIds = target.messageType === "media"
        ? mediaResults.map((item) => item?.data || "").filter(Boolean)
        : [result?.data].filter(Boolean);
      markProactiveTargetSent({
        id: target.id,
        messageId: worktoolMessageIds[0] || "",
        worktoolResponse: result
      });
      const conversationKey = getProactiveConversationKey(target);
      const binding = getBotBinding(target.botId);
      if (binding) {
        const flowMachine = getFlowMachineForBot(target.botId);
        upsertConversation({
          botId: target.botId,
          agentId: binding.agentId,
          conversationKey,
          message: buildProactiveConversationMessage(target)
        });
        if (target.targetType === "group") {
          getOrCreateConversationSession({
            botId: target.botId,
            conversationKey
          });
          touchFlowSession(conversationKey);
        } else if (flowMachine?.enabled) {
          getOrCreateFlowSession({
            botId: target.botId,
            conversationKey,
            machine: flowMachine.config
          });
          touchFlowSession(conversationKey);
        }
      }
      insertConversationMessage({
        botId: target.botId,
        conversationKey,
        direction: "outbound",
        senderName: binding?.botName || binding?.agentName || "机器人",
        content: proactiveConversationContent(target),
        rawPayload: {
          source: "proactive",
          messageId: worktoolMessageIds[0] || "",
          messageIds: worktoolMessageIds,
          messageType: target.messageType,
          messagePayload: target.messagePayload || {},
          worktoolResponse: result,
          worktoolResponses: target.messageType === "media" ? mediaResults : [result]
        }
      });
      insertOutgoingMessage({
        botId: target.botId,
        agentId: target.agentId || "",
        conversationKey,
        messageId: worktoolMessageIds[0] || "",
        targetName: target.targetName,
        content: target.content,
        worktoolResponse: result
      });
      void syncProactiveTargetToAgent({
        target,
        messageId: worktoolMessageIds[0] || "",
        worktoolResponse: result
      });
    } catch (error) {
      markProactiveTargetFailed({
        id: target.id,
        error: error.message,
        retry: target.attempts < proactiveWorkerConfig.maxAttempts
      });
    }
  } finally {
    proactiveWorkerBusy = false;
  }
}

if (proactiveWorkerConfig.enabled) {
  setInterval(() => {
    void processNextProactiveTarget().catch((error) => {
      logError("proactive.worker.failed", { error });
    });
  }, proactiveWorkerConfig.intervalMs).unref();
}

if (activationWorkerConfig.enabled) {
  setInterval(() => {
    void processFlowActivationBatch().catch((error) => {
      logError("activation.worker.failed", { error });
    });
  }, activationWorkerConfig.intervalMs).unref();
}

if (tagActivationWorkerConfig.enabled) {
  setInterval(() => {
    void processTagActivationBatch().catch((error) => {
      logError("tag.activation.worker.failed", { error });
    });
  }, tagActivationWorkerConfig.intervalMs).unref();
}

const disabledLegacyConditionalTaskCount = disableLegacyConditionalTasksWithoutCondition();
if (disabledLegacyConditionalTaskCount > 0) {
  logWarn("group_automation.legacy_conditional_tasks_disabled", {
    taskCount: disabledLegacyConditionalTaskCount,
    reason: "needs_condition"
  });
}

if (groupAutomationWorkerConfig.enabled) {
  const groupAutomationOwner = `group-automation:${process.pid}:${crypto.randomUUID()}`;
  void groupAutomationWorker.recoverExpiredLeases({
    owner: groupAutomationOwner,
    limit: groupAutomationWorkerConfig.batchSize
  }).catch((error) => {
    logError("group_automation.recovery_failed", { error });
  });
  setInterval(() => {
    void groupAutomationWorker.runOccurrenceTick({
      owner: groupAutomationOwner,
      limit: groupAutomationWorkerConfig.batchSize
    }).catch((error) => {
      logError("group_automation.occurrence.worker_failed", { error });
    });
  }, groupAutomationWorkerConfig.occurrenceIntervalMs).unref();
}

function ingestIncomingMessage({ botId, message }) {
  const friendAddedSignal = resolveFriendAddedSignal(message);
  const routingMessage = friendAddedSignal?.message || message;
  const { conversationKey, group } = resolveInboundConversation({
    botId,
    message: routingMessage
  });
  const messageKey = buildMessageKey({ botId, conversationKey, message });
  // Keep every WorkTool callback for audit and recovery, including callbacks
  // that are later recognized as duplicates for business processing.
  insertIncomingMessage({ botId, conversationKey, payload: message });
  cockpitEventRecorder.record({
    botId,
    conversationKey,
    customerKey: routingMessage.receivedName || routingMessage.friendName || "",
    eventType: friendAddedSignal ? "friend_added" : "customer_message",
    sourceType: friendAddedSignal ? "friend_added" : "incoming_message",
    sourceId: messageKey,
    occurredAt: new Date().toISOString(),
    payload: {
      roomType: routingMessage.roomType,
      textType: routingMessage.textType
    }
  });
  const accepted = beginMessageProcessing({
    messageKey,
    botId,
    conversationKey,
    messageId: message.messageId
  });
  return { conversationKey, messageKey, accepted, group, friendAddedSignal };
}

async function processIncomingMessage({ botId, message, intake = null }) {
  const startedAt = Date.now();
  const binding = getBotBinding(botId);
  const received = intake || ingestIncomingMessage({ botId, message });
  const {
    conversationKey,
    messageKey,
    group = null,
    friendAddedSignal = null
  } = received;
  const baseLog = messageLogFields({ botId, conversationKey, message });
  const logContext = { ...baseLog, messageKey };
  const hadConversation = Boolean(getConversation(conversationKey));
  const hadFlowSession = Boolean(getFlowSession(conversationKey));
  const legacyCandidate = isLegacyCustomerCandidate({
    message,
    binding,
    hadConversation,
    hadFlowSession
  });
  const flowMachine = getFlowMachineForBot(botId);
  logInfo("incoming.received", logContext);

  if (!received.accepted) {
    logWarn("incoming.duplicate_skipped", logContext);
    return;
  }

  if (friendAddedSignal) {
    await handleFriendAddedEvent({
      botId,
      binding,
      message: friendAddedSignal.message,
      trigger: friendAddedSignal.trigger,
      logContext,
      conversationKey
    });
    logInfo("incoming.skipped", {
      ...logContext,
      trigger: friendAddedSignal.trigger,
      reason: "friend_added_signal"
    });
    finishMessageProcessing({ messageKey, status: "friend_added" });
    return;
  }

  let resetState = { resetPending: false };
  if (isPrivateMessage(message) && !hadConversation) {
    resetState = prepareConversationResetForNewActivity({
      botId,
      conversationKey
    });
  }

  // A private customer interaction cancels pending reminders even when the
  // payload cannot be passed to the Agent (for example an unsupported image).
  if (isPrivateMessage(message)) {
    invalidateFlowActivation({ conversationKey, reason: "customer_replied" });
  }

  const persisted = (isPrivateMessage(message) || isGroupMessage(message))
    ? persistInboundConversation({
        botId,
        binding,
        conversationKey,
        message,
        resetPending: resetState.resetPending,
        skipFirstSeenDateTag: legacyCandidate,
        managedGroup: group
      })
    : { conversation: null, messageRecord: null };

  if (!shouldProcessInboundForAgent(message)) {
    logInfo("incoming.skipped", {
      ...logContext,
      reason: "non_text_or_empty_message"
    });
    finishMessageProcessing({ messageKey, status: "skipped" });
    return;
  }

  const flowSession = getFlowSession(conversationKey);
  const isHumanHandoff = flowSession?.handoffStatus === "human";
  const coalesceKey = inboundCoalesceKey(botId, conversationKey);
  const groupPolicy = isGroupMessage(message)
    ? resolveInboundGroupPolicy({ botId, group, message })
    : { invokeAgent: shouldInvokeAgent(message, binding), reason: "private" };
  const joinsMentionedGroupBatch = (
    isGroupMessage(message)
    && groupPolicy.reason === "mention_required"
    && inboundCoalescer.has(coalesceKey)
  );
  if (!isHumanHandoff && !groupPolicy.invokeAgent && !joinsMentionedGroupBatch) {
    const status = groupPolicy.reason === "policy_never"
      ? "group_policy_never"
      : "group_mention_required";
    logInfo("incoming.skipped", {
      ...logContext,
      reason: status
    });
    finishMessageProcessing({ messageKey, status });
    return;
  }

  if (!binding || !binding.enabled) {
    logWarn("incoming.skipped", {
      ...logContext,
      reason: "no_enabled_dclaw_binding"
    });
    finishMessageProcessing({ messageKey, status: "skipped" });
    return;
  }

  const legacySession = flowSession;
  const shouldAwaitLegacySync = legacyCandidate || (
    legacySession?.customerOrigin === "legacy"
    && legacySession.historySyncStatus === "loading"
  );
  if (
    shouldAwaitLegacySync
    && flowMachine?.enabled
    && Array.isArray(flowMachine.config?.nodes)
    && flowMachine.config.nodes.some((node) => String(node?.id || "").trim())
  ) {
    await legacyCustomerHistory.prepareLegacyCustomer({
      botId,
      conversationKey,
      title: message.receivedName || "",
      machine: flowMachine
    });
  }

  const conversation = persisted.conversation || getConversation(conversationKey);
  const flow = buildFlowContext({ botId, conversationKey, message });
  const conversationReset = getConversationResetPending(conversationKey);
  if (isHumanHandoff) {
    const tagContext = buildTagContext({ binding, conversationKey, group });
    const tagEvidenceCandidates = buildTagEvidenceCandidates({
      items: [{
        message,
        conversationMessageId: persisted.messageRecord?.id
      }]
    });
    const request = buildDclawHandoffTranscriptRequest({
      binding,
      conversation,
      message,
      flow,
      tagContext,
      tagEvidenceCandidates,
      conversationReset,
      generalRule: getFlowMachineForBot(botId)?.config?.generalRule || ""
    });
    const invocationId = insertAgentInvocationStart({
      botId,
      agentId: binding.agentId,
      conversationKey,
      incomingMessageId: message.messageId,
      request
    });
    const handoffStartedAt = Date.now();
    logInfo("agent.handoff_sync.start", {
      ...logContext,
      agentId: binding.agentId,
      invocationId
    });

    try {
      const onRetry = (retry) => {
        logWarn("agent.handoff_sync.retry", {
          ...logContext,
          agentId: binding.agentId,
          invocationId,
          attempt: retry.attempt,
          maxAttempts: retry.maxAttempts,
          timeoutMs: retry.timeoutMs,
          error: retry.error.message
        });
      };
      let invocation;
      let agentReply = null;
      if (tagContext) {
        const strictInvocation = await invokeStrictAgentReply({
          binding,
          request,
          queueKey: conversationKey,
          onRetry,
          onValidationFailure: ({
            attemptNumber,
            stage,
            retryRequested,
            errors,
            rawReply
          }) => {
            recordAgentResponseValidationFailures({
              invocationId,
              botId,
              agentId: binding.agentId,
              conversationKey,
              incomingMessageId: message.messageId,
              attemptNumber,
              stage,
              retryRequested,
              errors,
              rawReply
            });
          },
          onLocalRepair: ({ attemptNumber, errors, rawReply, repairs }) => {
            recordAgentResponseLocalRepair({
              invocationId,
              botId,
              agentId: binding.agentId,
              conversationKey,
              incomingMessageId: message.messageId,
              eventPrefix: "agent.handoff_sync.reply",
              attemptNumber,
              errors,
              rawReply,
              repairs
            });
          },
          onValidationRetryOutcome: ({ outcome, attemptNumber, error }) => {
            recordAgentValidationRetryOutcome({
              invocationId,
              botId,
              agentId: binding.agentId,
              conversationKey,
              incomingMessageId: message.messageId,
              eventPrefix: "agent.handoff_sync.reply",
              outcome,
              attemptNumber,
              error
            });
          }
        });
        if (!strictInvocation.agentReply.valid) {
          const error = new Error("invalid_agent_reply_format");
          error.response = strictInvocation.invocation.response;
          throw error;
        }
        invocation = strictInvocation.invocation;
        agentReply = strictInvocation.agentReply;
      } else {
        invocation = await enqueueAgentInvocation(
          () => invokeDclawAgentWithRetry({ binding, request, onRetry }),
          { key: conversationKey }
        );
      }
      finishAgentInvocation({
        id: invocationId,
        response: invocation.response,
        status: "success"
      });
      persistAgentTagAudit({
        invocationId,
        botId,
        binding,
        conversationKey,
        incomingMessageId: message.messageId,
        agentReply
      });
      const tagResult = tagContext
        ? applyAgentTagDecision({
            botId,
            binding,
            conversationKey,
            agentReply,
            evidenceCandidates: tagEvidenceCandidates
          })
        : null;
      publishCommittedTagAlerts({ botId, invocationId, tagResult });
      if (conversationReset) {
        markConversationResetHandledForEpoch(
          conversationKey,
          conversation.conversationEpoch
        );
      }
      logInfo("agent.handoff_sync.success", {
        ...logContext,
        agentId: binding.agentId,
        invocationId,
        durationMs: Date.now() - handoffStartedAt,
        attempts: invocation.attempts || 1,
        timeoutMs: getDclawAgentTimeoutMs(),
        maxAttempts: getDclawAgentMaxAttempts(),
        sessionId: invocation.sessionId || "",
        acceptedTagCount: Number(tagResult?.accepted?.length || 0),
        rejectedTagCount: Number(tagResult?.rejected?.length || 0)
      });
    } catch (error) {
      finishAgentInvocation({
        id: invocationId,
        response: null,
        status: "failed",
        error: error.message
      });
      logWarn("agent.handoff_sync.failed", {
        ...logContext,
        agentId: binding.agentId,
        invocationId,
        durationMs: Date.now() - handoffStartedAt,
        error: error.message
      });
    }

    finishMessageProcessing({ messageKey, status: "human_handoff" });
    return;
  }

  if (await handleDebugPing({ botId, message, conversationKey })) {
    logInfo("incoming.debug_reply", logContext);
    finishMessageProcessing({ messageKey, status: "debug_replied" });
    return;
  }

  const replyWaitConfig = getReplyWaitConfig(botId);
  inboundCoalescer.push(coalesceKey, {
    botId,
    conversationKey,
    message,
    messageKey,
    groupReplyDecision: groupPolicy,
    conversationMessageId: persisted.messageRecord?.id,
    conversationMessageCreatedAt: persisted.messageRecord?.createdAt,
    acceptedAt: new Date().toISOString()
  }, {
    baseQuietMs: replyWaitConfig.baseSeconds * 1000,
    incrementMs: replyWaitConfig.incrementSeconds * 1000
  });
}

async function processCoalescedIncomingBatch(batch) {
  const startedAt = Date.now();
  const botId = batch.botId;
  const conversationKey = batch.conversationKey;
  const messages = batch.items.map((item) => item.message);
  let coalescedMessage = buildCoalescedAgentMessage(messages);
  let message = coalescedMessage;
  const messageKey = batch.items.at(-1)?.messageKey || "";
  const binding = getBotBinding(botId);
  const baseLog = messageLogFields({ botId, conversationKey, message });
  const logContext = {
    ...baseLog,
    messageKey,
    batchId: batch.id,
    coalescedMessageCount: batch.items.length,
    coalesceReason: batch.reason
  };
  if (!binding || !binding.enabled) {
    logWarn("incoming.skipped", {
      ...logContext,
      reason: "no_enabled_dclaw_binding_after_coalesce"
    });
    finishCoalescedMessageProcessing({ batch, status: "skipped" });
    return;
  }

  const conversation = getConversation(conversationKey);
  if (!conversation || conversation.botId !== botId) {
    logWarn("incoming.skipped", {
      ...logContext,
      reason: "conversation_removed_before_coalesce"
    });
    finishCoalescedMessageProcessing({ batch, status: "conversation_removed" });
    return;
  }
  const coalescedHandoffSession = getFlowSession(conversationKey);
  if (coalescedHandoffSession?.handoffStatus === "human") {
    logInfo("incoming.skipped", {
      ...logContext,
      reason: "human_handoff_after_coalesce"
    });
    finishCoalescedMessageProcessing({ batch, status: "human_handoff" });
    return;
  }
  const flow = buildFlowContext({ botId, conversationKey, message });
  const conversationReset = getConversationResetPending(conversationKey);

  const shouldScheduleLegacyHistoryAnalysis = shouldAnalyzeLegacyHistoryForSession(
    flow?.session
  );
  const historyAnalysisConfig = shouldScheduleLegacyHistoryAnalysis
    ? getHistoryAnalysisConfig(botId)
    : null;
  const legacyHistoryAnalysis = shouldScheduleLegacyHistoryAnalysis
    ? legacyCustomerHistory.buildStoredLegacyAnalysis({
        botId,
        conversationKey,
        maxChars: historyAnalysisConfig.historyCustomerTextMaxChars
      })
    : null;
  if (legacyHistoryAnalysis?.earliestCustomerAt) {
    ensureLegacyHistoryDateTag({
      botId,
      agentId: binding.agentId,
      conversationKey,
      firstSeenAt: legacyHistoryAnalysis.earliestCustomerAt
    });
  }
  if (shouldScheduleLegacyHistoryAnalysis) {
    logInfo("legacy_history.analysis_prepared", {
      ...logContext,
      agentId: binding.agentId,
      selectedCount: Number(legacyHistoryAnalysis?.selectedCount || 0),
      omittedCount: Number(legacyHistoryAnalysis?.omittedCount || 0),
      selectedChars: Number(legacyHistoryAnalysis?.selectedChars || 0),
      configuredLimit: Number(legacyHistoryAnalysis?.configuredLimit || 0),
      earliestCustomerAt: legacyHistoryAnalysis?.earliestCustomerAt || ""
    });
  }
  const managedGroup = isPrivateMessage(message)
    ? null
    : getGroupByConversationKey({ botId, conversationKey });
  const groupRoles = managedGroup
    ? listGroupRoles({ botId, groupId: managedGroup.id })
    : [];
  const groupTurns = managedGroup
    ? buildGroupAgentTurns({ items: batch.items, roles: groupRoles })
    : [];
  if (groupTurns.length) {
    const groupTurnText = formatGroupAgentTurns(groupTurns);
    coalescedMessage = {
      ...coalescedMessage,
      spoken: groupTurnText,
      rawSpoken: groupTurnText
    };
    message = coalescedMessage;
  }
  const groupReplyDecision = batch.items
    .map((item) => item.groupReplyDecision)
    .reverse()
    .find((decision) => decision?.invokeAgent) || null;
  const groupContext = managedGroup
    ? buildGroupAgentContext({
        group: managedGroup,
        roles: groupRoles,
        speakerName: message.receivedName,
        replyDecision: groupReplyDecision
      })
    : null;
  const tagContext = buildTagContext({
    binding,
    conversationKey,
    group: managedGroup
  });
  const tagEvidenceCandidates = buildTagEvidenceCandidates({
    items: batch.items
  });
  const agentMessage = normalizeMessageForAgent(
    coalescedMessage,
    binding,
    groupReplyDecision
  );
  const request = buildDclawRequest({
    binding,
    conversation,
    message: agentMessage,
    flow,
    tagContext,
    groupContext,
    groupTurns,
    tagEvidenceCandidates,
    legacyHistoryAnalysis: null,
    conversationReset,
    generalRule: getFlowMachineForBot(botId)?.config?.generalRule || ""
  });
  const invocationId = insertAgentInvocationStart({
    botId,
    agentId: binding.agentId,
    conversationKey,
    incomingMessageId: message.messageId,
    request
  });
  const agentStartedAt = Date.now();
  logInfo("agent.invoke.start", {
    ...logContext,
    agentId: binding.agentId,
    invocationId
  });

  let agentInvocationSucceeded = false;
  let sentParts = [];
  let sentAttachments = [];
  try {
    const strictInvocation = await invokeStrictAgentReply({
      binding,
      request,
      queueKey: conversationKey,
      onRetry: (retry) => {
        logWarn("agent.invoke.retry", {
          ...logContext,
          agentId: binding.agentId,
          invocationId,
          attempt: retry.attempt,
          maxAttempts: retry.maxAttempts,
          timeoutMs: retry.timeoutMs,
          error: retry.error.message
        });
      },
      onFormatRetry: ({ rawReplyLength }) => {
        logWarn("agent.reply.format_retry", {
          ...logContext,
          agentId: binding.agentId,
          invocationId,
          rawReplyLength
        });
      },
      onAttachmentSourceRetry: ({ rawReplyLength, issue }) => {
        logWarn("agent.reply.attachment_source_retry", {
          ...logContext,
          agentId: binding.agentId,
          invocationId,
          rawReplyLength,
          issueCode: issue?.code || "",
          attachmentUrls: issue?.attachmentUrls || []
        });
      },
      onInvalidAttachmentSource: ({ rawReplyLength, issue }) => {
        logWarn("agent.reply.invalid_attachment_source", {
          ...logContext,
          agentId: binding.agentId,
          invocationId,
          rawReplyLength,
          issueCode: issue?.code || "",
          attachmentUrls: issue?.attachmentUrls || []
        });
      },
      onValidationFailure: ({ attemptNumber, stage, retryRequested, errors, rawReply, rawReplyLength }) => {
        recordAgentResponseValidationFailures({
          invocationId,
          botId,
          agentId: binding.agentId,
          conversationKey,
          incomingMessageId: message.messageId,
          attemptNumber,
          stage,
          retryRequested,
          errors,
          rawReply
        });
        logWarn("agent.reply.validation_failed", {
          ...logContext,
          agentId: binding.agentId,
          invocationId,
          attemptNumber,
          stage,
          retryRequested,
          rawReplyLength,
          errors: (errors || []).map((error) => ({
            type: error.type,
            path: error.path,
            message: error.message,
            line: error.line || null,
            column: error.column || null
          }))
        });
      },
      onLocalRepair: ({ attemptNumber, errors, rawReply, repairs }) => {
        recordAgentResponseLocalRepair({
          invocationId,
          botId,
          agentId: binding.agentId,
          conversationKey,
          incomingMessageId: message.messageId,
          eventPrefix: "agent.reply",
          attemptNumber,
          errors,
          rawReply,
          repairs
        });
      },
      onValidationRetryOutcome: ({ outcome, attemptNumber, error }) => {
        recordAgentValidationRetryOutcome({
          invocationId,
          botId,
          agentId: binding.agentId,
          conversationKey,
          incomingMessageId: message.messageId,
          eventPrefix: "agent.reply",
          outcome,
          attemptNumber,
          error
        });
      }
    });

    if (!isConversationEpochCurrent({
      botId,
      conversationKey,
      expectedEpoch: conversation.conversationEpoch
    })) {
      finishAgentInvocation({
        id: invocationId,
        response: strictInvocation.invocation?.response || null,
        status: "stale",
        error: "conversation_epoch_changed"
      });
      logWarn("agent.reply.stale_skipped", {
        ...logContext,
        agentId: binding.agentId,
        invocationId,
        reason: "conversation_epoch_changed"
      });
      finishCoalescedMessageProcessing({ batch, status: "stale" });
      return;
    }

    if (!strictInvocation.agentReply.valid) {
      const sendabilityIssue = strictInvocation.agentReply.sendabilityIssue;
      const errorCode = sendabilityIssue ? "invalid_agent_attachment_source" : "invalid_agent_reply_format";
      logWarn(sendabilityIssue ? "agent.reply.invalid_attachment_source" : "agent.reply.invalid_format", {
        ...logContext,
        agentId: binding.agentId,
        invocationId,
        formatAttempts: strictInvocation.formatAttempts,
        attachmentSourceAttempts: strictInvocation.attachmentSourceAttempts,
        issueCode: sendabilityIssue?.code || "",
        attachmentUrls: sendabilityIssue?.attachmentUrls || []
      });
      const failure = new Error(errorCode);
      failure.errorType = errorCode;
      failure.response = strictInvocation.invocation.response;
      failure.rawReply = strictInvocation.invocation.reply || "";
      failure.attemptNumber = strictInvocation.formatAttempts;
      throw failure;
    }

    const invocation = strictInvocation.invocation;

    finishAgentInvocation({
      id: invocationId,
      response: invocation.response,
      status: "success"
    });
    agentInvocationSucceeded = true;
    if (conversationReset) {
      markConversationResetHandledForEpoch(
        conversationKey,
        conversation.conversationEpoch
      );
    }

    const agentReply = strictInvocation.agentReply;
    persistAgentTagAudit({
      invocationId,
      botId,
      binding,
      conversationKey,
      incomingMessageId: message.messageId,
      agentReply
    });
    const tagResult = tagContext
      ? applyAgentTagDecision({
          botId,
          binding,
          conversationKey,
          agentReply,
          evidenceCandidates: tagEvidenceCandidates
        })
      : null;
    publishCommittedTagAlerts({ botId, invocationId, tagResult });
    const reply = String(agentReply.reply || "").trim();
    const attachments = Array.isArray(agentReply.attachments) ? agentReply.attachments : [];
    const sources = Array.isArray(agentReply.sources) ? agentReply.sources : [];
    const replyWithLinkAttachments = appendLinkAttachmentsToReply(reply, attachments);
    const hasMediaAttachments = attachments
      .map(normalizeAgentAttachment)
      .some((attachment) => attachment && supportedAgentMediaTypes.has(attachment.type));
    logInfo("agent.invoke.success", {
      ...logContext,
      agentId: binding.agentId,
      invocationId,
      durationMs: Date.now() - agentStartedAt,
      replyLength: reply.length,
      attachmentCount: attachments.length,
      sourceCount: sources.length,
      attempts: invocation.attempts || 1,
      timeoutMs: getDclawAgentTimeoutMs(),
      maxAttempts: getDclawAgentMaxAttempts(),
      sessionId: invocation.sessionId || ""
    });
    if (!replyWithLinkAttachments && !hasMediaAttachments) {
      logWarn("agent.reply.empty", {
        ...logContext,
        agentId: binding.agentId,
        invocationId
      });
      finishCoalescedMessageProcessing({ batch, status: "empty_reply" });
      return;
    }
    if (looksLikeInternalNonReplyAnalysis(reply)) {
      logWarn("agent.reply.suppressed", {
        ...logContext,
        agentId: binding.agentId,
        invocationId,
        reason: "internal_non_reply_analysis"
      });
      finishCoalescedMessageProcessing({ batch, status: "suppressed" });
      return;
    }

    const target = getReplyTarget(message);
    if (!target) {
      throw new Error("missing WorkTool reply target");
    }
    if (!isConversationEpochCurrent({
      botId,
      conversationKey,
      expectedEpoch: conversation.conversationEpoch
    })) {
      finishAgentInvocation({
        id: invocationId,
        response: invocation.response || null,
        status: "stale",
        error: "conversation_epoch_changed"
      });
      logWarn("agent.reply.stale_skipped", {
        ...logContext,
        agentId: binding.agentId,
        invocationId,
        reason: "conversation_epoch_changed_before_send"
      });
      finishCoalescedMessageProcessing({ batch, status: "stale" });
      return;
    }

    sentParts = await sendTextReplyParts({
      robotId: botId,
      target,
      reply: replyWithLinkAttachments,
      allowSplit: isPrivateMessage(message) || replySplitConfig.splitGroup,
      beforeSend: () => assertConversationAiControlled({ botId, conversationKey })
    });
    sentAttachments = await sendAgentAttachments({
      robotId: botId,
      target,
      attachments,
      beforeSend: () => assertConversationAiControlled({ botId, conversationKey })
    });
    assertConversationAiControlled({ botId, conversationKey });
    const primaryResult = sentParts[0]?.result || {};
    const textMessageIds = sentParts.map((part) => part.result?.data || "").filter(Boolean);
    const attachmentMessageIds = sentAttachments.map((part) => part.result?.data || "").filter(Boolean);
    const worktoolMessageIds = [...textMessageIds, ...attachmentMessageIds].filter(Boolean);
    if (flow) {
      await applyFlowDecision({
        botId,
        binding,
        conversationKey,
        message,
        flow,
        decision: agentReply.flowDecision,
        fillOnlyMissing: false
      });
      insertConversationMessage({
        botId,
        conversationKey,
        direction: "outbound",
        senderName: binding.botName || binding.agentName || "机器人",
        content: replyWithLinkAttachments,
        rawPayload: {
          worktoolMessageId: worktoolMessageIds[0] || "",
          worktoolMessageIds,
          replyParts: sentParts.map((part) => part.content),
          attachments: sentAttachments.map((part) => part.attachment),
          sources,
          tags: listConversationTags({ botId, agentId: binding.agentId, conversationKey }),
          flowDecision: agentReply.flowDecision,
          agentReply: agentReply.raw
        }
      });
    } else if (shouldRecordConversationHistory(message)) {
      insertConversationMessage({
        botId,
        conversationKey,
        direction: "outbound",
        senderName: binding.botName || binding.agentName || "机器人",
        content: replyWithLinkAttachments,
        rawPayload: {
          worktoolMessageId: worktoolMessageIds[0] || "",
          worktoolMessageIds,
          replyParts: sentParts.map((part) => part.content),
          attachments: sentAttachments.map((part) => part.attachment),
          sources,
          tags: listConversationTags({ botId, agentId: binding.agentId, conversationKey }),
          agentReply: agentReply.raw
        }
      });
    }
    logInfo("worktool.send.success", {
      ...logContext,
      agentId: binding.agentId,
      invocationId,
      targetName: target,
      worktoolMessageId: worktoolMessageIds[0] || "",
      worktoolMessageIds,
      replyPartCount: sentParts.length,
      attachmentCount: sentAttachments.length,
      attachmentUrls: sentAttachments.map((part) => part.attachment?.url || "").filter(Boolean),
      worktoolCode: primaryResult.code ?? null,
      worktoolMessage: primaryResult.message || "",
      totalDurationMs: Date.now() - startedAt
    });
    for (const [index, part] of sentParts.entries()) {
      insertOutgoingMessage({
        botId,
        agentId: binding.agentId,
        conversationKey,
        messageId: part.result?.data || "",
        targetName: target,
        content: part.content,
        worktoolResponse: {
          ...(part.result || {}),
          replyPartIndex: index,
          replyPartCount: sentParts.length,
          originalReply: replyWithLinkAttachments
        }
      });
    }
    for (const [index, part] of sentAttachments.entries()) {
      insertOutgoingMessage({
        botId,
        agentId: binding.agentId,
        conversationKey,
        messageId: part.result?.data || "",
        targetName: target,
        content: part.attachment.url,
        worktoolResponse: {
          ...(part.result || {}),
          attachmentIndex: index,
          attachmentCount: sentAttachments.length,
          attachment: part.attachment
        }
      });
    }
    if (shouldScheduleLegacyHistoryAnalysis && legacyHistoryAnalysis?.text) {
      scheduleLegacyHistoryAnalysis({
        botId,
        binding,
        conversationKey,
        message,
        expectedEpoch: conversation.conversationEpoch
      });
    }
    const activationTask = scheduleActivationAfterFlowReply({
      botId,
      binding,
      conversationKey,
      flow,
      sentAt: new Date()
    });
    if (activationTask) {
      logInfo("activation.scheduled", {
        ...logContext,
        agentId: binding.agentId,
        invocationId,
        activationTaskId: activationTask.id,
        nodeId: activationTask.nodeId,
        attemptNumber: activationTask.attemptNumber,
        maxTimes: activationTask.maxTimes,
        dueAt: activationTask.dueAt
      });
    }
    finishCoalescedMessageProcessing({ batch, status: "coalesced_processed" });
  } catch (error) {
    if (error?.code === "HUMAN_HANDOFF_BEFORE_SEND") {
      const deliveredTextParts = error.sentTextParts || sentParts;
      const deliveredAttachments = error.sentAttachments || sentAttachments;
      const deliveredMessageIds = [
        ...deliveredTextParts.map((part) => part.result?.data || ""),
        ...deliveredAttachments.map((part) => part.result?.data || "")
      ].filter(Boolean);
      const deliveredContent = deliveredTextParts
        .map((part) => part.content)
        .filter(Boolean)
        .join("\n\n") || deliveredAttachments
        .map((part) => part.attachment?.url || "")
        .filter(Boolean)
        .join("\n");

      if (deliveredContent && shouldRecordConversationHistory(message)) {
        insertConversationMessage({
          botId,
          conversationKey,
          direction: "outbound",
          senderName: binding.botName || binding.agentName || "机器人",
          content: deliveredContent,
          rawPayload: {
            worktoolMessageId: deliveredMessageIds[0] || "",
            worktoolMessageIds: deliveredMessageIds,
            replyParts: deliveredTextParts.map((part) => part.content),
            attachments: deliveredAttachments.map((part) => part.attachment),
            sources: [],
            interruptedByHumanHandoff: true
          }
        });
      }
      for (const [index, part] of deliveredTextParts.entries()) {
        insertOutgoingMessage({
          botId,
          agentId: binding.agentId,
          conversationKey,
          messageId: part.result?.data || "",
          targetName: getReplyTarget(message),
          content: part.content,
          worktoolResponse: {
            ...(part.result || {}),
            replyPartIndex: index,
            replyPartCount: deliveredTextParts.length,
            interruptedByHumanHandoff: true
          }
        });
      }
      for (const [index, part] of deliveredAttachments.entries()) {
        insertOutgoingMessage({
          botId,
          agentId: binding.agentId,
          conversationKey,
          messageId: part.result?.data || "",
          targetName: getReplyTarget(message),
          content: part.attachment.url,
          worktoolResponse: {
            ...(part.result || {}),
            attachmentIndex: index,
            attachmentCount: deliveredAttachments.length,
            attachment: part.attachment,
            interruptedByHumanHandoff: true
          }
        });
      }
      logInfo("agent.reply.handoff_skipped", {
        ...logContext,
        agentId: binding.agentId,
        invocationId,
        sentReplyPartCount: deliveredTextParts.length,
        sentAttachmentCount: deliveredAttachments.length
      });
      finishCoalescedMessageProcessing({ batch, status: "human_handoff" });
      return;
    }
    if (!isConversationEpochCurrent({
      botId,
      conversationKey,
      expectedEpoch: conversation.conversationEpoch
    })) {
      if (!agentInvocationSucceeded) {
        finishAgentInvocation({
          id: invocationId,
          response: error.response || null,
          status: "stale",
          error: "conversation_epoch_changed"
        });
      }
      logWarn("agent.reply.stale_skipped", {
        ...logContext,
        agentId: binding.agentId,
        invocationId,
        reason: "conversation_epoch_changed_after_failure"
      });
      finishCoalescedMessageProcessing({ batch, status: "stale" });
      return;
    }
    if (!agentInvocationSucceeded) {
      finishAgentInvocation({
        id: invocationId,
        response: error.response || null,
        status: "failed",
        error: error.message
      });

      recordAgentFailure({
        invocationId,
        botId,
        agentId: binding?.agentId || "",
        conversationKey,
        incomingMessageId: message.messageId,
        error
      });

      try {
        const fallbackSent = await sendAgentFailureFallback({
          botId,
          binding,
          conversationKey,
          message,
          invocationId,
          logContext,
          error
        });
        if (fallbackSent) {
          finishCoalescedMessageProcessing({
            batch,
            status: "fallback_replied",
            error: error.message
          });
          return;
        }
      } catch (fallbackError) {
        recordAgentFailure({
          invocationId,
          botId,
          agentId: binding?.agentId || "",
          conversationKey,
          incomingMessageId: message.messageId,
          error: Object.assign(fallbackError, {
            errorType: "fallback_send"
          })
        });
        logError("agent.fallback_failed", {
          ...logContext,
          agentId: binding?.agentId || "",
          invocationId,
          originalError: error.message,
          error: fallbackError
        });
      }
    }
    finishCoalescedMessageProcessing({ batch, status: "failed", error: error.message });
    logError("incoming.failed", {
      ...logContext,
      agentId: binding?.agentId || "",
      invocationId,
      durationMs: Date.now() - startedAt,
      error
    });
    throw error;
  }
}

function manualTagGroupIdsForConversation({ botId, conversationKey }) {
  if (isPrivateConversationKey(conversationKey)) return null;
  const managedGroup = getGroupByConversationKey({ botId, conversationKey });
  return Array.isArray(managedGroup?.tagGroupIds)
    ? [...new Set(managedGroup.tagGroupIds.filter(Boolean))]
    : [];
}

function applyManualConversationTagChange({ botId, binding, conversationKey, groupId, tagId, action = "set" }) {
  if (!binding?.agentId) throw new Error("no enabled bot binding");
  const managedGroup = getGroupByConversationKey({ botId, conversationKey });
  if (
    !isPrivateConversationKey(conversationKey)
    && (!managedGroup || !managedGroup.tagGroupIds.includes(groupId))
  ) {
    const error = new Error("manual tag group is not enabled for this conversation");
    error.status = 400;
    throw error;
  }
  const schema = normalizeTagSchema(getAgentTagSchema(binding.agentId)?.config || {});
  const group = schema.groups.find((item) => item.id === groupId);
  const tag = group?.tags.find((item) => item.id === tagId);
  if (!group || !tag) throw new Error("tag not found");

  const normalizedAction = action === "remove" ? "remove" : "add";
  const currentTags = listConversationTags({ botId, agentId: binding.agentId, conversationKey });
  const decision = normalizedAction === "remove"
    ? { remove: [{ groupId, tagId, reason: "控制台手动移除标签" }] }
    : { add: [{ groupId, tagId, reason: "控制台手动打标签" }] };
  const result = adjudicateTagDecision({
    schema,
    currentTags: currentTags.filter((item) => item.tagType !== "date"),
    decision,
    ignoreOneWay: true
  });

  if (!result.accepted.length && result.rejected.length) {
    throw new Error(`tag change rejected: ${result.rejected[0].reason}`);
  }
  if (!result.accepted.length) {
    return {
      tags: currentTags,
      accepted: [],
      rejected: result.rejected,
      canceledTagActivationTaskCount: 0,
      scheduledTagActivationTasks: []
    };
  }

  const canceledTagActivationTaskCount = cancelTagTasksForAcceptedChanges({
    botId,
    binding,
    conversationKey,
    accepted: result.accepted
  });
  const tags = applyConversationTagChanges({
    botId,
    agentId: binding.agentId,
    conversationKey,
    accepted: result.accepted,
    rejected: result.rejected,
    nextTags: result.nextTags,
    source: "manual_tag"
  });
  const scheduledTagActivationTasks = scheduleTagActivationsForAcceptedChanges({
    botId,
    binding,
    conversationKey,
    accepted: result.accepted
  });
  logInfo("conversation.manual_tag.changed", {
    botId,
    agentId: binding.agentId,
    conversationKey,
    groupId,
    tagId,
    action: normalizedAction,
    canceledTagActivationTaskCount,
    scheduledTagActivationTaskCount: scheduledTagActivationTasks.length
  });
  return {
    tags,
    accepted: result.accepted,
    rejected: result.rejected,
    canceledTagActivationTaskCount,
    scheduledTagActivationTasks
  };
}

function resolveLegacyBotId(req) {
  return req.params.botId || req.query.botId || process.env.ROBOT_ID;
}

function serializeGroupAutomationOccurrence(occurrence) {
  if (!occurrence) return null;
  const retryMetadata = occurrence.retryMetadata || {};
  return {
    id: occurrence.id,
    taskId: occurrence.taskId,
    groupId: occurrence.groupId,
    scheduledFor: occurrence.scheduledFor,
    cycleStartAt: occurrence.cycleStartAt,
    cycleEndAt: occurrence.cycleEndAt,
    status: occurrence.status,
    stage: occurrence.stage,
    nextRetryAt: occurrence.nextRetryAt,
    decisionNote: occurrence.decisionNote,
    frozenContent: String(
      occurrence.frozenPayload?.content || occurrence.renderedContent || ""
    ),
    renderedContent: occurrence.renderedContent,
    evidenceMessageIds: occurrence.evidenceMessageIds,
    mentionNames: occurrence.mentionNames,
    warnings: occurrence.warnings,
    deliveryState: occurrence.deliveryState,
    worktoolMessageId: occurrence.worktoolMessageId,
    errorMessage: occurrence.errorMessage,
    reason: occurrence.reason,
    startedAt: occurrence.startedAt,
    finishedAt: occurrence.finishedAt,
    actualStartedAt: occurrence.actualStartedAt,
    actualCompletedAt: occurrence.actualCompletedAt,
    targetDelayMs: occurrence.targetDelayMs,
    retryHistory: {
      attempts: occurrence.attempts,
      stageAttemptsByStage: occurrence.stageAttemptsByStage,
      sendAttempts: Number(retryMetadata.sendAttempts || 0),
      deliveryResolution: retryMetadata.deliveryResolution || null,
      manualRetry: retryMetadata.manualRetry || null
    },
    canConfirmDelivered: occurrence.stage === "delivery_unknown",
    canConfirmNotDeliveredAndRetry: occurrence.stage === "delivery_unknown",
    createdAt: occurrence.createdAt,
    updatedAt: occurrence.updatedAt
  };
}

function serializeGroupAutomationTask({ botId, groupId, task }) {
  const lastOccurrence = listGroupAutomationOccurrences({
    botId,
    taskId: task.id,
    page: 1,
    pageSize: 1
  }).items[0] || null;
  const capability = groupAutomationExecutionCapability(botId);
  return {
    id: task.id,
    groupId: task.groupId,
    name: task.name,
    taskType: task.taskType,
    enabled: task.enabled,
    cadence: task.cadence,
    scheduleDays: task.scheduleDays,
    timeOfDay: task.timeOfDay,
    conditionText: task.conditionText,
    content: task.content,
    summaryTemplate: task.summaryTemplate,
    mentionRoleIds: task.mentionRoleIds,
    nextRunAt: task.nextRunAt,
    version: task.version,
    executionAvailable: capability.executionAvailable,
    technicalReason: capability.technicalReason,
    latestOccurrence: serializeGroupAutomationOccurrence(lastOccurrence),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

function validateGroupAutomationRequest({ botId, groupId, body, current = null }) {
  let schedule;
  try {
    schedule = normalizeGroupAutomationSchedule({
      cadence: body.cadence === undefined ? current?.cadence : body.cadence,
      scheduleDays: body.scheduleDays === undefined ? current?.scheduleDays : body.scheduleDays,
      timeOfDay: body.timeOfDay === undefined ? current?.timeOfDay : body.timeOfDay
    });
  } catch (error) {
    error.status = 422;
    throw error;
  }
  const taskType = String(
    body.taskType === undefined ? current?.taskType || "" : body.taskType || ""
  ).trim();
  const content = body.content === undefined ? current?.content || "" : String(body.content || "");
  const summaryTemplate = body.summaryTemplate === undefined
    ? current?.summaryTemplate || ""
    : String(body.summaryTemplate || "");
  if (taskType === "conditional_push" && !content.trim()) {
    const error = new Error("conditional push content is required");
    error.status = 422;
    throw error;
  }
  if (taskType === "periodic_summary") {
    try {
      parseGroupSummaryTemplate(summaryTemplate);
    } catch (error) {
      error.status = 422;
      throw error;
    }
  }
  if (!["conditional_push", "periodic_summary"].includes(taskType)) {
    const error = new Error("invalid group automation task type");
    error.status = 422;
    throw error;
  }
  const mentionRoleIds = body.mentionRoleIds === undefined
    ? current?.mentionRoleIds || []
    : Array.isArray(body.mentionRoleIds) ? body.mentionRoleIds : [];
  const mentionResolution = resolveGroupAutomationMentionNames({
    botId,
    groupId,
    roleIds: mentionRoleIds
  });
  if (mentionResolution.warnings.length) {
    const error = new Error("one or more mention roles do not belong to this group");
    error.status = 422;
    throw error;
  }
  const scheduleChanged = !current
    || body.cadence !== undefined
    || body.scheduleDays !== undefined
    || body.timeOfDay !== undefined;
  const activationChanged = body.enabled === true && current?.enabled === false;
  const shouldChooseNextRun = scheduleChanged || activationChanged;
  const nowIso = new Date().toISOString();
  const immediateRunAt = shouldChooseNextRun
    ? nextGroupAutomationRunAt(schedule, nowIso)
    : "";
  const eligibleRunAt = shouldChooseNextRun
    ? nextGroupAutomationRunAt(schedule, nowIso, { minimumLeadMs: 600_000 })
    : "";
  return {
    taskType,
    ...schedule,
    content,
    summaryTemplate,
    mentionRoleIds,
    ...(shouldChooseNextRun ? { nextRunAt: eligibleRunAt } : {}),
    skippedImminentTarget: Boolean(
      shouldChooseNextRun && immediateRunAt !== eligibleRunAt
    )
  };
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "worktool-bot-service",
    time: new Date().toISOString()
  });
});

app.options("/api/uploads", applyUploadCors);

app.post(
  "/api/uploads",
  applyUploadCors,
  (req, res, next) => {
    try {
      const botId = String(req.query.botId || "").trim();
      assertBotAccess(req, botId);
      req.uploadBotId = botId;
      next();
    } catch (error) {
      next(error);
    }
  },
  upload.single("file"),
  (req, res, next) => {
    try {
      if (!req.file) {
        throw new Error("file is required");
      }
      res.json({
        ok: true,
        file: {
          originalName: normalizeUploadedFilename(req.file.originalname),
          filename: req.file.filename,
          size: req.file.size,
          mimeType: req.file.mimetype,
          url: buildPublicFileUrl(req.uploadBotId, req.file.filename)
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

app.post("/worktool/:botId/message-callback", (req, res) => {
  try {
    assertCallbackSecret(req);
  } catch (error) {
    res.status(error.status || 500).json({ code: -1, message: error.message });
    return;
  }

  const botId = req.params.botId;
  const message = req.body || {};
  let intake;
  try {
    intake = ingestIncomingMessage({ botId, message });
  } catch (error) {
    logError("message_callback.persist_failed", { botId, messageId: message.messageId || "", error });
    res.status(500).json({ code: -1, message: "消息入库失败" });
    return;
  }
  res.json({ code: 0, message: "参数接收成功" });

  void processIncomingMessage({
    botId,
    message,
    intake
  }).catch((error) => {
    logError("message_callback.process_failed", {
      botId,
      messageId: message.messageId || "",
      error
    });
  });
});

app.post("/worktool/message-callback", (req, res) => {
  try {
    assertCallbackSecret(req);
  } catch (error) {
    res.status(error.status || 500).json({ code: -1, message: error.message });
    return;
  }

  const botId = resolveLegacyBotId(req);
  if (!botId) {
    res.status(400).json({ code: -1, message: "missing botId" });
    return;
  }

  const message = req.body || {};
  let intake;
  try {
    intake = ingestIncomingMessage({ botId, message });
  } catch (error) {
    logError("message_callback.persist_failed", { botId, messageId: message.messageId || "", error });
    res.status(500).json({ code: -1, message: "消息入库失败" });
    return;
  }
  res.json({ code: 0, message: "参数接收成功" });

  void processIncomingMessage({
    botId,
    message,
    intake
  }).catch((error) => {
    logError("message_callback.process_failed", {
      botId,
      messageId: message.messageId || "",
      error
    });
  });
});

app.post("/worktool/:botId/command-callback", (req, res) => {
  try {
    assertCallbackSecret(req);
  } catch (error) {
    res.status(error.status || 500).json({ code: -1, message: error.message });
    return;
  }

  insertCommandCallback({
    botId: req.params.botId,
    payload: req.body || {}
  });
  const outgoingMatched = updateOutgoingMessageFromCommandCallback({
    botId: req.params.botId,
    messageId: req.body?.messageId,
    payload: req.body || {}
  });
  const groupAutomationOccurrence = updateGroupAutomationOccurrenceFromCommandCallback({
    botId: req.params.botId,
    messageId: req.body?.messageId,
    payload: req.body || {}
  });
  publishGroupAutomationCallbackResult(groupAutomationOccurrence);
  logInfo("worktool.command_callback.received", commandCallbackLogFields({
    botId: req.params.botId,
    payload: req.body || {},
    outgoingMatched
  }));
  updateProactiveTargetFromCommandCallback({
    botId: req.params.botId,
    messageId: req.body?.messageId,
    payload: req.body || {}
  });
  if (Number(req.body?.type) === 213) {
    void tagSyncWorker.handleCommandCallback({
      botId: req.params.botId,
      messageId: req.body?.messageId,
      payload: req.body || {}
    }).catch((error) => {
      logWarn("tag_sync.callback.failed", { botId: req.params.botId, error });
    });
  }
  res.json({ code: 0, message: "参数接收成功" });
});

app.post("/worktool/command-callback", (req, res) => {
  try {
    assertCallbackSecret(req);
  } catch (error) {
    res.status(error.status || 500).json({ code: -1, message: error.message });
    return;
  }
  const botId = resolveLegacyBotId(req);
  if (!botId) {
    res.status(400).json({ code: -1, message: "missing botId" });
    return;
  }
  insertCommandCallback({ botId, payload: req.body || {} });
  const outgoingMatched = updateOutgoingMessageFromCommandCallback({
    botId,
    messageId: req.body?.messageId,
    payload: req.body || {}
  });
  const groupAutomationOccurrence = updateGroupAutomationOccurrenceFromCommandCallback({
    botId,
    messageId: req.body?.messageId,
    payload: req.body || {}
  });
  publishGroupAutomationCallbackResult(groupAutomationOccurrence);
  logInfo("worktool.command_callback.received", commandCallbackLogFields({
    botId,
    payload: req.body || {},
    outgoingMatched
  }));
  updateProactiveTargetFromCommandCallback({
    botId,
    messageId: req.body?.messageId,
    payload: req.body || {}
  });
  if (Number(req.body?.type) === 213) {
    void tagSyncWorker.handleCommandCallback({
      botId,
      messageId: req.body?.messageId,
      payload: req.body || {}
    }).catch((error) => {
      logWarn("tag_sync.callback.failed", { botId, error });
    });
  }
  res.json({ code: 0, message: "参数接收成功" });
});

app.post(
  "/api/groups/create",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const botId = String(body.botId || "").trim();
    assertBotAccess(req, botId);
    const groupName = String(body.groupName || "").trim();
    const selectList = Array.isArray(body.selectList) ? body.selectList : [];
    const result = await createExternalGroup({
      robotId: botId,
      groupName,
      selectList,
      groupAnnouncement: body.announcement || ""
    });
    const group = createOrGetGroup({
      botId,
      currentName: groupName,
      source: "created"
    });
    res.status(201).json({
      ok: true,
      group,
      command: { accepted: Number(result?.code || 0) === 0, response: result }
    });
  })
);

app.get(
  "/api/groups",
  asyncHandler(async (req, res) => {
    const botId = String(req.query.botId || "").trim();
    assertBotAccess(req, botId);
    const refresh = String(req.query.refresh || "") === "1";
    if (refresh) {
      const remote = await listWorkToolGroups({
        robotId: botId,
        groupName: req.query.search || "",
        page: Number(req.query.page || 1),
        size: Number(req.query.pageSize || 100)
      });
      for (const item of remote.items) {
        const currentName = String(item.groupName || item.name || "").trim();
        if (!currentName) continue;
        createOrGetGroup({
          botId,
          currentName,
          currentRemark: item.groupRemark || item.remark || "",
          source: "worktool_list",
          createdAt: item.createTime || item.createdAt || ""
        });
      }
    }
    const result = listGroupsPage({
      botId,
      search: req.query.search || "",
      page: Number(req.query.page || 1),
      pageSize: Number(req.query.pageSize || 50)
    });
    res.json({ ok: true, ...result, refreshed: refresh });
  })
);

app.get(
  "/api/groups/:groupId",
  asyncHandler(async (req, res) => {
    const botId = String(req.query.botId || "").trim();
    assertBotAccess(req, botId);
    const group = getGroupById({ botId, groupId: req.params.groupId });
    if (!group) {
      res.status(404).json({ ok: false, message: "managed group not found" });
      return;
    }
    const binding = getBotBinding(botId);
    const schema = normalizeTagSchema(
      binding?.agentId ? getAgentTagSchema(binding.agentId)?.config || {} : {}
    );
    res.json({
      ok: true,
      group,
      roles: listGroupRoles({ botId, groupId: group.id }),
      tagGroupIds: group.tagGroupIds,
      availableTagGroups: schema.groups
    });
  })
);

app.get(
  "/api/groups/:groupId/automations",
  asyncHandler(async (req, res) => {
    const botId = String(req.query.botId || "").trim();
    const groupId = req.params.groupId;
    assertBotAccess(req, botId);
    if (!getGroupById({ botId, groupId })) {
      res.status(404).json({ ok: false, message: "managed group not found" });
      return;
    }
    const tasks = listGroupAutomationTasks({ botId, groupId }).map((task) => (
      serializeGroupAutomationTask({ botId, groupId, task })
    ));
    res.json({ ok: true, tasks, serverTime: new Date().toISOString() });
  })
);

app.post(
  "/api/groups/:groupId/automations",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const botId = String(body.botId || "").trim();
    const groupId = req.params.groupId;
    assertBotAccess(req, botId);
    if (!getGroupById({ botId, groupId })) {
      res.status(404).json({ ok: false, message: "managed group not found" });
      return;
    }
    const normalized = validateGroupAutomationRequest({ botId, groupId, body });
    const task = createGroupAutomationTask({
      botId,
      groupId,
      name: body.name,
      conditionText: body.conditionText || "",
      enabled: body.enabled !== false,
      ...normalized
    });
    const serialized = serializeGroupAutomationTask({ botId, groupId, task });
    groupAutomationStreamHub.publish({ botId, groupId, task: serialized });
    res.status(201).json({
      ok: true,
      task: serialized,
      skippedImminentTarget: normalized.skippedImminentTarget
    });
  })
);

app.get(
  "/api/groups/:groupId/automations/events",
  asyncHandler(async (req, res) => {
    const botId = String(req.query.botId || "").trim();
    const groupId = req.params.groupId;
    assertBotAccess(req, botId);
    if (!getGroupById({ botId, groupId })) {
      res.status(404).json({ ok: false, message: "managed group not found" });
      return;
    }
    const snapshot = listGroupAutomationTasks({ botId, groupId }).map((task) => (
      serializeGroupAutomationTask({ botId, groupId, task })
    ));
    groupAutomationStreamHub.subscribe({ botId, groupId, req, res, snapshot });
  })
);

app.get(
  "/api/groups/:groupId/automations/evidence/:messageId",
  asyncHandler(async (req, res) => {
    const botId = String(req.query.botId || "").trim();
    const groupId = req.params.groupId;
    assertBotAccess(req, botId);
    const group = getGroupById({ botId, groupId });
    if (!group) {
      res.status(404).json({ ok: false, message: "managed group not found" });
      return;
    }
    const messageId = Number(req.params.messageId);
    const messages = listConversationMessagesAround({
      botId,
      conversationKey: group.conversationKey,
      anchorMessageId: messageId,
      before: 80,
      after: 80
    });
    const message = messages.find((item) => Number(item.id) === messageId);
    if (!message) {
      res.status(404).json({ ok: false, message: "evidence message not found" });
      return;
    }
    res.json({
      ok: true,
      anchor: {
        botId,
        groupId,
        conversationKey: group.conversationKey,
        messageId: message.id,
        createdAt: message.createdAt,
        senderName: message.senderName,
        content: message.content
      },
      messages
    });
  })
);

app.post(
  "/api/groups/:groupId/automation-occurrences/:occurrenceId/confirm-delivery",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const botId = String(body.botId || "").trim();
    const groupId = req.params.groupId;
    const access = assertBotAccess(req, botId);
    if (!getGroupById({ botId, groupId })) {
      res.status(404).json({ ok: false, message: "managed group not found" });
      return;
    }
    const occurrence = getGroupAutomationOccurrence({
      botId,
      occurrenceId: req.params.occurrenceId
    });
    if (!occurrence || occurrence.groupId !== groupId) {
      res.status(404).json({ ok: false, message: "group automation occurrence not found" });
      return;
    }
    const operatorId = String(access.sessionId || access.botId || access.role || "operator");
    const resolved = confirmGroupAutomationDelivery({
      botId,
      occurrenceId: occurrence.id,
      delivered: true,
      operatorId
    });
    publishGroupAutomationCallbackResult(resolved);
    res.json({ ok: true, occurrence: serializeGroupAutomationOccurrence(resolved) });
  })
);

app.post(
  "/api/groups/:groupId/automation-occurrences/:occurrenceId/confirm-not-delivered-and-retry",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const botId = String(body.botId || "").trim();
    const groupId = req.params.groupId;
    const access = assertBotAccess(req, botId);
    if (!getGroupById({ botId, groupId })) {
      res.status(404).json({ ok: false, message: "managed group not found" });
      return;
    }
    const occurrence = getGroupAutomationOccurrence({
      botId,
      occurrenceId: req.params.occurrenceId
    });
    if (!occurrence || occurrence.groupId !== groupId) {
      res.status(404).json({ ok: false, message: "group automation occurrence not found" });
      return;
    }
    const operatorId = String(access.sessionId || access.botId || access.role || "operator");
    const resolved = prepareManualGroupAutomationRetry({
      botId,
      occurrenceId: occurrence.id,
      operatorId
    });
    publishGroupAutomationCallbackResult(resolved);
    res.json({ ok: true, occurrence: serializeGroupAutomationOccurrence(resolved) });
  })
);

app.get(
  "/api/groups/:groupId/automations/:taskId",
  asyncHandler(async (req, res) => {
    const botId = String(req.query.botId || "").trim();
    const groupId = req.params.groupId;
    assertBotAccess(req, botId);
    const task = getGroupAutomationTask({ botId, taskId: req.params.taskId });
    if (!task || task.groupId !== groupId || task.deletedAt) {
      res.status(404).json({ ok: false, message: "group automation task not found" });
      return;
    }
    res.json({
      ok: true,
      task: serializeGroupAutomationTask({ botId, groupId, task })
    });
  })
);

app.patch(
  "/api/groups/:groupId/automations/:taskId",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const botId = String(body.botId || "").trim();
    const groupId = req.params.groupId;
    assertBotAccess(req, botId);
    const current = getGroupAutomationTask({ botId, taskId: req.params.taskId });
    if (!current || current.groupId !== groupId || current.deletedAt) {
      res.status(404).json({ ok: false, message: "group automation task not found" });
      return;
    }
    const normalized = validateGroupAutomationRequest({
      botId,
      groupId,
      body,
      current
    });
    const task = updateGroupAutomationTask({
      ...body,
      ...normalized,
      botId,
      taskId: current.id,
      expectedVersion: body.expectedVersion
    });
    const serialized = serializeGroupAutomationTask({ botId, groupId, task });
    groupAutomationStreamHub.publish({ botId, groupId, task: serialized });
    res.json({
      ok: true,
      task: serialized,
      skippedImminentTarget: normalized.skippedImminentTarget
    });
  })
);

app.post(
  "/api/groups/:groupId/automations/:taskId/duplicate",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const botId = String(body.botId || "").trim();
    const groupId = req.params.groupId;
    assertBotAccess(req, botId);
    const sourceTask = getGroupAutomationTask({ botId, taskId: req.params.taskId });
    if (!sourceTask || sourceTask.groupId !== groupId || sourceTask.deletedAt) {
      res.status(404).json({ ok: false, message: "group automation task not found" });
      return;
    }
    const task = duplicateGroupAutomationTask({
      botId,
      taskId: sourceTask.id,
      name: body.name || ""
    });
    const serialized = serializeGroupAutomationTask({ botId, groupId, task });
    groupAutomationStreamHub.publish({ botId, groupId, task: serialized });
    res.status(201).json({ ok: true, task: serialized });
  })
);

app.delete(
  "/api/groups/:groupId/automations/:taskId",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const botId = String(body.botId || req.query.botId || "").trim();
    const groupId = req.params.groupId;
    assertBotAccess(req, botId);
    const current = getGroupAutomationTask({ botId, taskId: req.params.taskId });
    if (!current || current.groupId !== groupId || current.deletedAt) {
      res.status(404).json({ ok: false, message: "group automation task not found" });
      return;
    }
    const task = softDeleteGroupAutomationTask({
      botId,
      taskId: current.id,
      expectedVersion: body.expectedVersion ?? req.query.expectedVersion
    });
    groupAutomationStreamHub.publish({ botId, groupId, task: { id: task.id, deleted: true } });
    res.json({ ok: true, taskId: task.id });
  })
);

app.get(
  "/api/groups/:groupId/automations/:taskId/occurrences",
  asyncHandler(async (req, res) => {
    const botId = String(req.query.botId || "").trim();
    const groupId = req.params.groupId;
    assertBotAccess(req, botId);
    const task = getGroupAutomationTask({ botId, taskId: req.params.taskId });
    if (!task || task.groupId !== groupId) {
      res.status(404).json({ ok: false, message: "group automation task not found" });
      return;
    }
    const result = listGroupAutomationOccurrences({
      botId,
      taskId: task.id,
      page: Number(req.query.page || 1),
      pageSize: Number(req.query.pageSize || 20)
    });
    res.json({
      ok: true,
      items: result.items.map(serializeGroupAutomationOccurrence),
      pagination: result.pagination
    });
  })
);

app.patch(
  "/api/groups/:groupId/config",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const botId = String(body.botId || "").trim();
    assertBotAccess(req, botId);
    const binding = getBotBinding(botId);
    const schema = normalizeTagSchema(
      binding?.agentId ? getAgentTagSchema(binding.agentId)?.config || {} : {}
    );
    const allowedGroupIds = new Set(schema.groups.map((group) => group.id));
    const requested = Array.isArray(body.tagGroupIds) ? body.tagGroupIds : [];
    if (requested.some((id) => id !== "__date__" && !allowedGroupIds.has(id))) {
      const error = new Error("invalid tag group binding");
      error.status = 422;
      throw error;
    }
    const group = saveGroupConfig({
      botId,
      groupId: req.params.groupId,
      expectedVersion: body.expectedVersion,
      replyPolicy: body.replyPolicy,
      background: body.background || "",
      tagGroupIds: requested
    });
    res.json({ ok: true, group });
  })
);

app.patch(
  "/api/groups/:groupId/roles",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const botId = String(body.botId || "").trim();
    assertBotAccess(req, botId);
    const saved = saveGroupRoles({
      botId,
      groupId: req.params.groupId,
      expectedVersion: body.expectedVersion,
      roles: body.roles
    });
    res.json({
      ok: true,
      group: saved.group,
      roles: listGroupRoles({ botId, groupId: saved.group.id })
    });
  })
);

app.post(
  "/api/groups/:groupId/merge",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const botId = String(body.botId || "").trim();
    assertBotAccess(req, botId);
    const group = mergeGroupAlias({
      botId,
      sourceGroupId: String(body.sourceGroupId || "").trim(),
      targetGroupId: req.params.groupId
    });
    res.json({ ok: true, group });
  })
);

app.post(
  "/api/send",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const robotId = body.botId || body.robotId || process.env.ROBOT_ID;
    assertBotAccess(req, robotId);
    const targets = Array.isArray(body.targets) ? body.targets : [body.target].filter(Boolean);
    const content = body.content;
    const socketType = body.socketType || 2;

    const result = await sendTextMessage({ robotId, targets, content, socketType });
    insertOutgoingMessage({
      botId: robotId,
      targetName: targets.join(","),
      content,
      messageId: result.data,
      worktoolResponse: result
    });

    res.json({ ok: true, result });
  })
);

app.get(
  "/api/public/bots",
  asyncHandler(async (req, res) => {
    res.json({ ok: true, bots: listBotBindings().map(publicBotView) });
  })
);

app.post(
  "/api/admin/login",
  asyncHandler(async (req, res) => {
    if (!adminAuthState.ready) {
      res.status(503).json({ ok: false, message: adminAuthState.reason });
      return;
    }
    const password = String(req.body?.password || "");
    if (!verifyAdminPassword(password)) {
      res.status(401).json({ ok: false, message: "invalid admin password" });
      return;
    }
    const session = createAdminSession();
    res.json({ ok: true, session });
  })
);

app.post(
  "/api/admin/logout",
  asyncHandler(async (req, res) => {
    const token = req.header("x-admin-session-token");
    if (token) deleteAdminSession(token);
    res.json({ ok: true });
  })
);

app.get(
  "/api/admin/session",
  asyncHandler(async (req, res) => {
    const session = getRequestAdminSession(req);
    if (!session) {
      res.status(401).json({ ok: false, message: "admin session required" });
      return;
    }
    res.json({ ok: true, session });
  })
);

app.put(
  "/api/admin/password",
  asyncHandler(async (req, res) => {
    assertAdminAccess(req);
    const password = String(req.body?.password || "");
    if (!password) {
      res.status(400).json({ ok: false, message: "password is required" });
      return;
    }
    changeAdminPassword(password);
    res.json({ ok: true, reauthenticate: true });
  })
);

app.get(
  "/api/admin/workspaces",
  asyncHandler(async (req, res) => {
    assertAdminAccess(req);
    res.json({
      ok: true,
      workspaces: listWorkspaces().map(publicWorkspaceView)
    });
  })
);

app.post(
  "/api/admin/workspaces",
  asyncHandler(async (req, res) => {
    assertAdminAccess(req);
    try {
      const workspace = createWorkspace(req.body || {});
      res.status(201).json({ ok: true, workspace });
    } catch (error) {
      if (String(error.message || "").includes("UNIQUE constraint failed")) {
        error.status = 409;
        error.message = "workspace slug already exists";
      }
      throw error;
    }
  })
);

app.get(
  "/api/admin/workspaces/unassigned-bots",
  asyncHandler(async (req, res) => {
    assertAdminAccess(req);
    res.json({
      ok: true,
      bots: listUnassignedBotBindings().map(publicBotView)
    });
  })
);

app.get(
  "/api/admin/workspaces/:id",
  asyncHandler(async (req, res) => {
    assertAdminAccess(req);
    const workspace = getWorkspaceById(Number(req.params.id));
    if (!workspace) {
      res.status(404).json({ ok: false, message: "workspace not found" });
      return;
    }
    res.json({
      ok: true,
      workspace: publicWorkspaceView(workspace),
      bots: listWorkspaceBots(workspace.id).map(publicBotView)
    });
  })
);

app.put(
  "/api/admin/workspaces/:id",
  asyncHandler(async (req, res) => {
    assertAdminAccess(req);
    try {
      const workspace = updateWorkspace(Number(req.params.id), req.body || {});
      res.json({ ok: true, workspace });
    } catch (error) {
      if (String(error.message || "").includes("UNIQUE constraint failed")) {
        error.status = 409;
        error.message = "workspace slug already exists";
      }
      throw error;
    }
  })
);

app.delete(
  "/api/admin/workspaces/:id",
  asyncHandler(async (req, res) => {
    assertAdminAccess(req);
    const result = removeWorkspace(Number(req.params.id));
    res.json({ ok: true, ...result });
  })
);

app.post(
  "/api/admin/workspaces/:id/bots",
  asyncHandler(async (req, res) => {
    assertAdminAccess(req);
    try {
      const bots = assignBotsToWorkspace({
        workspaceId: Number(req.params.id),
        botIds: Array.isArray(req.body?.botIds) ? req.body.botIds : []
      });
      res.json({ ok: true, bots: bots.map(publicBotView) });
    } catch (error) {
      if (String(error.message || "").includes("already assigned")) error.status = 409;
      throw error;
    }
  })
);

app.delete(
  "/api/admin/workspaces/:id/bots/:botId",
  asyncHandler(async (req, res) => {
    assertAdminAccess(req);
    const removed = unassignBotFromWorkspace({
      workspaceId: Number(req.params.id),
      botId: req.params.botId
    });
    if (!removed) {
      res.status(404).json({ ok: false, message: "workspace Bot assignment not found" });
      return;
    }
    res.json({ ok: true });
  })
);

app.post(
  "/api/admin/workspaces/:id/bots/:botId/transfer",
  asyncHandler(async (req, res) => {
    assertAdminAccess(req);
    const bot = transferBotToWorkspace({
      botId: req.params.botId,
      targetWorkspaceId: Number(req.body?.targetWorkspaceId)
    });
    res.json({ ok: true, bot: publicBotView(bot) });
  })
);

app.post(
  "/api/admin/workspaces/:id/session",
  asyncHandler(async (req, res) => {
    assertAdminAccess(req);
    const session = createWorkspaceSessionForAdmin(Number(req.params.id));
    res.json({ ok: true, session });
  })
);

app.get(
  "/api/workspaces/:slug/challenge",
  asyncHandler(async (req, res) => {
    const workspace = getWorkspaceChallenge(req.params.slug);
    res.json({ ok: true, workspace });
  })
);

app.post(
  "/api/workspaces/:slug/unlock",
  asyncHandler(async (req, res) => {
    const session = unlockWorkspace({
      slug: req.params.slug,
      response: req.body?.response
    });
    res.json({ ok: true, session });
  })
);

app.post(
  "/api/workspaces/:slug/logout",
  asyncHandler(async (req, res) => {
    const session = assertWorkspaceAccess(req, req.params.slug);
    logoutWorkspace(getRequestWorkspaceToken(req));
    res.json({ ok: true, workspace: session.workspace });
  })
);

app.get(
  "/api/workspaces/:slug/bots",
  asyncHandler(async (req, res) => {
    const session = assertWorkspaceAccess(req, req.params.slug);
    const bots = listWorkspaceBots(session.workspace.id).map(publicBotView);
    res.json({ ok: true, workspace: session.workspace, bots });
  })
);

app.post(
  "/api/bots/:botId/unlock",
  asyncHandler(async (req, res) => {
    const binding = getBotBinding(req.params.botId);
    if (!binding) {
      res.status(404).json({ ok: false, message: "bot not found" });
      return;
    }
    const key = String(req.body?.key || "").trim();
    if (!key) {
      res.status(400).json({ ok: false, message: "key is required" });
      return;
    }

    let role = "";
    if (verifyAdminPassword(key)) {
      role = "admin";
    } else if (verifyAccessKey(key, binding.accessKeyHash)) {
      role = "bot";
    }

    if (!role) {
      res.status(401).json({ ok: false, message: "invalid bot key" });
      return;
    }

    const session = createBotSession({ botId: binding.botId, role });
    res.json({
      ok: true,
      role,
      token: session.token,
      expiresAt: session.expiresAt,
      bot: role === "admin" ? binding : publicBotView(binding)
    });
  })
);

app.post(
  "/api/bots/:botId/lock",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, req.params.botId);
    const token = req.header("x-bot-session-token");
    if (token) deleteBotSession(token);
    res.json({ ok: true });
  })
);

app.put(
  "/api/bots/:botId/access-key",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, req.params.botId);
    const accessKey = String(req.body?.accessKey || "").trim();
    if (!accessKey) throw new Error("accessKey is required");
    const binding = setBotAccessKey({ botId: req.params.botId, accessKey });
    res.json({ ok: true, bot: publicBotView(binding) });
  })
);

app.get(
  "/api/bots",
  asyncHandler(async (req, res) => {
    assertAdminAccess(req);
    res.json({ ok: true, bots: listBotBindings() });
  })
);

app.get(
  "/api/agents",
  asyncHandler(async (req, res) => {
    assertAdminAccess(req);
    res.json({ ok: true, agents: listAgents() });
  })
);

app.put(
  "/api/agents/:agentId",
  asyncHandler(async (req, res) => {
    assertAdminAccess(req);
    const body = req.body || {};
    const agent = upsertAgent({
      agentId: req.params.agentId,
      agentName: body.agentName || body.name || "",
      dclawBaseUrl: body.dclawBaseUrl || "",
      dclawPublicId: body.dclawPublicId || body.agentId || req.params.agentId,
      agentApiKey: body.agentApiKey || "",
      enabled: body.enabled !== false
    });
    res.json({ ok: true, agent });
  })
);

app.delete(
  "/api/agents/:agentId",
  asyncHandler(async (req, res) => {
    assertAdminAccess(req);
    let agent;
    try {
      agent = deleteAgent(req.params.agentId);
    } catch (error) {
      if (String(error.message || "").includes("agent is bound")) {
        res.status(409).json({ ok: false, message: error.message });
        return;
      }
      throw error;
    }
    if (!agent) {
      res.status(404).json({ ok: false, message: "agent not found" });
      return;
    }
    res.json({ ok: true, agent });
  })
);

app.put(
  "/api/bots/:botId",
  asyncHandler(async (req, res) => {
    assertAdminForBot(req, req.params.botId);
    const previousBinding = getBotBinding(req.params.botId);
    const body = req.body || {};
    const agentId = String(body.agentId || "").trim();
    if (!agentId) {
      res.status(400).json({ ok: false, message: "agentId is required" });
      return;
    }
    if (!getAgent(agentId)) {
      if (body.dclawBaseUrl || body.dclawPublicId || body.agentApiKey || body.agentName) {
        upsertAgent({
          agentId,
          agentName: body.agentName || "",
          dclawBaseUrl: body.dclawBaseUrl || "",
          dclawPublicId: body.dclawPublicId || agentId,
          agentApiKey: body.agentApiKey || "",
          enabled: true
        });
      } else {
        res.status(400).json({ ok: false, message: "agent not found" });
        return;
      }
    }
    const binding = upsertBotBinding({
      botId: req.params.botId,
      botName: body.botName || body.name || "",
      agentId,
      enabled: body.enabled !== false
    });
    let rebindReset = null;
    if (previousBinding && previousBinding.agentId !== binding.agentId) {
      cancelInboundBatchesForBot(binding.botId, "agent_rebound");
      rebindReset = resetBotFlowStateForAgentRebind({
        botId: binding.botId,
        oldAgentId: previousBinding.agentId,
        newAgentId: binding.agentId
      });
      logInfo("bot.agent_rebound", {
        botId: binding.botId,
        oldAgentId: previousBinding.agentId,
        newAgentId: binding.agentId,
        ...rebindReset
      });
    }
    let callbackBinding;
    try {
      callbackBinding = await bindBotCallbacks(req.params.botId, {
        replyAll: body.replyAll ?? 1
      });
    } catch (error) {
      callbackBinding = {
        ok: false,
        error: error.message
      };
      logWarn("bot.callback_bind_failed", {
        botId: req.params.botId,
        error: error.message
      });
    }
    res.json({ ok: true, binding, callbackBinding, rebindReset });
  })
);

app.delete(
  "/api/bots/:botId",
  asyncHandler(async (req, res) => {
    assertAdminForBot(req, req.params.botId);
    const binding = getBotBinding(req.params.botId);
    if (!binding) {
      res.status(404).json({ ok: false, message: "bot not found" });
      return;
    }

    let callbackUnbinding;
    try {
      callbackUnbinding = await unbindBotCallbacks(req.params.botId);
    } catch (error) {
      callbackUnbinding = {
        ok: false,
        error: error.message
      };
      logWarn("bot.callback_unbind_failed", {
        botId: req.params.botId,
        error: error.message
      });
    }

    cancelInboundBatchesForBot(req.params.botId, "bot_deleted");
    const deleted = deleteBotData(req.params.botId);
    if (!deleted) {
      res.status(404).json({ ok: false, message: "bot not found" });
      return;
    }
    const removedSessions = deleteBotSessionsForBot(req.params.botId);
    await fs.promises.rm(getBotUploadDir(req.params.botId), { recursive: true, force: true });
    logInfo("bot.deleted", {
      botId: req.params.botId,
      removedSessions,
      deleted: deleted.deleted
    });
    res.json({ ok: true, deleted, removedSessions, callbackUnbinding });
  })
);

app.get(
  "/api/bots/:botId/tag-sync/config",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, req.params.botId);
    res.json({
      ok: true,
      config: getTagSyncConfig(req.params.botId)
    });
  })
);

app.put(
  "/api/bots/:botId/tag-sync/config",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, req.params.botId);
    let config;
    try {
      config = saveTagSyncConfig({
        botId: req.params.botId,
        config: req.body || {}
      });
    } catch (error) {
      if (/night window|invalid night/i.test(String(error?.message || ""))) {
        error.status = 400;
      }
      throw error;
    }
    if (config.nightlyEnabled && !config.initialBackfillAt) {
      const backfill = ensureTagSyncInitialBackfill({ botId: req.params.botId });
      logInfo("tag_sync.backfill.completed", backfill);
      config = getTagSyncConfig(req.params.botId);
    }
    res.json({ ok: true, config });
  })
);

app.get(
  "/api/bots/:botId/tag-sync/status",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, req.params.botId);
    res.json({ ok: true, status: getTagSyncStatus(req.params.botId) });
  })
);

app.post(
  "/api/bots/:botId/tag-sync/run",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, req.params.botId);
    const backfill = ensureTagSyncInitialBackfill({ botId: req.params.botId });
    if (backfill.insertedCount > 0) {
      logInfo("tag_sync.backfill.completed", backfill);
    }
    const run = startTagSyncRun({
      botId: req.params.botId,
      triggerType: "manual"
    });
    void tagSyncWorker.runBot(req.params.botId, new Date()).catch((error) => {
      logWarn("tag_sync.worker.failed", { botId: req.params.botId, error });
    });
    res.status(202).json({
      ok: true,
      run,
      status: getTagSyncStatus(req.params.botId)
    });
  })
);

app.get(
  "/api/bots/:botId/settings/debug-reply",
  asyncHandler(async (req, res) => {
    assertAdminForBot(req, req.params.botId);
    res.json({ ok: true, botId: req.params.botId, config: getDebugReplyConfig(req.params.botId) });
  })
);

app.put(
  "/api/bots/:botId/settings/debug-reply",
  asyncHandler(async (req, res) => {
    assertAdminForBot(req, req.params.botId);
    const body = req.body || {};
    const config = setSetting(getDebugReplySettingKey(req.params.botId), {
      enabled: Boolean(body.enabled),
      trigger: String(body.trigger || "ping").trim(),
      reply: String(body.reply || "pong")
    });
    res.json({ ok: true, botId: req.params.botId, config });
  })
);

app.get(
  "/api/bots/:botId/settings/reply-wait",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, req.params.botId);
    res.json({ ok: true, botId: req.params.botId, config: getReplyWaitConfig(req.params.botId) });
  })
);

app.put(
  "/api/bots/:botId/settings/reply-wait",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, req.params.botId);
    const config = normalizeReplyWaitConfig({
      ...getReplyWaitConfig(req.params.botId),
      ...(req.body || {})
    });
    setSetting(getReplyWaitSettingKey(req.params.botId), config);
    res.json({ ok: true, botId: req.params.botId, config });
  })
);

app.get(
  "/api/bots/:botId/settings/history-analysis",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, req.params.botId);
    res.json({
      ok: true,
      botId: req.params.botId,
      config: getHistoryAnalysisConfig(req.params.botId)
    });
  })
);

app.put(
  "/api/bots/:botId/settings/history-analysis",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, req.params.botId);
    const config = normalizeHistoryAnalysisConfig({
      ...getHistoryAnalysisConfig(req.params.botId),
      ...(req.body || {})
    });
    setSetting(getHistoryAnalysisSettingKey(req.params.botId), config);
    res.json({ ok: true, botId: req.params.botId, config });
  })
);

app.get(
  "/api/tag-alerts/stream",
  asyncHandler(async (req, res) => {
    const botId = String(req.query.botId || "").trim();
    assertBotAccess(req, botId);
    const snapshot = listUnreadTagAlerts({ botId });
    tagAlertStreamHub.subscribe({
      botId,
      req,
      res,
      snapshot
    });
  })
);

app.get(
  "/api/tag-alerts",
  asyncHandler(async (req, res) => {
    const botId = String(req.query.botId || "").trim();
    assertBotAccess(req, botId);
    const status = String(req.query.status || "unread").trim().toLowerCase();
    if (status !== "unread") {
      const error = new Error("only unread tag alerts are supported");
      error.status = 400;
      throw error;
    }
    res.json({
      ok: true,
      botId,
      alerts: listUnreadTagAlerts({ botId })
    });
  })
);

app.post(
  "/api/tag-alerts/:alertId/read",
  asyncHandler(async (req, res) => {
    const botId = String(req.body?.botId || "").trim();
    const alertId = Number(req.params.alertId);
    assertBotAccess(req, botId);
    if (!Number.isInteger(alertId) || alertId <= 0) {
      const error = new Error("valid alertId is required");
      error.status = 400;
      throw error;
    }
    const alert = markTagAlertRead({ botId, alertId });
    if (!alert) {
      const error = new Error("unread tag alert not found");
      error.status = 404;
      throw error;
    }
    tagAlertStreamHub.publishRead({
      botId,
      alertId,
      readAt: alert.readAt
    });
    res.json({ ok: true, alert });
  })
);

app.get(
  "/api/cockpit/:botId/overview",
  asyncHandler(async (req, res) => {
    const botId = req.params.botId;
    assertBotAccess(req, botId);
    const periodType = ["daily", "weekly", "monthly"].includes(req.query.periodType)
      ? req.query.periodType
      : "daily";
    const hasExplicitAnchor = typeof req.query.anchor === "string" && req.query.anchor.trim();
    const anchor = String(hasExplicitAnchor || new Date().toISOString());
    const periodCandidates = cockpitPeriodCandidates({ type: periodType, anchor });
    const period = periodCandidates[0];
    const exactSnapshots = periodCandidates.map((candidate) => getLatestCockpitSnapshot({
      botId,
      periodType,
      periodStart: candidate.start
    }));
    const exactSnapshot = exactSnapshots.find(Boolean) || null;
    const snapshot = hasExplicitAnchor
      ? exactSnapshot
      : exactSnapshot || getLatestCockpitSnapshot({ botId, periodType });
    const selectedPeriod = periodCandidates.find((candidate) => (
      candidate.start === snapshot?.periodStart
    )) || period;
    const reports = listCockpitReports({ botId, page: 1, pageSize: 20 });
    const latestReport = reports.items.find((report) => (
      report.reportType === periodType
      && periodCandidates.some((candidate) => (
        report.periodStart === candidate.start
        && report.periodEnd === candidate.end
      ))
    )) || null;
    res.json({
      ok: true,
      freshness: {
        completeAt: snapshot?.generatedAt || "",
        todayAt: new Date().toISOString(),
        delayed: !snapshot
      },
      period,
      today: hasExplicitAnchor ? {} : getCockpitDailyCounters({
        botId,
        localDate: periodBounds({
          type: "daily",
          anchor: new Date().toISOString()
        }).label
      }),
      metrics: snapshot?.metrics || {},
      funnels: snapshot?.charts?.funnels || [],
      nodeDistribution: snapshot?.charts?.nodeDistribution || [],
      tagGroups: snapshot?.charts?.tags || [],
      latestReport,
      reportHistory: reports.items.filter((report) => (
        report.reportType === periodType
        && report.periodStart === selectedPeriod.start
        && report.periodEnd === selectedPeriod.end
      )).slice(0, 8)
    });
  })
);

app.get(
  "/api/cockpit/:botId/reports",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, req.params.botId);
    res.json({
      ok: true,
      ...listCockpitReports({
        botId: req.params.botId,
        page: req.query.page,
        pageSize: req.query.pageSize
      })
    });
  })
);

app.post(
  "/api/cockpit/:botId/reports",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, req.params.botId);
    const reportType = ["daily", "weekly", "monthly"].includes(req.body?.reportType)
      ? req.body.reportType
      : "daily";
    const job = createCockpitJob({
      botId: req.params.botId,
      stage: "generate",
      payload: { reportType, requestedBy: "console" },
      dueAt: new Date().toISOString()
    });
    res.status(202).json({ ok: true, status: "queued", jobId: job.id });
  })
);

app.get(
  "/api/cockpit/:botId/reports/:reportId",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, req.params.botId);
    const report = getCockpitReport({
      botId: req.params.botId,
      reportId: Number(req.params.reportId)
    });
    if (!report) {
      res.status(404).json({ ok: false, message: "cockpit report not found" });
      return;
    }
    res.json({ ok: true, report });
  })
);

app.get(
  "/api/cockpit/:botId/config",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, req.params.botId);
    res.json({ ok: true, config: getCockpitConfig(req.params.botId) });
  })
);

app.put(
  "/api/cockpit/:botId/config",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, req.params.botId);
    res.json({
      ok: true,
      config: upsertCockpitConfig({
        botId: req.params.botId,
        config: req.body || {}
      })
    });
  })
);

app.post(
  "/api/cockpit/:botId/rebuild",
  asyncHandler(async (req, res) => {
    assertAdminForBot(req, req.params.botId);
    const job = createCockpitJob({
      botId: req.params.botId,
      stage: "rebuild",
      payload: { requestedBy: "console" },
      dueAt: new Date().toISOString()
    });
    res.status(202).json({ ok: true, status: "queued", jobId: job.id });
  })
);

function defaultFlowMachineConfig(botName = "客服流程") {
  return {
    name: `${botName}状态机`,
    version: "1.0.0",
    entryNodeId: "collect_basic_info",
    nodes: [
      {
        id: "collect_basic_info",
        name: "收集基础信息",
        goal: "自然了解客户身份、需求、预算、地区和联系方式等基础信息。",
        completionCriteria: "客户已经表达明确需求，并至少留下一个可继续跟进的信息。",
        collectFields: ["name", "phone", "need", "budget", "city"],
        conversationTips: [
          "先回应客户问题，再自然补一个轻量问题",
          "不要像问卷一样连续追问",
          "客户抗拒时降低压迫感"
        ],
        nextNodeId: "invite_next_step"
      },
      {
        id: "invite_next_step",
        name: "邀约下一步",
        goal: "根据客户意向，引导客户参加直播课、预约顾问或进入下一步沟通。",
        completionCriteria: "客户接受了明确的下一步安排，或表达了可跟进时间。",
        collectFields: ["preferred_time", "next_action"],
        conversationTips: [
          "给客户一个明确但不强迫的下一步",
          "用选择题降低决策压力"
        ],
        nextNodeId: "follow_up"
      },
      {
        id: "follow_up",
        name: "跟进回访",
        goal: "围绕客户反馈继续答疑，确认是否具备成交推进条件。",
        completionCriteria: "客户反馈了参与结果或明确表达下一步购买/合作意向。",
        collectFields: ["feedback", "objections"],
        conversationTips: [
          "先复述客户反馈，体现理解",
          "针对疑虑给出简洁回应"
        ],
        nextNodeId: "close_deal"
      },
      {
        id: "close_deal",
        name: "成交推进",
        goal: "在客户意向明确时，推荐合适产品或合作方案并推动成交。",
        completionCriteria: "客户已经进入付款、合同、顾问对接或明确拒绝阶段。",
        collectFields: ["product_interest", "deal_status"],
        conversationTips: [
          "不要过度施压",
          "明确下一步材料、人员或动作"
        ],
        nextNodeId: ""
      }
    ]
  };
}

app.get(
  "/api/flow-machines",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, String(req.query.botId || "").trim());
    res.json({
      ok: true,
      machines: listFlowMachines({ botId: String(req.query.botId || "").trim() })
    });
  })
);

app.get(
  "/api/flow-machines/:botId",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, req.params.botId);
    let machine = getFlowMachineForBot(req.params.botId);
    if (!machine && req.query.default === "1") {
      const binding = getBotBinding(req.params.botId);
      machine = {
        botId: req.params.botId,
        enabled: false,
        config: defaultFlowMachineConfig(binding?.botName || binding?.agentName || "客服")
      };
    }
    res.json({ ok: true, machine });
  })
);

app.put(
  "/api/flow-machines/:botId",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, req.params.botId);
    const body = req.body || {};
    const config = typeof body.config === "string" ? JSON.parse(body.config) : body.config;
    const binding = getBotBinding(req.params.botId);
    if (!binding) throw new Error("bot binding not found");
    const machine = upsertFlowMachine({
      agentId: binding.agentId,
      config,
      enabled: body.enabled !== false
    });
    const definition = ensureCockpitDefinitionVersion({
      botId: req.params.botId,
      definitionType: "flow",
      config: machine.config,
      effectiveAt: machine.updatedAt
    });
    cockpitEventRecorder.record({
      botId: req.params.botId,
      eventType: "flow_definition_changed",
      sourceType: "flow_definition",
      sourceId: definition.id,
      occurredAt: definition.effectiveAt,
      flowVersionId: definition.id,
      payload: {
        versionNumber: definition.versionNumber,
        revisionNumber: definition.revisionNumber,
        semanticChanged: definition.semanticChanged
      }
    });
    res.json({ ok: true, machine });
  })
);

app.get(
  "/api/tag-schemas/:botId",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, req.params.botId);
    const binding = getBotBinding(req.params.botId);
    if (!binding) throw new Error("bot binding not found");
    res.json({
      ok: true,
      agentId: binding.agentId,
      schema: getAgentTagSchema(binding.agentId)?.config || { dateTag: { enabled: false }, groups: [] }
    });
  })
);

app.put(
  "/api/tag-schemas/:botId",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, req.params.botId);
    const binding = getBotBinding(req.params.botId);
    if (!binding) throw new Error("bot binding not found");
    const schema = upsertAgentTagSchema({
      agentId: binding.agentId,
      schema: req.body?.schema || req.body || {}
    });
    const definition = ensureCockpitDefinitionVersion({
      botId: req.params.botId,
      definitionType: "tags",
      config: schema.config,
      effectiveAt: schema.updatedAt
    });
    cockpitEventRecorder.record({
      botId: req.params.botId,
      eventType: "tag_definition_changed",
      sourceType: "tag_definition",
      sourceId: definition.id,
      occurredAt: definition.effectiveAt,
      tagVersionId: definition.id,
      payload: {
        versionNumber: definition.versionNumber,
        revisionNumber: definition.revisionNumber,
        semanticChanged: definition.semanticChanged
      }
    });
    res.json({ ok: true, agentId: binding.agentId, schema: schema.config });
  })
);

app.get(
  "/api/flow-sessions",
  asyncHandler(async (req, res) => {
    const botId = String(req.query.botId || "").trim();
    assertBotAccess(req, botId);
    const binding = getBotBinding(botId);
    const tagFilters = []
      .concat(req.query.tag || req.query.tags || [])
      .flatMap((value) => String(value || "").split(","))
      .map((value) => value.trim())
      .filter(Boolean);
    const page = listFlowSessionsPage({
      botId,
      page: Number(req.query.page || 1),
      pageSize: Number(req.query.pageSize || req.query.limit || 20),
      type: String(req.query.type || "all").trim(),
      query: String(req.query.query || "").trim(),
      nodeId: String(req.query.nodeId || "").trim(),
      tagFilters,
      dateTag: String(req.query.dateTag || "").trim()
    });
    const sessions = page.items.map((session) => {
      const { historySyncError: _historySyncError, ...publicSession } = session;
      publicSession.tags = binding
        ? listConversationTags({
            botId,
            agentId: binding.agentId,
            conversationKey: session.conversationKey
          })
        : [];
      publicSession.manualTagGroupIds = manualTagGroupIdsForConversation({
        botId,
        conversationKey: session.conversationKey
      });
      return publicSession;
    });
    res.json({
      ok: true,
      sessions,
      pagination: page.pagination
    });
  })
);

app.get(
  "/api/flow-sessions/:conversationKey",
  asyncHandler(async (req, res) => {
    const botId = String(req.query.botId || "").trim();
    assertBotAccess(req, botId);
    const conversationKey = decodeURIComponent(req.params.conversationKey);
    const binding = getBotBinding(botId);
    const session = getFlowSessionForBot({ botId, conversationKey });
    const managedGroup = getGroupByConversationKey({ botId, conversationKey });
    const { historySyncError: _historySyncError, ...publicSession } = session || {};
    publicSession.manualTagGroupIds = manualTagGroupIdsForConversation({
      botId,
      conversationKey
    });
    const anchorMessageId = Number(req.query.anchorMessageId || 0);
    const anchoredMessages = Number.isInteger(anchorMessageId) && anchorMessageId > 0
      ? listConversationMessagesAround({
          botId,
          conversationKey,
          anchorMessageId,
          before: 80,
          after: 80
        })
      : [];
    const evidenceFound = anchoredMessages.some(
      (message) => Number(message.id) === anchorMessageId
    );
    const messages = evidenceFound
      ? anchoredMessages
      : listConversationMessages({
          botId,
          conversationKey,
          limit: Number(req.query.limit || 300)
        });
    res.json({
      ok: true,
      session: session ? publicSession : null,
      managedGroup: managedGroup
        ? { id: managedGroup.id, currentName: managedGroup.currentName }
        : null,
      ...(binding
        ? { tags: listConversationTags({ botId, agentId: binding.agentId, conversationKey }) }
        : { tags: [] }),
      messages,
      evidenceFound: anchorMessageId > 0 ? evidenceFound : null,
      events: listFlowStateEvents({ botId, conversationKey, limit: 100 }),
      assets: getConversationAssets({
        botId,
        conversationKey
      })
    });
  })
);

app.post(
  "/api/flow-sessions/:conversationKey/tags/manual",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const conversationKey = decodeURIComponent(req.params.conversationKey);
    const botId = String(body.botId || "").trim();
    assertBotAccess(req, botId);
    if (!botId) throw new Error("botId is required");
    const binding = getBotBinding(botId);
    if (!binding || !binding.enabled) throw new Error("no enabled bot binding");
    const session = getFlowSessionForBot({ botId, conversationKey });
    if (!session) throw new Error("flow session not found");
    const result = applyManualConversationTagChange({
      botId,
      binding,
      conversationKey,
      groupId: String(body.groupId || "").trim(),
      tagId: String(body.tagId || "").trim(),
      action: String(body.action || "set").trim()
    });
    res.json({ ok: true, tags: result.tags, accepted: result.accepted, rejected: result.rejected });
  })
);

app.put(
  "/api/flow-sessions/:conversationKey/handoff",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const conversationKey = decodeURIComponent(req.params.conversationKey);
    const botId = String(body.botId || "").trim();
    assertBotAccess(req, botId);
    if (!botId) throw new Error("botId is required");
    const session = updateFlowSessionHandoff({
      botId,
      conversationKey,
      handoffStatus: body.handoffStatus,
      handoffBy: "console",
      reason: body.reason || (body.handoffStatus === "human" ? "人工接手" : "恢复 AI")
    });
    if (session.handoffStatus === "human") {
      cancelInboundBatch(inboundCoalesceKey(botId, conversationKey), "human_handoff");
      invalidateFlowActivation({ conversationKey, reason: "human_handoff" });
      const binding = getBotBinding(botId);
      if (binding?.agentId) {
        cancelTagActivationTasks({
          botId,
          agentId: binding.agentId,
          conversationKey,
          reason: "human_handoff"
        });
      }
    }
    logInfo("flow_session.handoff", {
      botId,
      conversationKey,
      handoffStatus: session.handoffStatus
    });
    res.json({ ok: true, session });
  })
);

app.post(
  "/api/flow-sessions/:conversationKey/manual-reply",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const conversationKey = decodeURIComponent(req.params.conversationKey);
    const botId = String(body.botId || "").trim();
    const content = String(body.content || "").trim();
    assertBotAccess(req, botId);
    if (!botId) throw new Error("botId is required");
    if (!content) throw new Error("content is required");
    const session = getFlowSession(conversationKey);
    if (!session || session.botId !== botId) {
      throw new Error("flow session not found");
    }
    if (session.handoffStatus !== "human") {
      throw new Error("manual reply requires human handoff");
    }
    const binding = getBotBinding(botId);
    if (!binding || !binding.enabled) {
      throw new Error("no enabled bot binding");
    }
    const target = manualReplyTargetForConversation({ botId, conversationKey });
    if (!target) {
      throw new Error("missing manual reply target");
    }

    const result = await sendTextMessage({
      robotId: botId,
      targets: [target],
      content
    });
    const messageId = result.data || "";
    const senderName = binding.botName || binding.agentName || "人工客服";
    const createdAt = new Date().toISOString();
    const rawPayload = {
      source: "manual_reply",
      messageId,
      worktoolResponse: result
    };

    insertConversationMessage({
      botId,
      conversationKey,
      direction: "outbound",
      senderName,
      content,
      rawPayload
    });
    insertOutgoingMessage({
      botId,
      agentId: binding.agentId,
      conversationKey,
      messageId,
      targetName: target,
      content,
      worktoolResponse: rawPayload
    });
    logInfo("manual_reply.sent", {
      botId,
      conversationKey,
      targetName: target,
      messageId
    });

    res.json({
      ok: true,
      message: {
        direction: "outbound",
        senderName,
        content,
        rawPayload,
        createdAt
      },
      worktoolResponse: result
    });
  })
);

app.put(
  "/api/flow-sessions/:conversationKey/node",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const conversationKey = decodeURIComponent(req.params.conversationKey);
    const botId = String(body.botId || "").trim();
    assertBotAccess(req, botId);
    const nextNodeId = String(body.nextNodeId || "").trim();
    if (!botId || !nextNodeId) throw new Error("botId and nextNodeId are required");
    const machine = getFlowMachineForBot(botId);
    if (!machine || !machine.config.nodes.some((node) => node.id === nextNodeId)) {
      throw new Error("nextNodeId is not valid for this bot");
    }
    updateFlowSessionNode({
      botId,
      conversationKey,
      nextNodeId,
      reason: body.reason || "控制台手动修改",
      decision: { source: "console", reason: body.reason || "" }
    });
    const session = invalidateFlowActivation({ conversationKey, reason: "console_node_change" });
    res.json({ ok: true, session });
  })
);

app.post(
  "/api/flow-sessions/:conversationKey/reset",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const conversationKey = decodeURIComponent(req.params.conversationKey);
    const botId = String(body.botId || "").trim();
    assertBotAccess(req, botId);
    if (!botId) throw new Error("botId is required");
    cancelInboundBatch(inboundCoalesceKey(botId, conversationKey), "conversation_reset");
    const session = clearConversationForReset({
      botId,
      conversationKey,
      reason: body.reason || "控制台清空会话"
    });
    invalidateFlowActivation({ conversationKey, reason: "conversation_reset" });
    const binding = getBotBinding(botId);
    if (binding?.agentId) {
      cancelTagActivationTasks({
        botId,
        agentId: binding.agentId,
        conversationKey,
        reason: "conversation_reset"
      });
    }
    if (binding?.enabled) {
      conversationResetWorker.wake();
    }
    logInfo("flow_session.reset", {
      botId,
      conversationKey,
      resetTaskId: session.resetTask?.id || ""
    });
    res.json({ ok: true, session });
  })
);

app.post(
  "/api/proactive/tasks",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const botId = String(body.botId || "").trim();
    assertBotAccess(req, botId);
    const targets = normalizeProactiveTargets(body.targets);
    const binding = botId ? getBotBinding(botId) : null;
    const message = normalizeProactiveMessage(body);
    const scheduledAt = normalizeProactiveScheduledAt(body.scheduledAt);

    if (!botId) throw new Error("botId is required");
    if (!targets.length) throw new Error("at least one target is required");
    if (targets.length > Number(process.env.PROACTIVE_MAX_TARGETS || 50)) {
      throw new Error("too many targets");
    }

    const task = createProactiveTask({
      botId,
      agentId: binding?.agentId || "",
      title: String(body.title || "").trim(),
      content: message.content,
      messageType: message.messageType,
      messagePayload: message.messagePayload,
      targets,
      scheduledAt,
      createdBy: "console"
    });

    if (!scheduledAt) {
      void processNextProactiveTarget().catch((error) => {
        logError("proactive.worker.failed", { error });
      });
    }

    res.json({
      ok: true,
      task,
      targets: listProactiveTaskTargets(task.id)
    });
  })
);

app.get(
  "/api/proactive/tasks",
  asyncHandler(async (req, res) => {
    const botId = String(req.query.botId || "").trim();
    assertBotAccess(req, botId);
    const page = listProactiveTasksPage({
      page: Number(req.query.page || 1),
      pageSize: Number(req.query.pageSize || req.query.limit || 20),
      botId,
      dateFrom: String(req.query.dateFrom || "").trim(),
      dateTo: String(req.query.dateTo || "").trim()
    });
    res.json({
      ok: true,
      tasks: page.items,
      pagination: page.pagination
    });
  })
);

app.get(
  "/api/proactive/tasks/:taskId",
  asyncHandler(async (req, res) => {
    const task = getProactiveTask(req.params.taskId);
    if (!task) {
      res.status(404).json({ ok: false, message: "task not found" });
      return;
    }
    assertBotAccess(req, task.botId);
    res.json({
      ok: true,
      task,
      targets: listProactiveTaskTargets(req.params.taskId)
    });
  })
);

app.post(
  "/api/proactive/tasks/:taskId/cancel",
  asyncHandler(async (req, res) => {
    const task = getProactiveTask(req.params.taskId);
    if (!task) {
      res.status(404).json({ ok: false, message: "task not found" });
      return;
    }
    assertBotAccess(req, task.botId);
    const canceledTask = cancelProactiveTask({
      id: req.params.taskId,
      reason: String(req.body?.reason || "console")
    });
    res.json({
      ok: true,
      task: canceledTask,
      targets: listProactiveTaskTargets(req.params.taskId)
    });
  })
);

app.get(
  "/api/proactive/targets/tags",
  asyncHandler(async (req, res) => {
    const botId = String(req.query.botId || "").trim();
    assertBotAccess(req, botId);
    res.json({ ok: true, tags: listProactiveTargetTags({ botId }) });
  })
);

app.get(
  "/api/proactive/targets",
  asyncHandler(async (req, res) => {
    const botId = String(req.query.botId || "").trim();
    assertBotAccess(req, botId);
    if (!botId) throw new Error("botId is required");
    const page = listProactiveAddressBookTargetsPage({
      botId,
      targetType: req.query.targetType,
      query: String(req.query.q || "").trim(),
      tagFilters: proactiveTagFiltersFromRequest(req),
      page: Number(req.query.page || 1),
      pageSize: Number(req.query.pageSize || req.query.limit || 20)
    });
    res.json({
      ok: true,
      targets: page.items,
      pagination: page.pagination
    });
  })
);

app.post(
  "/api/proactive/targets",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const botId = String(body.botId || "").trim();
    assertBotAccess(req, botId);
    if (!botId) throw new Error("botId is required");
    const target = upsertProactiveAddressBookTarget({
      botId,
      targetType: body.targetType,
      targetName: body.targetName,
      displayName: body.displayName,
      source: "manual"
    });
    res.json({ ok: true, target });
  })
);

app.post(
  "/api/proactive/targets/mock",
  asyncHandler(async (req, res) => {
    const botId = String(req.body?.botId || "").trim();
    assertBotAccess(req, botId);
    if (!botId) throw new Error("botId is required");
    res.json({
      ok: true,
      targets: insertMockProactiveTargets(botId)
    });
  })
);

app.post(
  "/api/config/:botId/message-callback",
  asyncHandler(async (req, res) => {
    assertAdminForBot(req, req.params.botId);
    const body = req.body || {};
    const callbackUrl = body.callbackUrl || buildPublicCallbackUrl(req.params.botId, "/message-callback");
    const replyAll = body.replyAll ?? 1;
    const result = await bindMessageCallback({
      robotId: req.params.botId,
      callbackUrl,
      replyAll
    });
    res.json({ ok: true, callbackUrl, result });
  })
);

app.post(
  "/api/config/:botId/command-callback",
  asyncHandler(async (req, res) => {
    assertAdminForBot(req, req.params.botId);
    const body = req.body || {};
    const callBackUrl = body.callBackUrl || buildPublicCallbackUrl(req.params.botId, "/command-callback");
    const result = await bindCommandCallback({
      robotId: req.params.botId,
      callBackUrl
    });
    res.json({ ok: true, callBackUrl, result });
  })
);

app.post(
  "/api/config/message-callback",
  asyncHandler(async (req, res) => {
    const botId = req.body?.botId || process.env.ROBOT_ID;
    if (!botId) throw new Error("botId is required");
    assertAdminForBot(req, botId);
    const callbackUrl =
      req.body?.callbackUrl || buildPublicCallbackUrl(botId, "/message-callback");
    const replyAll = req.body?.replyAll ?? 1;
    const result = await bindMessageCallback({ robotId: botId, callbackUrl, replyAll });
    res.json({ ok: true, callbackUrl, result });
  })
);

app.post(
  "/api/config/command-callback",
  asyncHandler(async (req, res) => {
    const botId = req.body?.botId || process.env.ROBOT_ID;
    if (!botId) throw new Error("botId is required");
    assertAdminForBot(req, botId);
    const callBackUrl =
      req.body?.callBackUrl || buildPublicCallbackUrl(botId, "/command-callback");
    const result = await bindCommandCallback({ robotId: botId, callBackUrl });
    res.json({ ok: true, callBackUrl, result });
  })
);

app.get(
  "/api/robot",
  asyncHandler(async (req, res) => {
    const botId = req.query.botId || process.env.ROBOT_ID;
    assertBotAccess(req, botId);
    const robotInfo = await getRobotInfo(botId);
    res.json({ ok: true, robotInfo });
  })
);

app.get(
  "/api/robot/:botId",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, req.params.botId);
    const robotInfo = await getRobotInfo(req.params.botId);
    res.json({ ok: true, robotInfo });
  })
);

app.get(
  "/api/callback-config",
  asyncHandler(async (req, res) => {
    const botId = req.query.botId || process.env.ROBOT_ID;
    assertAdminForBot(req, botId);
    const callbackConfig = await getCallbackConfig(botId);
    res.json({ ok: true, callbackConfig });
  })
);

app.get(
  "/api/callback-config/:botId",
  asyncHandler(async (req, res) => {
    assertAdminForBot(req, req.params.botId);
    const callbackConfig = await getCallbackConfig(req.params.botId);
    res.json({ ok: true, callbackConfig });
  })
);

app.get(
  "/api/logs/:name",
  asyncHandler(async (req, res) => {
    assertBotAccess(req, String(req.query.botId || "").trim());
    const logs = listRecords(req.params.name, {
      limit: Number(req.query.limit || 50),
      botId: String(req.query.botId || "").trim()
    });
    if (!logs) {
      res.status(404).json({ ok: false, message: "unknown log name" });
      return;
    }
    res.json({ ok: true, logs });
  })
);

app.use((error, req, res, next) => {
  if (error.code === "GROUP_VERSION_CONFLICT") error.status = 409;
  if (error.code === "GROUP_ADDRESS_AMBIGUOUS") error.status = 422;
  logError("http.request.failed", {
    method: req.method,
    path: req.path,
    status: error.status || 500,
    error
  });
  res.status(error.status || 500).json({
    ok: false,
    message: error.message || "internal server error"
  });
});

const migratedDateTagRuleCount = initializeLegacyDateTagRuleEffectiveTimes();
logInfo("customer_date_tag_rules.migrated", { agentCount: migratedDateTagRuleCount });
const backfilledGroupDateTagCount = backfillManagedGroupConversationDateTags();
logInfo("group_date_tags.backfilled", { conversationCount: backfilledGroupDateTagCount });

const cockpitAggregator = createCockpitAggregator({
  getConfig: getCockpitConfig,
  backfillEvents: backfillCockpitEventsFromBusiness,
  getCursor: getCockpitAggregationCursor,
  listEvents: listCockpitEvents,
  loadState: getCockpitAggregationState,
  getBaselineCharts: getCockpitBaselineCharts,
  saveState: saveCockpitAggregationState,
  saveSnapshot: saveCockpitSnapshot,
  saveCursor: saveCockpitAggregationCursor
});

const cockpitReportGenerator = createCockpitReportGenerator({
  invokeAnalysis: async ({ snapshot, request }) => {
    const binding = getBotBinding(snapshot.botId);
    if (!binding?.enabled) throw new Error("Bot is disabled");
    return invokeDclawAgentWithRetry({ binding, request });
  },
  saveReport: async (input) => {
    const existing = listCockpitReports({
      botId: input.botId,
      page: 1,
      pageSize: 100
    }).items.find((report) => (
      report.reportType === input.reportType
      && report.periodStart === input.periodStart
      && report.periodEnd === input.periodEnd
    ));
    return existing
      ? createCockpitReportRevision({ reportId: existing.id, ...input })
      : createCockpitReport(input);
  }
});

const cockpitDeliveryService = createCockpitDeliveryService({
  claimDeliveries: claimDueCockpitDeliveries,
  getReport: getCockpitReport,
  sendText: sendTextMessage,
  finishDelivery: finishCockpitDelivery,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || ""
});

function enabledCockpitBots() {
  return listBotBindings().filter((binding) => binding.enabled);
}

function scheduledReportTypes(date) {
  const types = ["daily"];
  if (date.getDay() === 1) types.push("weekly");
  if (date.getDate() === 1) types.push("monthly");
  return types;
}

async function generateScheduledCockpitReports({ now }) {
  const generated = [];
  for (const binding of enabledCockpitBots()) {
    for (const reportType of scheduledReportTypes(new Date(now))) {
      const snapshot = getLatestCockpitSnapshot({ botId: binding.botId, periodType: reportType });
      if (!snapshot) continue;
      const exists = listCockpitReports({ botId: binding.botId, page: 1, pageSize: 100 }).items
        .some((report) => (
          report.reportType === reportType
          && report.periodStart === snapshot.periodStart
          && report.periodEnd === snapshot.periodEnd
          && report.snapshotId === snapshot.id
        ));
      if (exists) continue;
      const report = await cockpitReportGenerator.generate({ snapshot });
      const schedule = getCockpitConfig(binding.botId).schedules?.[reportType];
      if (schedule?.enabled) {
        for (const recipient of schedule.recipients || []) {
          createCockpitDelivery({
            reportId: report.id,
            botId: binding.botId,
            recipient,
            dueAt: now
          });
        }
      }
      generated.push(report.id);
    }
  }
  return { generated };
}

async function recoverCockpitReportAnalysis() {
  const recovered = [];
  for (const binding of enabledCockpitBots()) {
    const reports = listCockpitReports({
      botId: binding.botId,
      page: 1,
      pageSize: 100
    }).items;
    const latestBySnapshot = new Map();
    for (const report of reports) {
      if (!latestBySnapshot.has(report.snapshotId)) {
        latestBySnapshot.set(report.snapshotId, report);
      }
    }
    for (const report of latestBySnapshot.values()) {
      const needsRecovery = report.status === "ready_with_ai_error"
        || report.summary?.analysisStatus === "fallback";
      if (!needsRecovery) continue;
      const snapshot = getLatestCockpitSnapshot({
        botId: binding.botId,
        periodType: report.reportType,
        periodStart: report.periodStart
      });
      if (!snapshot || snapshot.id !== report.snapshotId) continue;
      const revision = await cockpitReportGenerator.generate({ snapshot });
      recovered.push(revision.id);
    }
  }
  return { recovered };
}

const cockpitWorkerEnabled = process.env.COCKPIT_WORKER_ENABLED !== "false";
const cockpitWorker = createCockpitWorker({
  enabled: cockpitWorkerEnabled,
  isStageCompleted: ({ localDate, stage }) => isCockpitStageCompleted({
    localDate,
    stage: `${stage}:v${COCKPIT_STATISTICS_VERSION}`
  }),
  markStageCompleted: ({ localDate, stage, completedAt }) => markCockpitStageCompleted({
    localDate,
    stage: `${stage}:v${COCKPIT_STATISTICS_VERSION}`,
    completedAt
  }),
  handlers: {
    aggregate: async ({ now }) => {
      const results = [];
      for (const binding of enabledCockpitBots()) {
        results.push(await cockpitAggregator.aggregateBot({ botId: binding.botId, throughAt: now }));
      }
      return { bots: results.length };
    },
    reconcile: async ({ now }) => {
      const results = [];
      for (const binding of enabledCockpitBots()) {
        results.push(await cockpitAggregator.reconcileBot({ botId: binding.botId, throughAt: now }));
      }
      return { bots: results.length };
    },
    generate: generateScheduledCockpitReports,
    recover: recoverCockpitReportAnalysis,
    deliver: ({ now }) => cockpitDeliveryService.sendDue({ now })
  }
});

const cockpitBootstrap = createCockpitBootstrap({
  listBots: listBotBindings,
  getLatestSnapshot: getLatestCockpitSnapshot,
  aggregateBot: (input) => cockpitAggregator.aggregateBot(input),
  statisticsVersion: COCKPIT_STATISTICS_VERSION,
  onError: ({ botId, error }) => logWarn("cockpit.bootstrap.failed", { botId, error })
});

app.listen(port, host, () => {
  if (cockpitWorkerEnabled) {
    void cockpitBootstrap.run()
      .then((result) => logInfo("cockpit.bootstrap.completed", result))
      .catch((error) => logWarn("cockpit.bootstrap.failed", { error }))
      .finally(() => cockpitWorker.start());
  }
  logInfo("service.started", { host, port });
});
