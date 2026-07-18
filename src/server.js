import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBotBindingsFromConfig } from "./config.js";
import {
  buildDclawActivationRequest,
  buildDclawAttachmentSourceRetryRequest,
  buildDclawConversationResetRequest,
  buildDclawHandoffTranscriptRequest,
  buildDclawProactiveEventRequest,
  buildDclawReplyFormatRetryRequest,
  buildDclawRequest,
  buildDclawTagActivationRequest,
  degradeAgentReply,
  getDclawAgentMaxAttempts,
  getDclawFormatRetryTimeoutMs,
  getDclawAgentTimeoutMs,
  getAgentReplySendabilityIssue,
  invokeDclawAgentWithRetry,
  parseConversationResetAcknowledgement,
  parseAgentReply
} from "./dclaw.js";
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
  beginMessageProcessing,
  beginFriendAddedFlowEntry,
  buildMessageKey,
  cancelFlowActivationTasks,
  cancelTagActivationTasks,
  claimDueFlowActivationTasks,
  claimDueTagActivationTasks,
  claimNextProactiveTarget,
  clearConversationForReset,
  createProactiveTask,
  deleteAgent,
  deleteBotData,
  finishAgentInvocation,
  finishMessageProcessing,
  getAgent,
  getBotBinding,
  getConversationKey,
  getConversationResetPending,
  getConversationAssets,
  getFlowMachineForBot,
  getFlowActivationProgress,
  getFlowSession,
  getFlowSessionForBot,
  isFlowActivationTaskProcessing,
  getOrCreateConversationSession,
  getOrCreateFlowSession,
  getSetting,
  getProactiveTask,
  incrementFlowActivationGeneration,
  insertAgentInvocationStart,
  insertConversationMessage,
  insertCommandCallback,
  insertIncomingMessage,
  insertOutgoingMessage,
  insertMockProactiveTargets,
  resetBotFlowStateForAgentRebind,
  applyConversationTagChanges,
  getAgentTagSchema,
  listConversationMessages,
  listConversationTags,
  listFlowMachines,
  listFlowSessions,
  listFlowStateEvents,
  listTagActivationTasks,
  listProactiveAddressBookTargets,
  listProactiveTasks,
  listProactiveTaskTargets,
  listAgents,
  listBotBindings,
  finalizeFlowActivationTaskDelivery,
  listRecords,
  markFlowActivationTaskFailed,
  markTagActivationTaskFailed,
  markTagActivationTaskSent,
  markConversationResetHandled,
  markProactiveTargetFailed,
  markProactiveTargetAgentSync,
  markProactiveTargetSent,
  mergeFlowSessionData,
  normalizeActivationConfig,
  resetInterruptedProactiveTargets,
  reserveTagActivationTaskForSend,
  scheduleFlowActivationTask,
  scheduleTagActivationTask,
  setSetting,
  setBotAccessKey,
  touchFlowSession,
  updateFlowSessionHandoff,
  updateFlowSessionNode,
  updateProactiveTargetFromCommandCallback,
  updateOutgoingMessageFromCommandCallback,
  upsertAgent,
  upsertAgentTagSchema,
  upsertSystemDateTag,
  upsertFlowMachine,
  upsertProactiveAddressBookTarget,
  upsertBotBinding,
  upsertConversation
} from "./db.js";
import {
  buildRawMediaCommand,
  bindCommandCallback,
  bindMessageCallback,
  getCallbackConfig,
  getRobotInfo,
  sendRawCommand,
  sendMediaMessage,
  sendTextMessage,
  unbindCommandCallback,
  unbindMessageCallback
} from "./worktool.js";
import {
  friendAddedName,
  isFriendAddedEvent,
  isSystemFriendGreeting,
  shouldProcessInboundForAgent
} from "./message-rules.js";
import { normalizeUploadedFilename } from "./filenames.js";
import { createInboundMessageCoalescer } from "./inbound-coalescer.js";
import {
  adjudicateTagDecision,
  compactTagRulesForAgent,
  dateTagIdFor,
  normalizeTagSchema
} from "./tags.js";

const app = express();
const port = Number(process.env.PORT || 8765);
const host = process.env.HOST || "0.0.0.0";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");
const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR || "data");
const uploadDir = path.join(dataDir, "uploads");
const uploadMaxMb = Number(process.env.UPLOAD_MAX_MB || 100);
const uploadAllowedOrigins = String(process.env.UPLOAD_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const agentFailureFallbackReply =
  process.env.AGENT_FAILURE_FALLBACK_REPLY || "刚刚这边有点卡，我稍后回复你哈";
const uploadRetentionMs = Number(process.env.UPLOAD_RETENTION_HOURS || 24) * 60 * 60 * 1000;
const uploadCleanupIntervalMs =
  Number(process.env.UPLOAD_CLEANUP_INTERVAL_MINUTES || 60) * 60 * 1000;
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
resetInterruptedProactiveTargets();

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
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    const error = new Error("admin API key is not configured");
    error.status = 503;
    throw error;
  }
  const actual = req.header("x-api-key") || req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (actual !== expected) {
    const error = new Error("invalid admin api key");
    error.status = 401;
    throw error;
  }
}

