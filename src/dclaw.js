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
  const agentFlow = compactFlowForAgent(flow);

  const instructions = [
    "你收到的是 WorkTool 回调服务器转发的标准 JSON 包。",
    "WorkTool 房间类型约定：roomType=2/4 表示私聊，必须默认回复；roomType=1/3 表示群聊，只有被 @ 时才回复。",
    "请严格按 Agent 工作区规则处理，尤其是 conversationId 会话隔离、群聊 @ 规则和隐藏指令。",
    "群聊和私聊只在是否触发回复上不同；一旦触发回复，客户意图识别、资源索取、企业智库、客服经验库、附件输出、事实边界和 human_reply_style 润色必须完全一致。",
    "不要因为是群聊就跳过资源索取、附件发送、客服经验库或企业智库，也不要改用另一套回答逻辑。",
    "企业智库负责事实边界，客服经验库负责表达策略和资源线索；客户出现品牌信任异议、资源索取、价格/投入/合同/售后顾虑时，必须同时查询客服经验库。",
    "客户明确提到经验库、同事怎么答、历史沟通案例或优秀话术时，必须查询客服经验库；如果经验库命中或用于本轮回复，请在 sources 中写入 experience。",
    "资源索取优先级高于品牌实力解释；客户索要视频、图片、资料、文件、链接、工厂视频、产品视频、基地视频，或说有没有视频证明实力时，必须先查可发送资源并尽量输出 attachments。",
    "客户说没听过、不熟、靠谱吗、真的假的、小品牌，或索要视频、图片、资料、文件、链接、工厂视频、产品视频时，不能只用企业智库直接回答；如果经验库实际参与，请在 sources 中写入 experience。",
    "最终回复的人设、真人感、长度、表情和节奏由 Agent 的 human_reply_style 统一处理。",
    "如果需要发送图片、文件、视频或音频，请在最终 JSON 中增加 attachments 数组，格式为 {\"type\":\"image|file|video|audio|link\",\"url\":\"https://...\",\"name\":\"文件名\",\"title\":\"标题\"}。",
    "attachments 中 type=image/file/video/audio 会由服务器调用 WorkTool 媒体接口发送；其他类型或未知链接会作为普通 URL 文本发送。",
    "如果回复实际命中或参考了企业智库、客服经验库、任务节点、会话上下文、客户档案或大模型兜底，请在最终 JSON 中增加 sources 数组，格式为 {\"type\":\"enterprise_knowledge|experience|flow_node|conversation|profile|llm_fallback\",\"name\":\"来源名称\",\"reason\":\"为什么用于本次回复\"}；未命中的来源不要写入 sources。",
    "需要连续发送 2-3 条短回复时，请用空行分隔每段。"
  ];
  if (flow) {
    instructions.push(
      "当前私聊会话启用了客服流程状态机。你必须围绕 flow.currentNode 的 goal、completionCriteria、collectFields 和 conversationTips 推进对话。",
      "如果 conversationReset=true，表示控制台刚清空了当前会话记录；请忽略旧会话文件，重建或清空当前 conversationId 对应的短期会话记录。",
      "不要机械追问；先回应客户当前表达，再自然推进当前节点目标。",
      "最终请只输出一个 JSON 对象，不要输出 Markdown 或分析过程。",
      "JSON 格式：{\"reply\":\"发给客户的文本\",\"attachments\":[],\"sources\":[],\"flowDecision\":{\"currentNodeId\":\"当前节点ID\",\"nextNodeId\":\"建议下一节点ID或当前节点ID\",\"nodeCompleted\":false,\"confidence\":0.0,\"reason\":\"判断原因\",\"collectedDataPatch\":{}}}",
      "如果当前节点已经完成，可以设置 nodeCompleted=true，并给出合法 nextNodeId；服务器会最终决定是否迁移。"
    );
  } else {
    instructions.push(
      "最终请只输出一个 JSON 对象，不要输出 Markdown、分析过程、规则解释、处理步骤或任何对象外文字。",
      "JSON 格式：{\"reply\":\"发给客户的文本\",\"attachments\":[],\"sources\":[]}。没有附件或来源时使用空数组；不需要回复时使用 {\"reply\":\"\",\"attachments\":[],\"sources\":[]}。"
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
        flow: agentFlow,
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
      flow: agentFlow,
      conversationReset
    }
  };
}

