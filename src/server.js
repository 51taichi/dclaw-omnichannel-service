import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBotBindingsFromConfig } from "./config.js";
import {
  buildDclawProactiveEventRequest,
  buildDclawRequest,
  getDclawAgentMaxAttempts,
  getDclawAgentTimeoutMs,
  invokeDclawAgentWithRetry,
  parseAgentReply
} from "./dclaw.js";
import { logError, logInfo, logWarn } from "./logger.js";
import {
  beginMessageProcessing,
  buildMessageKey,
  claimNextProactiveTarget,
  clearConversationForReset,
  createProactiveTask,
  finishAgentInvocation,
  finishMessageProcessing,
  getBotBinding,
  getConversationKey,
  getConversationResetPending,
  getConversationAssets,
  getFlowMachine,
  getOrCreateFlowSession,
  getSetting,
  getProactiveTask,
  insertAgentInvocationStart,
  insertConversationMessage,
  insertCommandCallback,
  insertIncomingMessage,
  insertOutgoingMessage,
  insertMockProactiveTargets,
  listConversationMessages,
  listFlowMachines,
  listFlowSessions,
  listFlowStateEvents,
  listProactiveAddressBookTargets,
  listProactiveTasks,
  listProactiveTaskTargets,
  listBotBindings,
  listRecords,
  markConversationResetHandled,
  markProactiveTargetFailed,
  markProactiveTargetAgentSync,
  markProactiveTargetSent,
  mergeFlowSessionData,
  resetInterruptedProactiveTargets,
  setSetting,
  touchFlowSession,
  updateFlowSessionNode,
  updateProactiveTargetFromCommandCallback,
  updateOutgoingMessageFromCommandCallback,
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
  sendTextMessage
} from "./worktool.js";
import { shouldProcessInboundForAgent } from "./message-rules.js";

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
const uploadRetentionMs = Number(process.env.UPLOAD_RETENTION_HOURS || 24) * 60 * 60 * 1000;
const uploadCleanupIntervalMs =
  Number(process.env.UPLOAD_CLEANUP_INTERVAL_MINUTES || 60) * 60 * 1000;
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
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
  const entries = await fs.promises.readdir(uploadDir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile()) return;
      const filePath = path.join(uploadDir, entry.name);
      const stat = await fs.promises.stat(filePath);
      if (stat.mtimeMs >= cutoff) return;
      await fs.promises.unlink(filePath);
      removed += 1;
    })
  );
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
    return;
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
    return;
  }
  const actual = req.header("x-api-key") || req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (actual !== expected) {
    const error = new Error("invalid admin api key");
    error.status = 401;
    throw error;
  }
}

