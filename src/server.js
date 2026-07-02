import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBotBindingsFromConfig } from "./config.js";
import { buildDclawRequest, invokeDclawAgent } from "./dclaw.js";
import {
  finishAgentInvocation,
  getBotBinding,
  getConversationKey,
  insertAgentInvocationStart,
  insertCommandCallback,
  insertIncomingMessage,
  insertOutgoingMessage,
  listBotBindings,
  listRecords,
  updateConversationSession,
  upsertBotBinding,
  upsertConversation
} from "./db.js";
import {
  bindCommandCallback,
  bindMessageCallback,
  getCallbackConfig,
  getRobotInfo,
  sendTextMessage
} from "./worktool.js";

const app = express();
const port = Number(process.env.PORT || 8765);
const host = process.env.HOST || "0.0.0.0";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");

app.use(express.json({ limit: "2mb" }));
app.use("/console", express.static(path.join(publicDir, "console")));

await loadBotBindingsFromConfig();

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
  if (Number(message.roomType) === 1 && message.groupName) {
    return message.groupName;
  }
  return message.receivedName;
}

function shouldRunDebugPing() {
  return String(process.env.ENABLE_PING_AUTOREPLY || "").toLowerCase() === "true";
}

async function handleDebugPing({ botId, message, conversationKey }) {
  if (!shouldRunDebugPing()) return false;
  const spoken = String(message.spoken || "").trim().toLowerCase();
  if (spoken !== "ping") return false;

  const target = getReplyTarget(message);
  if (!target) return true;

  const result = await sendTextMessage({
    robotId: botId,
    targets: [target],
    content: "pong"
  });
  insertOutgoingMessage({
    botId,
    conversationKey,
    targetName: target,
    content: "pong",
    messageId: result.data,
    worktoolResponse: result
  });
  return true;
}

async function processIncomingMessage({ botId, message }) {
  const binding = getBotBinding(botId);
  const conversationKey = getConversationKey(botId, message);
  insertIncomingMessage({ botId, conversationKey, payload: message });

  if (await handleDebugPing({ botId, message, conversationKey })) {
    return;
  }

  if (!binding || !binding.enabled) {
    console.warn(`No enabled DClaw agent binding for botId=${botId}`);
    return;
  }

  const conversation = upsertConversation({
    botId,
    agentId: binding.agentId,
    conversationKey,
    message
  });

  const request = buildDclawRequest({ binding, conversation, message });
  const invocationId = insertAgentInvocationStart({
    botId,
    agentId: binding.agentId,
    conversationKey,
    incomingMessageId: message.messageId,
    request
  });

  try {
    const invocation = await invokeDclawAgent({
      binding,
      request
    });

    if (invocation.sessionId) {
      updateConversationSession(conversationKey, invocation.sessionId);
    }

    finishAgentInvocation({
      id: invocationId,
      response: invocation.response,
      status: "success"
    });

    const reply = String(invocation.reply || "").trim();
    if (!reply) {
      return;
    }

    const target = getReplyTarget(message);
    if (!target) {
      throw new Error("missing WorkTool reply target");
    }

    const result = await sendTextMessage({
      robotId: botId,
      targets: [target],
      content: reply
    });
    insertOutgoingMessage({
      botId,
      agentId: binding.agentId,
      conversationKey,
      messageId: result.data,
      targetName: target,
      content: reply,
      worktoolResponse: result
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
    console.error("failed to process incoming message:", error);
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
    console.error("failed to process incoming message:", error);
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
  res.json({ code: 0, message: "参数接收成功" });
});

app.post("/worktool/command-callback", (req, res) => {
  const botId = resolveLegacyBotId(req);
  if (!botId) {
    res.status(400).json({ code: -1, message: "missing botId" });
    return;
  }
  insertCommandCallback({ botId, payload: req.body || {} });
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
      agentApiUrl: body.agentApiUrl,
      agentApiKey: body.agentApiKey || "",
      enabled: body.enabled !== false
    });
    res.json({ ok: true, binding });
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
    const logs = listRecords(req.params.name, Number(req.query.limit || 50));
    if (!logs) {
      res.status(404).json({ ok: false, message: "unknown log name" });
      return;
    }
    res.json({ ok: true, logs });
  })
);

app.use((error, req, res, next) => {
  console.error(error);
  res.status(error.status || 500).json({
    ok: false,
    message: error.message || "internal server error"
  });
});

app.listen(port, host, () => {
  console.log(`WorkTool bot service listening on http://${host}:${port}`);
});
