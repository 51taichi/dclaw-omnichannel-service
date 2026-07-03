export function buildDclawRequest({ binding, conversation, message }) {
  const worktoolMessage = {
    channel: "wecom-worktool",
    eventType: "inbound_message",
    botId: binding.botId,
    agentId: binding.agentId,
    conversationId: conversation.conversationKey,
    sessionId: conversation.dclawSessionId || conversation.conversationKey,
    messageId: message.messageId || "",
    message: message.spoken || "",
    rawMessage: message.rawSpoken || message.spoken || "",
    roomType: message.roomType,
    groupName: message.groupName || "",
    userId: message.receivedName || "",
    metadata: {
      receivedName: message.receivedName || "",
      atMe: message.atMe,
      textType: message.textType,
      fileName: message.fileName || "",
      filePath: message.filePath || "",
      payload: message
    }
  };

  return {
    external_user_id: worktoolMessage.userId || "unknown",
    external_session_id: worktoolMessage.conversationId,
    message: [
      "你收到的是 WorkTool 回调服务器转发的标准 JSON 包。",
      "请严格按 Agent 工作区规则处理，尤其是 conversationId 会话隔离、群聊 @ 规则和隐藏指令。",
      "请只输出要发回企微客户的最终文本；如果不需要回复，请输出空字符串。",
      "",
      JSON.stringify(worktoolMessage, null, 2)
    ].join("\n"),
    stream: true,
    metadata: {
      source: "worktool",
      botId: worktoolMessage.botId,
      agentId: worktoolMessage.agentId,
      conversationId: worktoolMessage.conversationId,
      messageId: worktoolMessage.messageId,
      roomType: worktoolMessage.roomType,
      groupName: worktoolMessage.groupName,
      userId: worktoolMessage.userId,
      worktool: worktoolMessage
    }
  };
}

export async function invokeDclawAgent({ binding, request }) {
  if (!binding.agentApiUrl) {
    throw new Error("DClaw agentApiUrl is required");
  }
  if (!binding.agentApiKey) {
    throw new Error("DClaw agentApiKey is required");
  }

  const response = await fetch(binding.agentApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${binding.agentApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(Number(process.env.DCLAW_AGENT_TIMEOUT_MS || 120000))
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DClaw OpenAPI failed: ${response.status} ${errorText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    const result = await readSseText(response);
    return {
      request,
      response: result.events,
      reply: extractReplyFromText(result.text),
      sessionId: result.sessionId
    };
  }

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { reply: text };
  }

  return {
    request,
    response: data,
    reply: extractReply(data),
    sessionId: data.sessionId || data.session_id || data.conversationId || data.data?.sessionId || null
  };
}

async function readSseText(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalText = "";
  let sessionId = null;
  const events = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";

    for (const chunk of chunks) {
      for (const event of parseSseChunk(chunk)) {
        events.push(event);
        if (event.session_id) {
          sessionId = event.session_id;
        }
        if (event.object === "content" && event.type === "text" && event.text) {
          finalText += event.text;
        }
        if (event.error) {
          throw new Error(
            typeof event.error === "string" ? event.error : JSON.stringify(event.error)
          );
        }
      }
    }
  }

  for (const event of parseSseChunk(buffer)) {
    events.push(event);
    if (event.session_id) sessionId = event.session_id;
    if (event.object === "content" && event.type === "text" && event.text) {
      finalText += event.text;
    }
  }

  return {
    text: finalText.trim(),
    sessionId,
    events
  };
}

function parseSseChunk(chunk) {
  return chunk
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
    .filter((line) => line !== "[DONE]")
    .map((line) => JSON.parse(line));
}

function extractReplyFromText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  try {
    const data = JSON.parse(trimmed);
    return extractReply(data) || trimmed;
  } catch {
    return trimmed;
  }
}

function extractReply(data) {
  if (typeof data === "string") return data;
  return (
    data.reply ||
    data.content ||
    data.message ||
    data.text ||
    data.data?.reply ||
    data.data?.content ||
    data.data?.message ||
    ""
  );
}