export function buildDclawReplyFormatRetryRequest(request) {
  const hasFlow = Boolean(request?.metadata?.flow);
  const responseSchema = hasFlow
    ? "{\"reply\":\"发给客户的文本\",\"attachments\":[],\"sources\":[],\"flowDecision\":{\"currentNodeId\":\"当前节点ID\",\"nextNodeId\":\"建议下一节点ID或当前节点ID\",\"nodeCompleted\":false,\"confidence\":0.0,\"reason\":\"判断原因\",\"collectedDataPatch\":{}}}"
    : "{\"reply\":\"发给客户的文本\",\"attachments\":[],\"sources\":[]}";
  return {
    ...request,
    message: [
      request.message,
      "",
      "上一条输出不符合客户回复协议，不能发送给客户。请重新回答本条客户消息。",
      `只输出一个合法 JSON 对象：${responseSchema}。`,
      "禁止输出 Markdown、分析、推理、规则、处理步骤、前后说明或 JSON 对象外的任何文字。"
    ].join("\n"),
    metadata: {
      ...(request.metadata || {}),
      formatRetry: true
    }
  };
}

export function buildDclawHandoffTranscriptRequest({
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
    eventType: "handoff_transcript_message",
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
      handoffStatus: "human",
      payload: message
    }
  };

  return {
    external_user_id: worktoolMessage.userId || "unknown",
    external_session_id: worktoolMessage.conversationId,
    message: [
      "你收到的是 WorkTool 回调服务器转发的标准 JSON 包。",
      "eventType=handoff_transcript_message 表示这是人工接手期间的聊天记录。",
      "这条消息只用于补全当前 conversationId 的历史。",
      "不要生成客户可见回复。",
      "不要推进状态机。",
      "不要输出话术。",
      "最终请输出空字符串。",
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
      eventType: worktoolMessage.eventType,
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

export function buildDclawConversationResetRequest({
  binding,
  conversationKey,
  reason = "console_reset"
}) {
  const worktoolMessage = {
    channel: "wecom-worktool",
    eventType: "conversation_reset",
    botId: binding.botId,
    agentId: binding.agentId,
    conversationId: conversationKey,
    sessionId: conversationKey,
    messageId: "",
    message: "",
    rawMessage: "",
    roomType: null,
    groupName: "",
    userId: "",
    metadata: { reason }
  };

  return {
    external_user_id: "system",
    external_session_id: conversationKey,
    message: [
      "你收到的是 WorkTool 回调服务器的内部会话清理事件。",
      "eventType=conversation_reset，不是客户消息，绝不生成客服话术。",
      "只读取 conversationId；不得使用调用方提供的任何文件路径或文件名。",
      "从 conversationId 推导会话记录文件名，只允许删除 会话记录/conversations/ 目录下对应的短期记录文件。",
      "目标文件不存在也视为成功。",
      "绝不读取、删除或修改 客户档案/，也不要运行知识库、状态机、回复或归档技能。",
      "最终只能输出：{\"ok\":true,\"eventType\":\"conversation_reset\"}",
      "",
      JSON.stringify(worktoolMessage, null, 2)
    ].join("\n"),
    stream: true,
    metadata: {
      source: "worktool",
      eventType: "conversation_reset",
      botId: worktoolMessage.botId,
      agentId: worktoolMessage.agentId,
      conversationId: conversationKey,
      reason,
      worktool: worktoolMessage
    }
  };
}

export function parseConversationResetAcknowledgement(rawReply) {
  const text = String(rawReply || "").trim();
  if (!text) return { ok: false };
  try {
    const parsed = JSON.parse(text);
    return {
      ok: Boolean(
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        parsed.ok === true &&
        parsed.eventType === "conversation_reset"
      )
    };
  } catch {
    return { ok: false };
  }
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

export function buildDclawActivationRequest({
  binding,
  conversationKey,
  task,
  flow,
  recentMessages = []
}) {
  const userId = String(conversationKey || "").split(":private:")[1] || "";
  const worktoolMessage = {
    channel: "wecom-worktool",
    eventType: "flow_activation_due",
    botId: binding.botId,
    agentId: binding.agentId,
    conversationId: conversationKey,
    sessionId: conversationKey,
    messageId: `activation:${task.id}`,
    message: "",
    rawMessage: "",
    roomType: 2,
    groupName: "",
    userId,
    metadata: {
      activationTaskId: task.id,
      nodeId: task.nodeId,
      attemptNumber: task.attemptNumber,
      maxTimes: task.maxTimes,
      intervalMinutes: task.intervalMinutes,
      referenceMessages: task.messages
    }
  };
  const agentFlow = compactFlowForAgent(flow);
  const agentRecentMessages = compactRecentMessages(recentMessages);

  return {
    external_user_id: worktoolMessage.userId || "unknown",
    external_session_id: conversationKey,
    message: [
      "你收到的是 WorkTool 回调服务器生成的节点激活任务。",
      "eventType=flow_activation_due 表示客户在当前节点长时间未回复，需要发送一次自然的激活提醒。",
      "请结合当前会话上下文、当前节点目标和参考话术，组织成真人客服会发送的一条激活消息。",
      "最终只输出一个 JSON 对象：{\"reply\":\"发给客户的激活话术\",\"attachments\":[],\"sources\":[]}。",
      "禁止输出 Markdown、分析、推理、规则、处理步骤或 JSON 对象外文字。",
      "",
      JSON.stringify({ worktoolMessage, flow: agentFlow, recentMessages: agentRecentMessages }, null, 2)
    ].join("\n"),
    stream: true,
    metadata: {
      source: "worktool",
      eventType: "flow_activation_due",
      botId: binding.botId,
      agentId: binding.agentId,
      conversationId: conversationKey,
      worktool: worktoolMessage,
      flow: agentFlow
    }
  };
}

function compactFlowForAgent(flow) {
  if (!flow || typeof flow !== "object" || Array.isArray(flow)) return flow || null;
  return {
    ...flow,
    recentMessages: compactRecentMessages(flow.recentMessages)
  };
}

function compactRecentMessages(messages) {
  const items = Array.isArray(messages) ? messages : [];
  return items
    .filter((message) => message && typeof message === "object" && !Array.isArray(message))
    .map((message) => ({
      direction: String(message.direction || "").trim(),
      senderName: String(message.senderName || "").trim(),
      content: String(message.content || "").trim(),
      createdAt: String(message.createdAt || message.created_at || "").trim()
    }))
    .filter((message) => message.direction || message.senderName || message.content);
}

const defaultDclawTimeoutMs = 25000;
const defaultDclawMaxAttempts = 2;

export function getDclawAgentTimeoutMs() {
  const configured = Number(process.env.DCLAW_AGENT_TIMEOUT_MS || defaultDclawTimeoutMs);
  return Number.isFinite(configured) && configured > 0 ? configured : defaultDclawTimeoutMs;
}

export function getDclawAgentMaxAttempts() {
  const configured = Number(process.env.DCLAW_AGENT_MAX_ATTEMPTS || defaultDclawMaxAttempts);
  return Number.isFinite(configured) && configured > 0
    ? Math.max(1, Math.floor(configured))
    : defaultDclawMaxAttempts;
}

export async function invokeDclawAgentWithRetry({
  binding,
  request,
  maxAttempts = getDclawAgentMaxAttempts(),
  timeoutMs = getDclawAgentTimeoutMs(),
  onRetry = null
}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await invokeDclawAgent({ binding, request, timeoutMs });
      return {
        ...result,
        attempts: attempt
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableDclawError(error) || attempt >= maxAttempts) {
        throw error;
      }
      onRetry?.({ attempt, maxAttempts, timeoutMs, error });
    }
  }
  throw lastError;
}

export async function invokeDclawAgent({ binding, request, timeoutMs = getDclawAgentTimeoutMs() }) {
  if (!binding.agentApiUrl) {
    throw new Error("DClaw agentApiUrl is required");
  }
  if (!binding.agentApiKey) {
    throw new Error("DClaw agentApiKey is required");
  }

  const signal = AbortSignal.timeout(timeoutMs);
  const response = await fetch(binding.agentApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${binding.agentApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(request),
    signal
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`DClaw OpenAPI failed: ${response.status} ${errorText}`);
    error.status = response.status;
    throw error;
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    const result = await readSseText(response, signal);
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

function isTimeoutError(error) {
  const name = String(error?.name || "");
  const message = String(error?.message || "");
  return (
    name === "TimeoutError" ||
    name === "AbortError" ||
    message.includes("aborted due to timeout") ||
    message.includes("timeout")
  );
}

function isRetryableDclawError(error) {
  const status = Number(error?.status);
  return isTimeoutError(error) || status === 502 || status === 503 || status === 504;
}

export function parseAgentReply(rawReply) {
  const text = unwrapIsolatedJsonFence(rawReply);
  if (!text) return invalidAgentReply(rawReply);

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalidAgentReply(rawReply);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof parsed.reply !== "string") {
    return invalidAgentReply(rawReply);
  }

  return {
    valid: true,
    reply: stripRuntimeArtifacts(parsed.reply),
    attachments: normalizeAgentAttachments(parsed.attachments || parsed.resources || parsed.files),
    sources: normalizeAgentSources(parsed.sources || parsed.references || parsed.evidence),
    flowDecision: parsed.flowDecision || parsed.stateUpdate || null,
    raw: parsed
  };
}

function unwrapIsolatedJsonFence(value) {
  const text = String(value || "").trim();
  const match = text.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  return match ? match[1].trim() : text;
}

function invalidAgentReply(rawReply) {
  return {
    valid: false,
    reply: "",
    attachments: [],
    sources: [],
    flowDecision: null,
    raw: rawReply
  };
}

function stripRuntimeArtifacts(value) {
  let text = String(value || "").trim();
  if (!text) return "";

  const compactionPattern =
    /(?:🔄\s*)?Context compaction started\.\.\.\s*Context Status:\s*[^\n\r]*?\bkeep\(\d+\)/g;
  const completedPattern =
    /(?:✅\s*)?Context compaction completed!\s*Context Status:\s*[^\n\r]*?\b\d+\s+msgs/g;

  for (let index = 0; index < 4; index += 1) {
    const next = text
      .replace(compactionPattern, "")
      .replace(completedPattern, "")
      .trim();
    if (next === text) break;
    text = next;
  }

  return text;
}

function normalizeAgentSources(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => {
      const source = {
        type: String(item.type || item.sourceType || item.kind || "").trim().toLowerCase(),
        name: String(item.name || item.title || item.label || "").trim(),
        reason: String(item.reason || item.usage || item.description || "").trim()
      };
      const id = String(item.id || item.docId || item.nodeId || "").trim();
      if (id) source.id = id;
      return source;
    })
    .filter((item) => item.type && item.name);
}

function normalizeAgentAttachments(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const attachment = {
        type: String(item.type || item.fileType || item.kind || "link").trim().toLowerCase(),
        url: String(item.url || item.fileUrl || item.href || "").trim()
      };
      const name = String(item.name || item.objectName || item.filename || item.fileName || "").trim();
      const title = String(item.title || item.label || "").trim();
      if (name) attachment.name = name;
      if (title) attachment.title = title;
      return attachment;
    })
    .filter((item) => item.url);
}

async function readSseText(response, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalText = "";
  let sessionId = null;
  const events = [];
  const cancelReader = () => {
    reader.cancel(signal.reason).catch(() => {});
  };
  if (signal?.aborted) {
    throw signal.reason || new DOMException("The operation was aborted due to timeout", "TimeoutError");
  }
  signal?.addEventListener("abort", cancelReader, { once: true });

  try {
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
  } finally {
    signal?.removeEventListener("abort", cancelReader);
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