function applyUploadCors(req, res, next) {
  const origin = req.header("origin");
  const allowAnyOrigin = uploadAllowedOrigins.includes("*");
  const isAllowedOrigin = origin && (allowAnyOrigin || uploadAllowedOrigins.includes(origin));

  if (isAllowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowAnyOrigin ? "*" : origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "x-api-key, authorization, content-type");
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

function buildPublicFileUrl(filename) {
  const baseUrl = process.env.PUBLIC_BASE_URL;
  if (!baseUrl) {
    throw new Error("PUBLIC_BASE_URL is required for uploaded file URLs");
  }
  const url = new URL(
    `/uploads/${encodeURIComponent(filename)}`,
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

function getFlowNode(machine, nodeId) {
  const nodes = machine?.config?.nodes || machine?.nodes || [];
  return nodes.find((node) => node.id === nodeId) || null;
}

function buildFlowContext({ botId, conversationKey, message }) {
  if (!isPrivateMessage(message)) return null;
  const machine = getFlowMachine(botId);
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

function isValidFlowNode(machine, nodeId) {
  const nodes = machine?.config?.nodes || machine?.nodes || [];
  return Boolean(nodes.some((node) => node.id === nodeId));
}

function applyFlowDecision({ botId, conversationKey, flow, decision }) {
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

let proactiveWorkerBusy = false;
let agentQueue = Promise.resolve();

function enqueueAgentInvocation(task) {
  const run = agentQueue.then(task, task);
  agentQueue = run.catch(() => {});
  return run;
}

function getDebugReplyConfig() {
  const config = getSetting("debug_reply", defaultDebugReplyConfig);
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
  const config = getDebugReplyConfig();
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

function normalizeProactiveMessage(body) {
  const messageType = normalizeMessageType(body.messageType);
  if (messageType === "media") {
    const payload = {
      fileUrl: String(body.fileUrl || "").trim(),
      objectName: String(body.objectName || "").trim(),
      fileType: String(body.fileType || "image").trim(),
      extraText: String(body.extraText || "").trim(),
      sendType: Number(body.sendType || 0)
    };
    if (!payload.fileUrl) throw new Error("fileUrl is required");
    buildRawMediaCommand({ targets: ["validate"], ...payload });
    return {
      messageType,
      content: payload.extraText || `${fileTypeLabel(payload.fileType)}：${payload.objectName || payload.fileUrl}`,
      messagePayload: payload
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
  const label = fileTypeLabel(payload.fileType || "media");
  const parts = [`[${label}] ${payload.objectName || payload.fileUrl || ""}`.trim()];
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

async function processNextProactiveTarget() {
  if (!proactiveWorkerConfig.enabled || proactiveWorkerBusy) return;
  proactiveWorkerBusy = true;
  try {
    const target = claimNextProactiveTarget();
    if (!target) return;

    try {
      const result = target.messageType === "text"
        ? await sendTextMessage({
          robotId: target.botId,
          targets: [target.targetName],
          content: target.content
        })
        : await sendRawCommand({
          robotId: target.botId,
          command: buildCommandForTarget(target)
        });
      markProactiveTargetSent({
        id: target.id,
        messageId: result.data,
        worktoolResponse: result
      });
      const conversationKey = getProactiveConversationKey(target);
      const binding = getBotBinding(target.botId);
      if (binding) {
        const flowMachine = getFlowMachine(target.botId);
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
          messageId: result.data,
          messageType: target.messageType,
          messagePayload: target.messagePayload || {},
          worktoolResponse: result
        }
      });
      insertOutgoingMessage({
        botId: target.botId,
        agentId: target.agentId || "",
        conversationKey,
        messageId: result.data,
        targetName: target.targetName,
        content: target.content,
        worktoolResponse: result
      });
      void syncProactiveTargetToAgent({
        target,
        messageId: result.data,
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

  if (!shouldProcessInboundForAgent(message)) {
    logInfo("incoming.skipped", {
      ...logContext,
      reason: "non_text_or_empty_message"
    });
    finishMessageProcessing({ messageKey, status: "skipped" });
    return;
  }

  if (!shouldInvokeAgent(message, binding)) {
    logInfo("incoming.skipped", {
      ...logContext,
      reason: "group_message_without_mention"
    });
    finishMessageProcessing({ messageKey, status: "skipped" });
    return;
  }

  if (await handleDebugPing({ botId, message, conversationKey })) {
    logInfo("incoming.debug_reply", logContext);
    finishMessageProcessing({ messageKey, status: "debug_replied" });
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
  if (isPrivateMessage(message)) {
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
  const request = buildDclawRequest({
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
  const agentStartedAt = Date.now();
  logInfo("agent.invoke.start", {
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
          logWarn("agent.invoke.retry", {
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

    const agentReply = parseAgentReply(invocation.reply);
    const reply = String(agentReply.reply || "").trim();
    logInfo("agent.invoke.success", {
      ...logContext,
      agentId: binding.agentId,
      invocationId,
      durationMs: Date.now() - agentStartedAt,
      replyLength: reply.length,
      attempts: invocation.attempts || 1,
      timeoutMs: getDclawAgentTimeoutMs(),
      maxAttempts: getDclawAgentMaxAttempts(),
      sessionId: invocation.sessionId || ""
    });
    if (!reply) {
      logWarn("agent.reply.empty", {
        ...logContext,
        agentId: binding.agentId,
        invocationId
      });
      finishMessageProcessing({ messageKey, status: "empty_reply" });
      return;
    }
    if (looksLikeInternalNonReplyAnalysis(reply)) {
      logWarn("agent.reply.suppressed", {
        ...logContext,
        agentId: binding.agentId,
        invocationId,
        reason: "internal_non_reply_analysis"
      });
      finishMessageProcessing({ messageKey, status: "suppressed" });
      return;
    }

    const target = getReplyTarget(message);
    if (!target) {
      throw new Error("missing WorkTool reply target");
    }

    const sentParts = await sendTextReplyParts({
      robotId: botId,
      target,
      reply,
      allowSplit: isPrivateMessage(message) || replySplitConfig.splitGroup
    });
    const primaryResult = sentParts[0]?.result || {};
    const worktoolMessageIds = sentParts.map((part) => part.result?.data || "").filter(Boolean);
    if (flow) {
      applyFlowDecision({
        botId,
        conversationKey,
        flow,
        decision: agentReply.flowDecision
      });
      insertConversationMessage({
        botId,
        conversationKey,
        direction: "outbound",
        senderName: binding.botName || binding.agentName || "机器人",
        content: reply,
        rawPayload: {
          worktoolMessageId: worktoolMessageIds[0] || "",
          worktoolMessageIds,
          replyParts: sentParts.map((part) => part.content),
          flowDecision: agentReply.flowDecision,
          agentReply: agentReply.raw
        }
      });
    } else if (isPrivateMessage(message)) {
      insertConversationMessage({
        botId,
        conversationKey,
        direction: "outbound",
        senderName: binding.botName || binding.agentName || "机器人",
        content: reply,
        rawPayload: {
          worktoolMessageId: worktoolMessageIds[0] || "",
          worktoolMessageIds,
          replyParts: sentParts.map((part) => part.content)
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
          originalReply: reply
        }
      });
    }
    finishMessageProcessing({ messageKey, status: "replied" });
  } catch (error) {
    finishAgentInvocation({
      id: invocationId,
      response: null,
      status: "failed",
      error: error.message
    });
    finishMessageProcessing({ messageKey, status: "failed", error: error.message });
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
      assertAdmin(req);
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
          originalName: req.file.originalname,
          filename: req.file.filename,
          size: req.file.size,
          mimeType: req.file.mimetype,
          url: buildPublicFileUrl(req.file.filename)
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
    messageId: req.body?.messageId,
    payload: req.body || {}
  });
  logInfo("worktool.command_callback.received", commandCallbackLogFields({
    botId: req.params.botId,
    payload: req.body || {},
    outgoingMatched
  }));
  updateProactiveTargetFromCommandCallback({
    messageId: req.body?.messageId,
    payload: req.body || {}
  });
  res.json({ code: 0, message: "参数接收成功" });
});

app.post("/worktool/command-callback", (req, res) => {
  const botId = resolveLegacyBotId(req);
  if (!botId) {
    res.status(400).json({ code: -1, message: "missing botId" });
    return;
  }
  insertCommandCallback({ botId, payload: req.body || {} });
  const outgoingMatched = updateOutgoingMessageFromCommandCallback({
    messageId: req.body?.messageId,
    payload: req.body || {}
  });
  logInfo("worktool.command_callback.received", commandCallbackLogFields({
    botId,
    payload: req.body || {},
    outgoingMatched
  }));
  updateProactiveTargetFromCommandCallback({
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
  "/api/bots",
  asyncHandler(async (req, res) => {
    assertAdmin(req);
    res.json({ ok: true, bots: listBotBindings() });
  })
);

app.put(
  "/api/bots/:botId",
  asyncHandler(async (req, res) => {
    assertAdmin(req);
    const body = req.body || {};
    const binding = upsertBotBinding({
      botId: req.params.botId,
      botName: body.botName || body.name || "",
      agentId: body.agentId,
      agentName: body.agentName || "",
      dclawBaseUrl: body.dclawBaseUrl || "",
      dclawPublicId: body.dclawPublicId || body.agentId,
      agentApiKey: body.agentApiKey || "",
      enabled: body.enabled !== false
    });
    res.json({ ok: true, binding });
  })
);

app.get(
  "/api/settings/debug-reply",
  asyncHandler(async (req, res) => {
    assertAdmin(req);
    res.json({ ok: true, config: getDebugReplyConfig() });
  })
);

app.put(
  "/api/settings/debug-reply",
  asyncHandler(async (req, res) => {
    assertAdmin(req);
    const body = req.body || {};
    const config = setSetting("debug_reply", {
      enabled: Boolean(body.enabled),
      trigger: String(body.trigger || "ping").trim(),
      reply: String(body.reply || "pong")
    });
    res.json({ ok: true, config });
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
    assertAdmin(req);
    res.json({
      ok: true,
      machines: listFlowMachines({ botId: String(req.query.botId || "").trim() })
    });
  })
);

app.get(
  "/api/flow-machines/:botId",
  asyncHandler(async (req, res) => {
    assertAdmin(req);
    let machine = getFlowMachine(req.params.botId);
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
    assertAdmin(req);
    const body = req.body || {};
    const config = typeof body.config === "string" ? JSON.parse(body.config) : body.config;
    const machine = upsertFlowMachine({
      botId: req.params.botId,
      config,
      enabled: body.enabled !== false
    });
    res.json({ ok: true, machine });
  })
);

app.get(
  "/api/flow-sessions",
  asyncHandler(async (req, res) => {
    assertAdmin(req);
    res.json({
      ok: true,
      sessions: listFlowSessions({
        botId: String(req.query.botId || "").trim(),
        limit: Number(req.query.limit || 100)
      })
    });
  })
);

app.get(
  "/api/flow-sessions/:conversationKey",
  asyncHandler(async (req, res) => {
    assertAdmin(req);
    const conversationKey = decodeURIComponent(req.params.conversationKey);
    res.json({
      ok: true,
      messages: listConversationMessages({ conversationKey, limit: Number(req.query.limit || 300) }),
      events: listFlowStateEvents({ conversationKey, limit: 100 }),
      assets: getConversationAssets({
        botId: String(req.query.botId || "").trim(),
        conversationKey
      })
    });
  })
);

app.put(
  "/api/flow-sessions/:conversationKey/node",
  asyncHandler(async (req, res) => {
    assertAdmin(req);
    const body = req.body || {};
    const conversationKey = decodeURIComponent(req.params.conversationKey);
    const botId = String(body.botId || "").trim();
    const nextNodeId = String(body.nextNodeId || "").trim();
    if (!botId || !nextNodeId) throw new Error("botId and nextNodeId are required");
    const machine = getFlowMachine(botId);
    if (!machine || !machine.config.nodes.some((node) => node.id === nextNodeId)) {
      throw new Error("nextNodeId is not valid for this bot");
    }
    const session = updateFlowSessionNode({
      botId,
      conversationKey,
      nextNodeId,
      reason: body.reason || "控制台手动修改",
      decision: { source: "console", reason: body.reason || "" }
    });
    res.json({ ok: true, session });
  })
);

app.post(
  "/api/flow-sessions/:conversationKey/reset",
  asyncHandler(async (req, res) => {
    assertAdmin(req);
    const body = req.body || {};
    const conversationKey = decodeURIComponent(req.params.conversationKey);
    const botId = String(body.botId || "").trim();
    if (!botId) throw new Error("botId is required");
    const session = clearConversationForReset({
      botId,
      conversationKey,
      reason: body.reason || "控制台清空会话"
    });
    logInfo("flow_session.reset", { botId, conversationKey });
    res.json({ ok: true, session });
  })
);

app.post(
  "/api/proactive/tasks",
  asyncHandler(async (req, res) => {
    assertAdmin(req);
    const body = req.body || {};
    const botId = String(body.botId || process.env.ROBOT_ID || "").trim();
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
    assertAdmin(req);
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
    assertAdmin(req);
    const task = getProactiveTask(req.params.taskId);
    if (!task) {
      res.status(404).json({ ok: false, message: "task not found" });
      return;
    }
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
    assertAdmin(req);
    const botId = String(req.query.botId || process.env.ROBOT_ID || "").trim();
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
    assertAdmin(req);
    const body = req.body || {};
    const botId = String(body.botId || process.env.ROBOT_ID || "").trim();
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
    assertAdmin(req);
    const botId = String(req.body?.botId || process.env.ROBOT_ID || "").trim();
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
    assertAdmin(req);
    const body = req.body || {};
    const callbackUrl =
      body.callbackUrl || buildPublicCallbackUrl(req.params.botId, "/message-callback");
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
    assertAdmin(req);
    const body = req.body || {};
    const callBackUrl =
      body.callBackUrl || buildPublicCallbackUrl(req.params.botId, "/command-callback");
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
    const robotInfo = await getRobotInfo(botId);
    res.json({ ok: true, robotInfo });
  })
);

app.get(
  "/api/robot/:botId",
  asyncHandler(async (req, res) => {
    const robotInfo = await getRobotInfo(req.params.botId);
    res.json({ ok: true, robotInfo });
  })
);

app.get(
  "/api/callback-config",
  asyncHandler(async (req, res) => {
    const botId = req.query.botId || process.env.ROBOT_ID;
    const callbackConfig = await getCallbackConfig(botId);
    res.json({ ok: true, callbackConfig });
  })
);

app.get(
  "/api/callback-config/:botId",
  asyncHandler(async (req, res) => {
    const callbackConfig = await getCallbackConfig(req.params.botId);
    res.json({ ok: true, callbackConfig });
  })
);

app.get(
  "/api/logs/:name",
  asyncHandler(async (req, res) => {
    assertAdmin(req);
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
