export function buildDclawRequest({
  binding,
  conversation,
  message,
  flow = null,
  conversationReset = false
}) {
  const roomType = Number(message.roomType);
  const isGroup = roomType === 1 || roomType === 3;
  const worktoolMessage = {
    channel: "wecom-worktool",
    eventType: "inbound_message",
    botId: binding.botId,
    agentId: binding.agentId,
    conversationId: conversation.conversationKey,
    sessionId: conversation.conversationKey,
    messageId: message.messageId || "",
    message: message.spoken || "",
    rawMessage: message.rawSpoken || message.spoken || "",
    roomType: message.roomType,
    groupName: isGroup ? message.groupName || "" : "",
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

  const instructions = [
    "你收到的是 WorkTool 回调服务器转发的标准 JSON 包。",
    "WorkTool 房间类型约定：roomType=2/4 表示私聊，必须默认回复；roomType=1/3 表示群聊，只有被 @ 时才回复。",
    "请严格按 Agent 工作区规则处理，尤其是 conversationId 会话隔离、群聊 @ 规则和隐藏指令。",
    "群聊被 @ 后，业务问题必须和私聊一样优先调用 DClaw 企业智库；不要因为是群聊就跳过知识库检索。",
    "最终回复的真人感、长度、表情和节奏由 Agent 的 human_reply_style 统一处理。",
    "需要连续发送 2-3 条短回复时，请用空行分隔每段。"
  ];
  if (flow) {
    instructions.push(
      "当前私聊会话启用了客服流程状态机。你必须围绕 flow.currentNode 的 goal、completionCriteria、collectFields 和 conversationTips 推进对话。",
      "如果 conversationReset=true，表示控制台刚清空了当前会话记录；请忽略旧会话文件，重建或清空当前 conversationId 对应的短期会话记录。",
      "不要机械追问；先回应客户当前表达，再自然推进当前节点目标。",
      "最终请只输出一个 JSON 对象，不要输出 Markdown 或分析过程。",
      "JSON 格式：{\"reply\":\"发给客户的文本\",\"flowDecision\":{\"currentNodeId\":\"当前节点ID\",\"nextNodeId\":\"建议下一节点ID或当前节点ID\",\"nodeCompleted\":false,\"confidence\":0.0,\"reason\":\"判断原因\",\"collectedDataPatch\":{}}}",
      "如果当前节点已经完成，可以设置 nodeCompleted=true，并给出合法 nextNodeId；服务器会最终决定是否迁移。"
    );
  } else {
    instructions.push(
      "请只输出要发回企微客户的最终文本；不要输出分析过程、规则解释、JSON 或 Markdown；如果不需要回复，请输出空字符串。"
    );
  }

  return {
    external_user_id: worktoolMessage.userId || "unknown",
    external_session_id: worktoolMessage.conversationId,
    message: [
      ...instructions,
      "",
      JSON.stringify({
        worktoolMessage,
        flow,
        conversationReset
      }, null, 2)
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
      worktool: worktoolMessage,
      flow,
      conversationReset
    }
  };
}

export function buildDclawProactiveEventRequest({
  binding,
  conversationKey,
  target,
  worktoolMessageId,
  worktoolResponse
}) {
  const isGroup = target.targetType === "group";
  const worktoolMessage = {
    channel: "wecom-worktool",
    eventType: "outbound_proactive_message",
    botId: binding.botId,
    agentId: binding.agentId,
    conversationId: conversationKey,
    sessionId: conversationKey,
    messageId: worktoolMessageId || "",
    message: target.content || "",
    rawMessage: target.content || "",
    roomType: isGroup ? 1 : 2,
    groupName: isGroup ? target.targetName : "",
    userId: isGroup ? "" : target.targetName,
    metadata: {
      targetType: target.targetType,
      targetName: target.targetName,
      messageType: target.messageType || "text",
      messagePayload: target.messagePayload || {},
      worktoolResponse: worktoolResponse || null,
      payload: target
    }
  };

  return {
    external_user_id: worktoolMessage.userId || worktoolMessage.groupName || "unknown",
    external_session_id: worktoolMessage.conversationId,
    message: [
      "你收到的是 WorkTool 回调服务器转发的标准 JSON 包。",
      "eventType=outbound_proactive_message 表示机器人已经主动向客户或群发送了一条消息。",
      "这条事件只用于补全当前 conversationId 的会话历史，请记录该主动发送事实。",
      "不要把它当成客户提问，不要生成客户可见回复；最终请输出空字符串。",
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
      eventType: worktoolMessage.eventType,
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
    const reply = result.text.trim() || extractReply(result.events);
    return {
      request,
      response: result.events,
      reply,
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
    reply:
      data && typeof data === "object" && !Array.isArray(data) &&
      (data.flowDecision || data.stateUpdate || data.reply || data.message || data.content)
        ? JSON.stringify(data)
        : extractReply(data),
    sessionId: data.sessionId || data.session_id || data.conversationId || data.data?.sessionId || null
  };
}

export function parseAgentReply(rawReply) {
  const text = String(rawReply || "").trim();
  if (!text) return { reply: "", flowDecision: null, raw: rawReply };

  const parsed = parseJsonObjectFromText(text);
  if (!parsed) return { reply: text, flowDecision: null, raw: rawReply };

  const reply =
    typeof parsed.reply === "string"
      ? parsed.reply
      : typeof parsed.message === "string"
        ? parsed.message
        : typeof parsed.content === "string"
          ? parsed.content
          : "";
  return {
    reply: reply.trim(),
    flowDecision: parsed.flowDecision || parsed.stateUpdate || null,
    raw: parsed
  };
}

function parseJsonObjectFromText(text) {
  try {
    const data = JSON.parse(text);
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch {}

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try {
      const data = JSON.parse(fenced[1]);
      return data && typeof data === "object" && !Array.isArray(data) ? data : null;
    } catch {}
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const data = JSON.parse(text.slice(start, end + 1));
      return data && typeof data === "object" && !Array.isArray(data) ? data : null;
    } catch {}
  }
  return null;
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
  if (Array.isArray(data)) {
    return data.map(extractReply).find(Boolean) || "";
  }
  if (!data || typeof data !== "object") return "";

  const direct =
    data.reply ||
    data.content ||
    data.message ||
    data.text ||
    data.output_text ||
    data.delta ||
    data.data?.reply ||
    data.data?.content ||
    data.data?.message ||
    "";
  if (typeof direct === "string" && direct.trim()) {
    return direct;
  }

  const outputReply = extractReply(data.output);
  if (outputReply) return outputReply;

  const choicesReply = extractReply(data.choices);
  if (choicesReply) return choicesReply;

  const dataReply = extractReply(data.data);
  if (dataReply) return dataReply;

  return (
    extractReplyFromContentArray(data.content) ||
    extractReplyFromMessage(data.message) ||
    ""
  );
}

function extractReplyFromContentArray(content) {
  if (!Array.isArray(content)) return "";
  return (
    content
      .map((item) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return "";
        return item.text || item.content || item.output_text || "";
      })
      .find((text) => String(text || "").trim()) || ""
  );
}

function extractReplyFromMessage(message) {
  if (!message || typeof message !== "object") return "";
  return (
    extractReplyFromContentArray(message.content) ||
    message.content ||
    message.text ||
    ""
  );
}