function getRequestAdminKey(req) {
  return req.header("x-api-key") || req.header("authorization")?.replace(/^Bearer\s+/i, "");
}

function isAdminKey(req) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return false;
  return getRequestAdminKey(req) === expected;
}

function getRequestBotSession(req) {
  const token = req.header("x-bot-session-token");
  return getBotSession(token);
}

function assertAdminAccess(req) {
  if (isAdminKey(req)) return { role: "admin", botId: "*" };
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
  const session = getRequestBotSession(req);
  if (session?.role === "admin" && session.botId === expectedBotId) return session;
  const error = new Error("admin access required");
  error.status = 401;
  throw error;
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
    res.setHeader("Access-Control-Allow-Headers", "x-api-key, x-bot-session-token, authorization, content-type");
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
  if (!binding?.agentId) return;
  upsertConversation({
    botId,
    agentId: binding.agentId,
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
}

function isPrivateConversationKey(conversationKey) {
  return String(conversationKey || "").includes(":private:");
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + Number(minutes || 0) * 60 * 1000).toISOString();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function activationDueAtForAttempt(anchorAt, intervalMinutes, attemptNumber) {
  const multiplier = 2 ** Math.max(0, attemptNumber - 1);
  return addMinutes(new Date(anchorAt), Number(intervalMinutes || 0) * multiplier);
}

function activationMessageForAttempt(task) {
  if (!task?.messages?.length) return "";
  const index = Math.min(task.attemptNumber - 1, task.messages.length - 1);
  return task.messages[Math.max(0, index)] || "";
}

function privateTargetNameFromConversationKey(conversationKey) {
  return String(conversationKey || "").split(":private:")[1] || "";
}

function invalidateFlowActivation({ conversationKey, reason }) {
  const session = incrementFlowActivationGeneration({ conversationKey, reason });
  cancelFlowActivationTasks({ conversationKey, reason });
  return session;
}

function buildTagContext({ binding, conversationKey }) {
  if (!binding?.agentId) return null;
  const schemaRow = getAgentTagSchema(binding.agentId);
  const schema = normalizeTagSchema(schemaRow?.config || {});
  const currentTags = listConversationTags({
    botId: binding.botId,
    agentId: binding.agentId,
    conversationKey
  });
  return compactTagRulesForAgent({ schema, currentTags });
}

function applySystemDateTag({ botId, binding, conversationKey }) {
  if (!binding?.agentId) return null;
  const schema = normalizeTagSchema(getAgentTagSchema(binding.agentId)?.config || {});
  if (!schema.dateTag.enabled) return null;
  return upsertSystemDateTag({
    botId,
    agentId: binding.agentId,
    conversationKey,
    dateTagId: dateTagIdFor(new Date()),
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

function normalizeMessageForAgent(message, binding) {
  if (!isGroupMessage(message) || !isMentioned(message, binding)) {
    return message;
  }
  const originalAtMe = message.atMe ?? message.metadata?.atMe ?? "";
  return {
    ...message,
    atMe: "true",
    metadata: {
      ...(message.metadata || {}),
      atMe: "true",
      originalAtMe
    }
  };
}

function getFlowNode(machine, nodeId) {
  const nodes = machine?.config?.nodes || machine?.nodes || [];
  return nodes.find((node) => node.id === nodeId) || null;
}

function buildFlowContext({ botId, conversationKey, message }) {
  if (!isPrivateMessage(message)) return null;
  const machine = getFlowMachineForBot(botId);
  if (!machine || !machine.enabled) return null;
  const session = getOrCreateFlowSession({ botId, conversationKey, machine });
  const currentNode = getFlowNode(machine, session.currentNodeId) ||
    getFlowNode(machine, machine.entryNodeId);
  const recentMessages = listConversationMessages({ conversationKey, limit: 20 }).slice(-12);
  return {
    machine: {
      name: machine.name,
      version: machine.version,
      entryNodeId: machine.entryNodeId,
      nodes: machine.config.nodes
    },
    session,
    currentNode,
    recentMessages
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
  if (!binding?.agentId || !isPrivateConversationKey(conversationKey)) return [];
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

async function applyFlowDecision({ botId, binding, conversationKey, message, flow, decision }) {
  if (!flow || !decision || typeof decision !== "object") return;
  const patch = decision.collectedDataPatch || decision.collectedFields || decision.dataPatch || {};
  if (patch && typeof patch === "object" && !Array.isArray(patch)) {
    mergeFlowSessionData({ conversationKey, patch });
  }

  const nextNodeId = String(decision.nextNodeId || "").trim();
  if (
    decision.nodeCompleted === true &&
    nextNodeId &&
    nextNodeId !== flow.session.currentNodeId &&
    isValidFlowNode(flow.machine, nextNodeId)
  ) {
    updateFlowSessionNode({
      botId,
      conversationKey,
      nextNodeId,
      reason: decision.reason || "Agent 判断节点完成",
      decision
    });
    invalidateFlowActivation({ conversationKey, reason: "node_transition" });
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
const friendAddedReentryCooldownMs = Math.max(
  0,
  Number(process.env.FRIEND_ADDED_REENTRY_COOLDOWN_MINUTES || 0) * 60 * 1000
);

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

const inboundCoalesceQuietMs = Math.max(
  0,
  Number(process.env.INBOUND_COALESCE_QUIET_MS || 10_000)
);
const inboundCoalesceMaxMs = Math.max(
  inboundCoalesceQuietMs,
  Number(process.env.INBOUND_COALESCE_MAX_MS || 15_000)
);

let proactiveWorkerBusy = false;
let activationWorkerBusy = false;
let tagActivationWorkerBusy = false;
let agentQueue = Promise.resolve();

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
  quietMs: inboundCoalesceQuietMs,
  maxMs: inboundCoalesceMaxMs,
  onFlush: processCoalescedIncomingBatch,
  onEvent: (name, details) => {
    const event = inboundCoalesceEventNames[name] || `incoming.coalesce.${name}`;
    const fields = {
      batchId: details.id,
      botId: details.botId,
      conversationKey: details.conversationKey,
      messageCount: details.itemCount,
      reason: details.reason || "",
      waitMs: details.waitMs ?? null
    };
    if (name === "canceled") logWarn(event, fields);
    else logInfo(event, fields);
  }
});

function enqueueAgentInvocation(task) {
  const run = agentQueue.then(task, task);
  agentQueue = run.catch(() => {});
  return run;
}

export async function syncConversationResetToAgent({
  binding,
  conversationKey,
  reason = "console_reset",
  invoke = null
}) {
  if (!binding?.enabled) {
    return { status: "skipped" };
  }

  const request = buildDclawConversationResetRequest({
    binding,
    conversationKey,
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
    const invocation = invoke
      ? await invoke({ binding, request })
      : await enqueueAgentInvocation(() => invokeDclawAgentWithRetry({ binding, request }));
    if (!parseConversationResetAcknowledgement(invocation?.reply).ok) {
      throw new Error("invalid conversation reset acknowledgement");
    }
    finishAgentInvocation({
      id: invocationId,
      response: invocation.response || null,
      status: "success"
    });
    markConversationResetHandled(conversationKey);
    logInfo("agent.conversation_reset.success", {
      botId: binding.botId,
      agentId: binding.agentId,
      conversationKey,
      invocationId,
      durationMs: Date.now() - startedAt
    });
    return { status: "synced" };
  } catch (error) {
    finishAgentInvocation({
      id: invocationId,
      response: null,
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
    return { status: "pending" };
  }
}

function invalidSendabilityAgentReply(rawReply, sendabilityIssue) {
  return {
    valid: false,
    reply: "",
    attachments: [],
    sources: [],
    flowDecision: null,
    raw: rawReply,
    sendabilityIssue
  };
}

async function invokeStrictAgentReply({
  binding,
  request,
  onRetry,
  onFormatRetry,
  onAttachmentSourceRetry,
  onInvalidAttachmentSource,
  onDegrade
}) {
  const first = await enqueueAgentInvocation(() =>
    invokeDclawAgentWithRetry({ binding, request, onRetry })
  );
  let agentReply = parseAgentReply(first.reply);
  if (agentReply.valid) {
    const sendabilityIssue = getAgentReplySendabilityIssue(agentReply);
    if (!sendabilityIssue) {
      return { invocation: first, agentReply, formatAttempts: 1, attachmentSourceAttempts: 1 };
    }
    onAttachmentSourceRetry?.({
      rawReplyLength: String(first.reply || "").length,
      issue: sendabilityIssue
    });
    const attachmentRetryRequest = buildDclawAttachmentSourceRetryRequest(request, sendabilityIssue);
    const retried = await enqueueAgentInvocation(() =>
      invokeDclawAgentWithRetry({
        binding,
        request: attachmentRetryRequest,
        timeoutMs: getDclawFormatRetryTimeoutMs(),
        onRetry
      })
    );
    agentReply = parseAgentReply(retried.reply);
    if (!agentReply.valid) {
      const degraded = degradeAgentReply(retried.reply);
      if (degraded.valid) {
        onDegrade?.({
          rawReplyLength: String(retried.reply || "").length,
          reason: "attachment_source_retry_invalid"
        });
        agentReply = degraded;
      }
    }
    const retryIssue = getAgentReplySendabilityIssue(agentReply);
    if (retryIssue) {
      onInvalidAttachmentSource?.({
        rawReplyLength: String(retried.reply || "").length,
        issue: retryIssue
      });
      agentReply = invalidSendabilityAgentReply(retried.reply, retryIssue);
    }
    return {
      invocation: {
        ...retried,
        request,
        response: {
          initial: first.response,
          attachmentSourceRetry: retried.response
        },
        attempts: Number(first.attempts || 1) + Number(retried.attempts || 1)
      },
      agentReply,
      formatAttempts: 1,
      attachmentSourceAttempts: 2
    };
  }

  onFormatRetry?.({ rawReplyLength: String(first.reply || "").length });
  const formatRetryRequest = buildDclawReplyFormatRetryRequest(request);
  let repaired;
  try {
    repaired = await enqueueAgentInvocation(() =>
      invokeDclawAgentWithRetry({
        binding,
        request: formatRetryRequest,
        timeoutMs: getDclawFormatRetryTimeoutMs(),
        onRetry
      })
    );
  } catch (error) {
    const degraded = degradeAgentReply(first.reply);
    if (degraded.valid) {
      onDegrade?.({
        rawReplyLength: String(first.reply || "").length,
        reason: "format_retry_failed",
        error: error.message
      });
      return {
        invocation: {
          ...first,
          request,
          response: {
            initial: first.response,
            formatRetryError: error.message
          },
          attempts: Number(first.attempts || 1) + 1
        },
        agentReply: degraded,
        formatAttempts: 2
      };
    }
    throw error;
  }
  agentReply = parseAgentReply(repaired.reply);
  if (!agentReply.valid) {
    const degraded = degradeAgentReply(repaired.reply);
    if (degraded.valid) {
      onDegrade?.({
        rawReplyLength: String(repaired.reply || "").length,
        reason: "format_retry_invalid"
      });
      agentReply = degraded;
    }
  }
  const sendabilityIssue = getAgentReplySendabilityIssue(agentReply);
  if (sendabilityIssue) {
    onAttachmentSourceRetry?.({
      rawReplyLength: String(repaired.reply || "").length,
      issue: sendabilityIssue
    });
    const attachmentRetryRequest = buildDclawAttachmentSourceRetryRequest(request, sendabilityIssue);
    const retried = await enqueueAgentInvocation(() =>
      invokeDclawAgentWithRetry({
        binding,
        request: attachmentRetryRequest,
        timeoutMs: getDclawFormatRetryTimeoutMs(),
        onRetry
      })
    );
    agentReply = parseAgentReply(retried.reply);
    if (!agentReply.valid) {
      const degraded = degradeAgentReply(retried.reply);
      if (degraded.valid) {
        onDegrade?.({
          rawReplyLength: String(retried.reply || "").length,
          reason: "attachment_source_retry_invalid"
        });
        agentReply = degraded;
      }
    }
    const retryIssue = getAgentReplySendabilityIssue(agentReply);
    if (retryIssue) {
      onInvalidAttachmentSource?.({
        rawReplyLength: String(retried.reply || "").length,
        issue: retryIssue
      });
      agentReply = invalidSendabilityAgentReply(retried.reply, retryIssue);
    }
    return {
      invocation: {
        ...retried,
        request,
        response: {
          initial: first.response,
          formatRetry: repaired.response,
          attachmentSourceRetry: retried.response
        },
        attempts:
          Number(first.attempts || 1) +
          Number(repaired.attempts || 1) +
          Number(retried.attempts || 1)
      },
      agentReply,
      formatAttempts: 2,
      attachmentSourceAttempts: 2
    };
  }
  return {
    invocation: {
      ...repaired,
      request,
      response: {
        initial: first.response,
        formatRetry: repaired.response
      },
      attempts: Number(first.attempts || 1) + Number(repaired.attempts || 1)
    },
    agentReply,
    formatAttempts: 2,
    attachmentSourceAttempts: 1
  };
}

function getDebugReplySettingKey(botId) {
  return `debug_reply:${String(botId || "").trim()}`;
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

async function sendTextReplyParts({ robotId, target, reply, allowSplit }) {
  const parts = splitAgentReplyForWorkTool(reply, { allowSplit });
  const results = [];
  for (const [index, content] of parts.entries()) {
    if (index > 0 && replySplitConfig.delayMs > 0) {
      await sleep(replySplitConfig.delayMs);
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

async function sendAgentAttachments({ robotId, target, attachments = [] }) {
  const sent = [];
  for (const attachment of attachments.map(normalizeAgentAttachment).filter(Boolean)) {
    if (!supportedAgentMediaTypes.has(attachment.type)) continue;
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
  const reply = String(agentFailureFallbackReply || "").trim();
  if (!reply) return false;
  const target = getReplyTarget(message);
  if (!target) return false;

  const sentParts = await sendTextReplyParts({
    robotId: botId,
    target,
    reply,
    allowSplit: false
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
      reason: "agent_invocation_failed",
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

async function handleFriendAddedEvent({ botId, binding, message, logContext }) {
  const friendName = friendAddedName(message);
  logInfo("friend_added.received", {
    ...logContext,
    friendName,
    eventType: message.type
  });
  if (!friendName) {
    logInfo("friend_added.skipped", {
      ...logContext,
      reason: "missing_friend_name"
    });
    return "skipped";
  }
  if (!binding?.enabled) {
    logInfo("friend_added.skipped", {
      ...logContext,
      friendName,
      reason: "no_enabled_binding"
    });
    return "skipped";
  }

  const contactMessage = {
    ...message,
    roomType: 2,
    receivedName: friendName,
    groupName: friendName
  };
  const conversationKey = getConversationKey(botId, contactMessage);
  upsertConversation({
    botId,
    agentId: binding.agentId,
    conversationKey,
    message: contactMessage
  });
  const dateTags = applySystemDateTag({ botId, binding, conversationKey });
  if (dateTags) {
    logInfo("friend_added.date_tag.applied", {
      ...logContext,
      conversationKey,
      agentId: binding.agentId,
      tagCount: dateTags.length
    });
  }
  const machine = getFlowMachineForBot(botId);
  if (!machine?.enabled) {
    logInfo("friend_added.skipped", {
      ...logContext,
      friendName,
      conversationKey,
      reason: "no_enabled_flow_machine"
    });
    return "skipped";
  }
  const entryNode = getFlowNode(machine, machine.entryNodeId);
  const activation = normalizeActivationConfig(entryNode?.activation || {});
  const canScheduleActivation = activation.enabled && activation.messages.length > 0;
  const entryAnchorAt = new Date().toISOString();
  const entryResult = beginFriendAddedFlowEntry({
    botId,
    conversationKey,
    machine,
    cooldownMs: friendAddedReentryCooldownMs,
    occurredAt: entryAnchorAt,
    activationTask: canScheduleActivation
      ? {
          agentId: binding.agentId,
          activation,
          anchorAt: entryAnchorAt,
          dueAt: activationDueAtForAttempt(entryAnchorAt, activation.messages[0].intervalMinutes, 1)
        }
      : null
  });
  if (entryResult.status === "cooldown") {
    logInfo("friend_added.skipped", {
      ...logContext,
      friendName,
      conversationKey,
      reason: "friend_added_cooldown"
    });
    return "skipped";
  }
  if (entryResult.status === "duplicate") {
    logInfo("friend_added.skipped", {
      ...logContext,
      friendName,
      conversationKey,
      reason: "friend_added_duplicate"
    });
    return "skipped";
  }
  if (!canScheduleActivation) {
    logInfo("friend_added.skipped", {
      ...logContext,
      friendName,
      conversationKey,
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
  upsertConversation({
    botId: target.botId,
    agentId: binding.agentId,
    conversationKey,
    message: buildProactiveConversationMessage(target)
  });
  const request = buildDclawProactiveEventRequest({
    binding,
    conversationKey,
    target,
    worktoolMessageId: messageId,
    worktoolResponse
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
    const invocation = await enqueueAgentInvocation(() =>
      invokeDclawAgentWithRetry({
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
      })
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

async function sendActivationRawMessages({ task, binding }) {
  const target = privateTargetNameFromConversationKey(task.conversationKey);
  if (!target) throw new Error("missing activation target");
  const content = String(task.messageContent || "").trim();
  if (!content) throw new Error("empty activation message");
  assertActivationTaskStillSendable(task);
  const result = await sendTextMessage({
    robotId: task.botId,
    targets: [target],
    content
  });
  recordActivationOutbound({
    task,
    binding,
    target,
    content,
    result,
    rawPayload: {
      polishByAgent: false,
      activationMessageIndex: task.messageIndex
    }
  });
  return [result.data || ""].filter(Boolean);
}

async function sendActivationPolishedMessage({ task, binding }) {
  const target = privateTargetNameFromConversationKey(task.conversationKey);
  if (!target) throw new Error("missing activation target");
  const activationMessage = String(task.messageContent || "").trim();
  if (!activationMessage) throw new Error("empty activation message");
  const machine = getFlowMachineForBot(task.botId);
  const session = getFlowSession(task.conversationKey);
  const flow = machine && session
    ? {
        machine: {
          name: machine.name,
          version: machine.version,
          entryNodeId: machine.entryNodeId,
          nodes: machine.config.nodes
        },
        session,
        currentNode: getFlowNode(machine, session.currentNodeId),
        recentMessages: listConversationMessages({ conversationKey: task.conversationKey, limit: 20 }).slice(-12)
      }
    : null;
  const recentMessages = flow?.recentMessages || listConversationMessages({
    conversationKey: task.conversationKey,
    limit: 12
  });
  const request = buildDclawActivationRequest({
    binding,
    conversationKey: task.conversationKey,
    task: {
      ...task,
      messages: [activationMessage]
    },
    flow,
    recentMessages
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
      onDegrade: ({ rawReplyLength, reason, error }) => {
        logWarn("activation.agent.degraded", {
          activationTaskId: task.id,
          botId: task.botId,
          agentId: binding.agentId,
          conversationKey: task.conversationKey,
          invocationId,
          rawReplyLength,
          reason,
          error: error || ""
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
    const worktoolMessageIds = task.polishByAgent
      ? await sendActivationPolishedMessage({ task, binding })
      : await sendActivationRawMessages({ task, binding });
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
  const recentMessages = listConversationMessages({
    conversationKey: task.conversationKey,
    limit: 12
  });
  const request = buildDclawTagActivationRequest({
    binding,
    conversationKey: task.conversationKey,
    task,
    recentMessages
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
      onDegrade: ({ rawReplyLength, reason, error }) => {
        logWarn("tag.activation.agent.degraded", {
          tagActivationTaskId: task.id,
          botId: task.botId,
          agentId: binding.agentId,
          conversationKey: task.conversationKey,
          invocationId,
          rawReplyLength,
          reason,
          error: error || ""
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

  if (!strictInvocation.agentReply.valid || strictInvocation.agentReply.degraded) {
    const sendabilityIssue = strictInvocation.agentReply.sendabilityIssue;
    const errorCode = strictInvocation.agentReply.degraded
      ? "degraded_tag_activation_reply"
      : sendabilityIssue ? "invalid_agent_attachment_source" : "invalid_agent_reply_format";
    finishAgentInvocation({
      id: invocationId,
      response: strictInvocation.invocation.response,
      status: "failed",
      error: errorCode
    });
    logWarn(
      strictInvocation.agentReply.degraded
        ? "tag.activation.agent.degraded_rejected"
        : sendabilityIssue ? "tag.activation.agent.invalid_attachment_source" : "tag.activation.agent.invalid_format",
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
    const target = privateTargetNameFromConversationKey(task.conversationKey);
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
    const target = claimNextProactiveTarget();
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
        if (flowMachine?.enabled) {
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

async function processIncomingMessage({ botId, message }) {
  const startedAt = Date.now();
  const binding = getBotBinding(botId);
  const conversationKey = getConversationKey(botId, message);
  const messageKey = buildMessageKey({ botId, conversationKey, message });
  const baseLog = messageLogFields({ botId, conversationKey, message });
  const logContext = { ...baseLog, messageKey };
  logInfo("incoming.received", logContext);

  if (!beginMessageProcessing({
    messageKey,
    botId,
    conversationKey,
    messageId: message.messageId
  })) {
    logWarn("incoming.duplicate_skipped", logContext);
    return;
  }

  insertIncomingMessage({ botId, conversationKey, payload: message });

  if (isFriendAddedEvent(message)) {
    await handleFriendAddedEvent({ botId, binding, message, logContext });
    finishMessageProcessing({ messageKey, status: "processed" });
    return;
  }

  if (isSystemFriendGreeting(message)) {
    recordSystemFriendGreeting({ botId, binding, conversationKey, message });
    logInfo("incoming.skipped", {
      ...logContext,
      reason: "system_friend_greeting"
    });
    finishMessageProcessing({ messageKey, status: "system_friend_greeting" });
    return;
  }

  // A private customer interaction cancels pending reminders even when the
  // payload cannot be passed to the Agent (for example an unsupported image).
  if (isPrivateMessage(message)) {
    invalidateFlowActivation({ conversationKey, reason: "customer_replied" });
  }

  if (!shouldProcessInboundForAgent(message)) {
    logInfo("incoming.skipped", {
      ...logContext,
      reason: "non_text_or_empty_message"
    });
    finishMessageProcessing({ messageKey, status: "skipped" });
    return;
  }

  const coalesceKey = inboundCoalesceKey(botId, conversationKey);
  const joinsMentionedGroupBatch = isGroupMessage(message) && inboundCoalescer.has(coalesceKey);
  if (!shouldInvokeAgent(message, binding) && !joinsMentionedGroupBatch) {
    logInfo("incoming.skipped", {
      ...logContext,
      reason: "group_message_without_mention"
    });
    finishMessageProcessing({ messageKey, status: "skipped" });
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

  const conversation = upsertConversation({
    botId,
    agentId: binding.agentId,
    conversationKey,
    message
  });
  if (isGroupMessage(message)) {
    getOrCreateConversationSession({ botId, conversationKey });
  }
  if (shouldRecordConversationHistory(message)) {
    insertConversationMessage({
      botId,
      conversationKey,
      direction: "inbound",
      senderName: message.receivedName || "",
      content: message.spoken || message.rawSpoken || "",
      rawPayload: message
    });
  }
  const flow = buildFlowContext({ botId, conversationKey, message });
  const conversationReset = getConversationResetPending(conversationKey);
  if (isPrivateMessage(message) && flow?.session?.handoffStatus === "human") {
    const request = buildDclawHandoffTranscriptRequest({
      binding,
      conversation,
      message,
      flow,
      conversationReset
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
      const invocation = await enqueueAgentInvocation(() =>
        invokeDclawAgentWithRetry({
          binding,
          request,
          onRetry: (retry) => {
            logWarn("agent.handoff_sync.retry", {
              ...logContext,
              agentId: binding.agentId,
              invocationId,
              attempt: retry.attempt,
              maxAttempts: retry.maxAttempts,
              timeoutMs: retry.timeoutMs,
              error: retry.error.message
            });
          }
        })
      );
      finishAgentInvocation({
        id: invocationId,
        response: invocation.response,
        status: "success"
      });
      if (conversationReset) {
        markConversationResetHandled(conversationKey);
      }
      logInfo("agent.handoff_sync.success", {
        ...logContext,
        agentId: binding.agentId,
        invocationId,
        durationMs: Date.now() - handoffStartedAt,
        attempts: invocation.attempts || 1,
        timeoutMs: getDclawAgentTimeoutMs(),
        maxAttempts: getDclawAgentMaxAttempts(),
        sessionId: invocation.sessionId || ""
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

  inboundCoalescer.push(coalesceKey, {
    botId,
    conversationKey,
    message,
    messageKey,
    acceptedAt: new Date().toISOString()
  });
}

async function processCoalescedIncomingBatch(batch) {
  const startedAt = Date.now();
  const botId = batch.botId;
  const conversationKey = batch.conversationKey;
  const messages = batch.items.map((item) => item.message);
  const coalescedMessage = buildCoalescedAgentMessage(messages);
  const message = coalescedMessage;
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

  const conversation = upsertConversation({
    botId,
    agentId: binding.agentId,
    conversationKey,
    message
  });
  const flow = buildFlowContext({ botId, conversationKey, message });
  const conversationReset = getConversationResetPending(conversationKey);
  if (isPrivateMessage(message) && flow?.session?.handoffStatus === "human") {
    logInfo("incoming.skipped", {
      ...logContext,
      reason: "human_handoff_after_coalesce"
    });
    finishCoalescedMessageProcessing({ batch, status: "human_handoff" });
    return;
  }

  const agentMessage = normalizeMessageForAgent(coalescedMessage, binding);
  const tagContext = buildTagContext({ binding, conversationKey });
  const request = buildDclawRequest({
    binding,
    conversation,
    message: agentMessage,
    flow,
    tagContext,
    conversationReset
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
  try {
    const strictInvocation = await invokeStrictAgentReply({
      binding,
      request,
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
      onDegrade: ({ rawReplyLength, reason, error }) => {
        logWarn("agent.reply.degraded", {
          ...logContext,
          agentId: binding.agentId,
          invocationId,
          rawReplyLength,
          reason,
          error: error || ""
        });
      }
    });

    if (!strictInvocation.agentReply.valid) {
      const sendabilityIssue = strictInvocation.agentReply.sendabilityIssue;
      const errorCode = sendabilityIssue ? "invalid_agent_attachment_source" : "invalid_agent_reply_format";
      finishAgentInvocation({
        id: invocationId,
        response: strictInvocation.invocation.response,
        status: "failed",
        error: errorCode
      });
      logWarn(sendabilityIssue ? "agent.reply.invalid_attachment_source" : "agent.reply.invalid_format", {
        ...logContext,
        agentId: binding.agentId,
        invocationId,
        formatAttempts: strictInvocation.formatAttempts,
        attachmentSourceAttempts: strictInvocation.attachmentSourceAttempts,
        issueCode: sendabilityIssue?.code || "",
        attachmentUrls: sendabilityIssue?.attachmentUrls || []
      });
      finishCoalescedMessageProcessing({
        batch,
        status: sendabilityIssue ? "invalid_attachment_source" : "invalid_reply_format",
        error: errorCode
      });
      return;
    }

    const invocation = strictInvocation.invocation;

    finishAgentInvocation({
      id: invocationId,
      response: invocation.response,
      status: "success"
    });
    agentInvocationSucceeded = true;
    if (conversationReset) {
      markConversationResetHandled(conversationKey);
    }

    const agentReply = strictInvocation.agentReply;
    const reply = String(agentReply.reply || "").trim();
    const attachments = Array.isArray(agentReply.attachments) ? agentReply.attachments : [];
    const sources = Array.isArray(agentReply.sources) ? agentReply.sources : [];
    const tagUpdate = applyAgentTagDecision({
      botId,
      binding,
      conversationKey,
      agentReply
    });
    if (tagUpdate) {
      logInfo("tag.decision.applied", {
        ...logContext,
        agentId: binding.agentId,
        invocationId,
        tagCount: tagUpdate.tags.length
      });
    }
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

    const sentParts = await sendTextReplyParts({
      robotId: botId,
      target,
      reply: replyWithLinkAttachments,
      allowSplit: isPrivateMessage(message) || replySplitConfig.splitGroup
    });
    const sentAttachments = await sendAgentAttachments({
      robotId: botId,
      target,
      attachments
    });
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
        decision: agentReply.flowDecision
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
          tags: tagUpdate?.tags || listConversationTags({ botId, agentId: binding.agentId, conversationKey }),
          flowDecision: agentReply.flowDecision,
          tagDecision: agentReply.tagDecision,
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
          tags: tagUpdate?.tags || listConversationTags({ botId, agentId: binding.agentId, conversationKey }),
          tagDecision: agentReply.tagDecision,
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
    if (!agentInvocationSucceeded) {
      finishAgentInvocation({
        id: invocationId,
        response: null,
        status: "failed",
        error: error.message
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

function applyAgentTagDecision({ botId, binding, conversationKey, agentReply }) {
  if (!binding?.agentId) return null;
  const schema = normalizeTagSchema(getAgentTagSchema(binding.agentId)?.config || {});
  if (!schema.groups.length) return null;
  const currentTags = listConversationTags({ botId, agentId: binding.agentId, conversationKey });
  const result = adjudicateTagDecision({
    schema,
    currentTags: currentTags.filter((tag) => tag.tagType !== "date"),
    decision: agentReply?.tagDecision || {}
  });
  if (!result.accepted.length && !result.rejected.length) return null;
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
    source: "agent_decision"
  });
  const scheduledTagActivationTasks = scheduleTagActivationsForAcceptedChanges({
    botId,
    binding,
    conversationKey,
    accepted: result.accepted
  });
  if (canceledTagActivationTaskCount) {
    logInfo("tag.activation.canceled", {
      botId,
      agentId: binding.agentId,
      conversationKey,
      count: canceledTagActivationTaskCount
    });
  }
  for (const task of scheduledTagActivationTasks) {
    logInfo("tag.activation.scheduled", {
      botId,
      agentId: binding.agentId,
      conversationKey,
      tagActivationTaskId: task.id,
      groupId: task.groupId,
      tagId: task.tagId,
      attemptNumber: task.attemptNumber,
      dueAt: task.dueAt
    });
  }
  const tagActivationTasks = scheduledTagActivationTasks.length
    ? listTagActivationTasks({ botId, agentId: binding.agentId, conversationKey })
    : [];
  return {
    tags,
    accepted: result.accepted,
    rejected: result.rejected,
    canceledTagActivationTaskCount,
    scheduledTagActivationTasks,
    tagActivationTasks
  };
}

function applyManualConversationTagChange({ botId, binding, conversationKey, groupId, tagId, action = "set" }) {
  if (!binding?.agentId) throw new Error("no enabled bot binding");
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

  res.json({ code: 0, message: "参数接收成功" });

  void processIncomingMessage({
    botId: req.params.botId,
    message: req.body || {}
  }).catch((error) => {
    logError("message_callback.process_failed", {
      botId: req.params.botId,
      messageId: req.body?.messageId || "",
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

  res.json({ code: 0, message: "参数接收成功" });

  void processIncomingMessage({
    botId,
    message: req.body || {}
  }).catch((error) => {
    logError("message_callback.process_failed", {
      botId,
      messageId: req.body?.messageId || "",
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
  res.json({ code: 0, message: "参数接收成功" });
});

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
    if (process.env.ADMIN_API_KEY && key === process.env.ADMIN_API_KEY) {
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
    assertAdminForBot(req, req.params.botId);
    const accessKey = String(req.body?.accessKey || "").trim();
    if (!accessKey) throw new Error("accessKey is required");
    const binding = setBotAccessKey({ botId: req.params.botId, accessKey });
    res.json({ ok: true, binding });
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
    res.json({ ok: true, agentId: binding.agentId, schema: schema.config });
  })
);

app.get(
  "/api/flow-sessions",
  asyncHandler(async (req, res) => {
    const botId = String(req.query.botId || "").trim();
    assertBotAccess(req, botId);
    const binding = getBotBinding(botId);
    const sessions = listFlowSessions({
      botId,
      limit: Number(req.query.limit || 100)
    }).map((session) => ({
      ...session,
      ...(binding
        ? { tags: listConversationTags({ botId, agentId: binding.agentId, conversationKey: session.conversationKey }) }
        : { tags: [] })
    }));
    res.json({
      ok: true,
      sessions
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
    res.json({
      ok: true,
      session,
      ...(binding
        ? { tags: listConversationTags({ botId, agentId: binding.agentId, conversationKey }) }
        : { tags: [] }),
      messages: listConversationMessages({
        botId,
        conversationKey,
        limit: Number(req.query.limit || 300)
      }),
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
    if (!isPrivateConversationKey(conversationKey)) {
      throw new Error("manual reply only supports private conversations");
    }
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
    const target = privateTargetNameFromConversationKey(conversationKey);
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
    const agentSync = await syncConversationResetToAgent({
      binding,
      conversationKey,
      reason: "console_reset"
    });
    logInfo("flow_session.reset", { botId, conversationKey });
    res.json({ ok: true, session, agentSync });
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
      createdBy: "console"
    });

    void processNextProactiveTarget().catch((error) => {
      logError("proactive.worker.failed", { error });
    });

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
    assertBotAccess(req, String(req.query.botId || "").trim());
    res.json({
      ok: true,
      tasks: listProactiveTasks({
        limit: Number(req.query.limit || 20),
        botId: String(req.query.botId || "").trim(),
        dateFrom: String(req.query.dateFrom || "").trim(),
        dateTo: String(req.query.dateTo || "").trim()
      })
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

app.get(
  "/api/proactive/targets",
  asyncHandler(async (req, res) => {
    const botId = String(req.query.botId || "").trim();
    assertBotAccess(req, botId);
    if (!botId) throw new Error("botId is required");
    res.json({
      ok: true,
      targets: listProactiveAddressBookTargets({
        botId,
        targetType: req.query.targetType,
        query: String(req.query.q || "").trim(),
        limit: Number(req.query.limit || 200)
      })
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

app.listen(port, host, () => {
  logInfo("service.started", { host, port });
});
