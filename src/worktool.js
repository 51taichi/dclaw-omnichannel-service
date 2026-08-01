import { normalizeUploadedFilename } from "./filenames.js";

const DEFAULT_BASE_URL = "https://api.worktool.ymdyes.cn";

function getBaseUrl() {
  return (process.env.WORKTOOL_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function getRobotId(robotId) {
  robotId = robotId || process.env.ROBOT_ID;
  if (!robotId) {
    throw new Error("ROBOT_ID is required");
  }
  return robotId;
}

export async function requestWorkTool(path, { robotId, timeoutMs = 0, ...options } = {}) {
  const url = new URL(`${getBaseUrl()}${path}`);
  url.searchParams.set("robotId", getRobotId(robotId));

  const response = await fetch(url, {
    ...options,
    signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : options.signal,
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

export async function getRobotInfo(robotId) {
  return requestWorkTool("/robot/robotInfo/get", { robotId });
}

export async function getCallbackConfig(robotId) {
  return requestWorkTool("/robot/robotInfo/callBack/get", { robotId });
}

export async function bindMessageCallback({ robotId, callbackUrl, replyAll = 1 }) {
  return requestWorkTool("/robot/robotInfo/update", {
    robotId,
    method: "POST",
    body: JSON.stringify({
      openCallback: 1,
      replyAll,
      callbackUrl
    })
  });
}

export async function unbindMessageCallback({ robotId }) {
  return requestWorkTool("/robot/robotInfo/update", {
    robotId,
    method: "POST",
    body: JSON.stringify({
      openCallback: 0,
      replyAll: 0,
      callbackUrl: ""
    })
  });
}

export async function bindCommandCallback({ robotId, callBackUrl }) {
  return requestWorkTool("/robot/robotInfo/callBack/bind", {
    robotId,
    method: "POST",
    body: JSON.stringify({
      type: 1,
      callBackUrl
    })
  });
}

export async function unbindCommandCallback({ robotId }) {
  return requestWorkTool("/robot/robotInfo/callBack/bind", {
    robotId,
    method: "POST",
    body: JSON.stringify({
      type: 0,
      callBackUrl: ""
    })
  });
}

export async function sendTextMessage({ robotId, targets, content, socketType = 2 }) {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("targets must be a non-empty array");
  }
  if (!content || typeof content !== "string") {
    throw new Error("content must be a non-empty string");
  }

  return requestWorkTool("/wework/sendRawMessage", {
    robotId,
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

export function buildRawMediaCommand({
  targets,
  fileUrl,
  objectName,
  fileType,
  extraText = "",
  sendType = 0
}) {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("targets must be a non-empty array");
  }
  if (!fileUrl || typeof fileUrl !== "string") {
    throw new Error("fileUrl must be a non-empty string");
  }
  const fileTypeMap = {
    0: "image",
    1: "file",
    2: "video",
    3: "audio",
    image: "image",
    file: "file",
    video: "video",
    audio: "audio"
  };
  const normalizedFileType = fileTypeMap[String(fileType)];
  if (!normalizedFileType) {
    throw new Error("fileType must be image, file, video, or audio");
  }

  return {
    type: 218,
    titleList: targets,
    fileUrl,
    objectName: normalizeUploadedFilename(objectName),
    fileType: normalizedFileType,
    extraText: extraText || "",
    sendType: Number(sendType || 0)
  };
}

export function buildGroupInviteCommand({
  groupName,
  targets,
  showMessageHistory = false
}) {
  const normalizedGroupName = String(groupName || "").trim();
  if (!normalizedGroupName) {
    throw new Error("groupName must be a non-empty string");
  }
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("targets must be a non-empty array");
  }

  const selectList = targets.map((target) => String(target || "").trim()).filter(Boolean);
  if (selectList.length === 0) {
    throw new Error("targets must be a non-empty array");
  }

  return {
    type: 207,
    groupName: normalizedGroupName,
    selectList,
    removeList: [],
    showMessageHistory: false
  };
}

export async function sendGroupInviteCommand({
  robotId,
  groupName,
  targets,
  showMessageHistory = false,
  socketType = 2
}) {
  const command = buildGroupInviteCommand({ groupName, targets, showMessageHistory });
  return requestWorkTool("/wework/sendRawMessage", {
    robotId,
    method: "POST",
    body: JSON.stringify({
      socketType,
      list: [command]
    })
  });
}

function normalizedUniqueNames(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
}

export function buildFriendTagCommand({ targetName, tagNames = [] }) {
  const name = String(targetName || "").trim();
  const tags = normalizedUniqueNames(tagNames);
  if (!name) throw new Error("targetName is required");
  if (!tags.length) throw new Error("tagNames must not be empty");
  if (tags.length > 5) throw new Error("at most five tags are allowed");
  return {
    type: 213,
    friend: {
      name,
      tagList: tags
    }
  };
}

export async function syncFriendTags({
  robotId,
  targetName,
  tagNames,
  socketType = 2
}) {
  return requestWorkTool("/wework/sendRawMessage", {
    robotId,
    method: "POST",
    body: JSON.stringify({
      socketType,
      list: [buildFriendTagCommand({ targetName, tagNames })]
    })
  });
}

export function buildCreateExternalGroupCommand({
  groupName,
  selectList = [],
  groupAnnouncement = "",
  groupRemark
}) {
  const normalizedGroupName = String(groupName || "").trim();
  if (!normalizedGroupName) throw new Error("groupName must be a non-empty string");
  const command = {
    type: 206,
    groupName: normalizedGroupName,
    selectList: normalizedUniqueNames(selectList),
    groupAnnouncement: String(groupAnnouncement || "")
  };
  if (groupRemark !== undefined) {
    command.groupRemark = String(groupRemark || "").trim();
  }
  return command;
}

export async function createExternalGroup({
  robotId,
  socketType = 2,
  ...input
}) {
  return requestWorkTool("/wework/sendRawMessage", {
    robotId,
    method: "POST",
    body: JSON.stringify({
      socketType,
      list: [buildCreateExternalGroupCommand(input)]
    })
  });
}

export function buildModifyGroupCommand({
  groupName,
  newGroupName,
  newGroupAnnouncement,
  newGroupRemark
}) {
  const normalizedGroupName = String(groupName || "").trim();
  if (!normalizedGroupName) throw new Error("groupName must be a non-empty string");
  const command = {
    type: 207,
    groupName: normalizedGroupName
  };
  if (newGroupName !== undefined) command.newGroupName = String(newGroupName || "").trim();
  if (newGroupAnnouncement !== undefined) {
    command.newGroupAnnouncement = String(newGroupAnnouncement || "");
  }
  if (newGroupRemark !== undefined) command.newGroupRemark = String(newGroupRemark || "").trim();
  if (Object.keys(command).length === 2) {
    throw new Error("at least one changed field is required");
  }
  return {
    ...command,
    selectList: [],
    removeList: [],
    showMessageHistory: false
  };
}

export async function modifyGroup({ robotId, socketType = 2, ...input }) {
  return requestWorkTool("/wework/sendRawMessage", {
    robotId,
    method: "POST",
    body: JSON.stringify({
      socketType,
      list: [buildModifyGroupCommand(input)]
    })
  });
}

export function buildMemberRemarkCommands({ groupName, changes = [] }) {
  const normalizedGroupName = String(groupName || "").trim();
  if (!normalizedGroupName) throw new Error("groupName must be a non-empty string");
  return (Array.isArray(changes) ? changes : []).map((change) => {
    const name = String(change?.currentName || "").trim();
    const markName = String(change?.markName || "").trim();
    if (!name || !markName) throw new Error("member currentName and markName are required");
    return {
      type: 225,
      groupName: normalizedGroupName,
      friend: { name, markName }
    };
  });
}

export async function modifyGroupMemberRemarks({
  robotId,
  groupName,
  changes,
  socketType = 2
}) {
  const commands = buildMemberRemarkCommands({ groupName, changes });
  if (!commands.length) throw new Error("at least one member remark change is required");
  return requestWorkTool("/wework/sendRawMessage", {
    robotId,
    method: "POST",
    body: JSON.stringify({ socketType, list: commands })
  });
}

export async function listWorkToolGroups({
  robotId,
  groupName = "",
  page = 1,
  size = 100
}) {
  const query = new URLSearchParams({
    groupName: String(groupName || ""),
    page: String(Math.max(1, Number(page) || 1)),
    size: String(Math.max(1, Math.min(100, Number(size) || 100)))
  });
  const response = await requestWorkTool(`/robot/wework/group/list?${query}`, { robotId });
  const data = response?.data || {};
  return {
    items: Array.isArray(data.list) ? data.list : [],
    pagination: {
      page: Number(data.pageNum || page),
      pageSize: Number(data.pageSize || size),
      total: Number(data.total || 0),
      totalPages: Number(data.totalPage || 0)
    },
    response
  };
}

export async function sendRawCommand({ robotId, command, socketType = 2 }) {
  if (!command || typeof command !== "object") {
    throw new Error("command must be an object");
  }
  if (!Array.isArray(command.titleList) || command.titleList.length === 0) {
    throw new Error("command.titleList must be a non-empty array");
  }

  return requestWorkTool("/wework/sendRawMessage", {
    robotId,
    method: "POST",
    body: JSON.stringify({
      socketType,
      list: [command]
    })
  });
}

export async function sendMediaMessage({
  robotId,
  targets,
  fileUrl,
  objectName,
  fileType,
  extraText,
  sendType,
  socketType = 2
}) {
  return sendRawCommand({
    robotId,
    socketType,
    command: buildRawMediaCommand({
      targets,
      fileUrl,
      objectName,
      fileType,
      extraText,
      sendType
    })
  });
}
