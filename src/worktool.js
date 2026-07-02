const DEFAULT_BASE_URL = "https://api.worktool.ymdyes.cn";

function getBaseUrl() {
  return (process.env.WORKTOOL_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function getRobotId() {
  const robotId = process.env.ROBOT_ID;
  if (!robotId) {
    throw new Error("ROBOT_ID is required");
  }
  return robotId;
}

async function requestWorkTool(path, options = {}) {
  const url = new URL(`${getBaseUrl()}${path}`);
  url.searchParams.set("robotId", getRobotId());

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const detail = typeof data === "object" ? JSON.stringify(data) : String(data);
    throw new Error(`WorkTool request failed: ${response.status} ${detail}`);
  }

  return data;
}

export async function getRobotInfo() {
  return requestWorkTool("/robot/robotInfo/get");
}

export async function getCallbackConfig() {
  return requestWorkTool("/robot/robotInfo/callBack/get");
}

export async function bindMessageCallback(callbackUrl, replyAll = 1) {
  return requestWorkTool("/robot/robotInfo/update", {
    method: "POST",
    body: JSON.stringify({
      openCallback: 1,
      replyAll,
      callbackUrl
    })
  });
}

export async function bindCommandCallback(callBackUrl) {
  return requestWorkTool("/robot/robotInfo/callBack/bind", {
    method: "POST",
    body: JSON.stringify({
      type: 1,
      callBackUrl
    })
  });
}

export async function sendTextMessage({ targets, content, socketType = 2 }) {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("targets must be a non-empty array");
  }
  if (!content || typeof content !== "string") {
    throw new Error("content must be a non-empty string");
  }

  return requestWorkTool("/wework/sendRawMessage", {
    method: "POST",
    body: JSON.stringify({
      socketType,
      list: [
        {
          type: 203,
          titleList: targets,
          receivedContent: content
        }
      ]
    })
  });
}
