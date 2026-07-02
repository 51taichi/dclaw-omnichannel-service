export function buildDclawRequest({ binding, conversation, message }) {
  return {
    channel: "wecom-worktool",
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
}

export async function invokeDclawAgent({ binding, request }) {

  const headers = {
    "Content-Type": "application/json"
  };
  if (binding.agentApiKey) {
    headers.Authorization = `Bearer ${binding.agentApiKey}`;
  }

  const response = await fetch(binding.agentApiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(Number(process.env.DCLAW_AGENT_TIMEOUT_MS || 25000))
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { reply: text };
  }

  if (!response.ok) {
    throw new Error(`DClaw agent failed: ${response.status} ${text}`);
  }

  return {
    request,
    response: data,
    reply: extractReply(data),
    sessionId: data.sessionId || data.conversationId || data.data?.sessionId || null
  };
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
