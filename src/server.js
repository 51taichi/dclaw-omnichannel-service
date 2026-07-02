import "dotenv/config";
import express from "express";
import {
  bindCommandCallback,
  bindMessageCallback,
  getCallbackConfig,
  getRobotInfo,
  sendTextMessage
} from "./worktool.js";
import { appendJsonLine, readJsonLines } from "./storage.js";

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "2mb" }));

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

function buildPublicCallbackUrl(pathname) {
  const baseUrl = process.env.PUBLIC_BASE_URL;
  if (!baseUrl) {
    throw new Error("PUBLIC_BASE_URL is required for callback binding");
  }
  const url = new URL(pathname, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
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

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "worktool-bot-service",
    time: new Date().toISOString()
  });
});

app.post("/worktool/message-callback", (req, res) => {
  try {
    assertCallbackSecret(req);
  } catch (error) {
    res.status(error.status || 500).json({ code: -1, message: error.message });
    return;
  }

  res.json({ code: 0, message: "参数接收成功" });

  void appendJsonLine("incoming-messages.jsonl", {
    type: "message-callback",
    payload: req.body
  }).catch((error) => {
    console.error("failed to save incoming message:", error);
  });
});

app.post("/worktool/command-callback", (req, res) => {
  try {
    assertCallbackSecret(req);
  } catch (error) {
    res.status(error.status || 500).json({ code: -1, message: error.message });
    return;
  }

  res.json({ code: 0, message: "参数接收成功" });

  void appendJsonLine("command-callbacks.jsonl", {
    type: "command-callback",
    payload: req.body
  }).catch((error) => {
    console.error("failed to save command callback:", error);
  });
});

app.post(
  "/api/send",
  asyncHandler(async (req, res) => {
    const targets = Array.isArray(req.body.targets)
      ? req.body.targets
      : [req.body.target].filter(Boolean);
    const content = req.body.content;
    const socketType = req.body.socketType || 2;

    const result = await sendTextMessage({ targets, content, socketType });
    await appendJsonLine("outgoing-commands.jsonl", {
      type: "send-text",
      targets,
      content,
      socketType,
      worktoolResponse: result
    });

    res.json({
      ok: true,
      result
    });
  })
);

app.post(
  "/api/config/message-callback",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const callbackUrl =
      body.callbackUrl || buildPublicCallbackUrl("/worktool/message-callback");
    const replyAll = body.replyAll ?? 1;
    const result = await bindMessageCallback(callbackUrl, replyAll);
    res.json({ ok: true, callbackUrl, result });
  })
);

app.post(
  "/api/config/command-callback",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const callBackUrl =
      body.callBackUrl || buildPublicCallbackUrl("/worktool/command-callback");
    const result = await bindCommandCallback(callBackUrl);
    res.json({ ok: true, callBackUrl, result });
  })
);

app.get(
  "/api/robot",
  asyncHandler(async (req, res) => {
    const robotInfo = await getRobotInfo();
    res.json({ ok: true, robotInfo });
  })
);

app.get(
  "/api/callback-config",
  asyncHandler(async (req, res) => {
    const callbackConfig = await getCallbackConfig();
    res.json({ ok: true, callbackConfig });
  })
);

app.get(
  "/api/logs/:name",
  asyncHandler(async (req, res) => {
    const allowed = new Set([
      "incoming-messages",
      "command-callbacks",
      "outgoing-commands"
    ]);
    if (!allowed.has(req.params.name)) {
      res.status(404).json({ ok: false, message: "unknown log name" });
      return;
    }
    const limit = Number(req.query.limit || 50);
    const logs = await readJsonLines(`${req.params.name}.jsonl`, limit);
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

app.listen(port, () => {
  console.log(`WorkTool bot service listening on http://localhost:${port}`);
});
