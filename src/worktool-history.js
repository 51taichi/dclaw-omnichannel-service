import crypto from "node:crypto";
import { requestWorkTool } from "./worktool.js";

const DEFAULT_HISTORY_START = "2020-01-01 00:00:00";
const DEFAULT_TIMEOUT_MS = 8_000;

function assertWorktoolSuccess(payload) {
  const code = Number(payload?.code);
  if (code !== 0 && code !== 200) {
    throw new Error(`WorkTool business error: ${payload?.code ?? ""} ${payload?.message || ""}`.trim());
  }
  return payload?.data || {};
}

export function normalizeWorktoolTimestamp(value) {
  const match = String(value || "").trim().match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/
  );
  if (!match) return "";
  const [, year, month, day, hour, minute, second] = match;
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) - 8,
    Number(minute),
    Number(second)
  );
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

export function historySourceKey(message) {
  return crypto.createHash("sha256").update(JSON.stringify([
    message.robotId || "",
    message.title || "",
    Number(message.sender || 0),
    Number(message.type || 0),
    message.createdAt || "",
    message.rawItems || ""
  ])).digest("hex");
}

export function normalizeCustomerHistoryRow(row) {
  let items;
  try {
    items = JSON.parse(row?.itemMsgList || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(items)) return [];
  const type = Number(row?.type || 0);
  const content = items
    .filter((item) => Number(item?.feature) !== 0)
    .map((item) => String(item?.text || "").trim())
    .filter(Boolean)
    .join("\n");
  const createdAt = normalizeWorktoolTimestamp(row?.createTime);
  const fallbackContentByType = {
    2: "[图片消息]",
    3: "[语音消息]"
  };
  const normalizedContent = content || fallbackContentByType[type] || "";
  if (!normalizedContent || !createdAt) return [];
  const message = {
    robotId: String(row?.robotId || ""),
    title: String(row?.titleList || "").trim(),
    sender: Number(row?.sender || 0),
    type,
    direction: Number(row?.sender || 0) === 0 ? "inbound" : "outbound",
    content: normalizedContent,
    createdAt,
    rawItems: String(row?.itemMsgList || "[]"),
    rawPayload: row
  };
  return [{ ...message, sourceKey: historySourceKey(message) }];
}

export function normalizeApiCommandRow(row) {
  let body;
  try {
    body = JSON.parse(row?.body || "{}");
  } catch {
    return [];
  }
  const createdAt = normalizeWorktoolTimestamp(row?.createTime);
  if (!createdAt || !Array.isArray(body?.list)) return [];
  const normalized = [];
  body.list.forEach((command, commandIndex) => {
    const targets = Array.isArray(command?.titleList) ? command.titleList : [];
    const content = String(command?.receivedContent || command?.extraText || "").trim();
    for (const target of targets) {
      const targetName = String(target || "").trim();
      if (!targetName || !content) continue;
      normalized.push({
        robotId: String(row?.robotId || ""),
        messageId: String(row?.messageId || body?.messageId || ""),
        commandIndex,
        targetName,
        type: Number(command?.type || 0),
        direction: "outbound",
        content,
        createdAt,
        rawPayload: { row, command }
      });
    }
  });
  return normalized;
}

export async function listCustomerHistory({
  robotId,
  title,
  startTime = DEFAULT_HISTORY_START,
  endTime = "2030-12-31 23:59:59",
  pageSize = 100,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  const messages = [];
  const titles = new Set();
  const deadline = Date.now() + Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
  let rawCount = 0;
  let page = 1;
  let totalPage = 1;
  do {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error("WorkTool customer history timed out");
    }
    const params = new URLSearchParams({
      title: String(title || ""),
      page: String(page),
      size: String(pageSize),
      sort: "create_time,asc",
      startTime,
      endTime
    });
    const data = assertWorktoolSuccess(await requestWorkTool(
      `/robot/wework/message?${params.toString()}`,
      { robotId, timeoutMs: remainingMs }
    ));
    const rows = Array.isArray(data.list) ? data.list : [];
    rawCount += rows.length;
    for (const row of rows) {
      if (row?.robotId && String(row.robotId) !== String(robotId)) continue;
      const normalized = normalizeCustomerHistoryRow(row);
      for (const message of normalized) {
        if (message.title) titles.add(message.title);
        messages.push(message);
      }
    }
    totalPage = Math.max(1, Number(data.totalPage || 1));
    page += 1;
  } while (page <= totalPage);
  return { messages, titles: [...titles], rawCount };
}

export async function listApiCommandPage({
  robotId,
  page = 1,
  pageSize = 100,
  sort = "create_time,desc",
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  const params = new URLSearchParams({
    page: String(page),
    size: String(pageSize),
    sort
  });
  const data = assertWorktoolSuccess(await requestWorkTool(
    `/wework/listRawMessage?${params.toString()}`,
    { robotId, timeoutMs }
  ));
  const rows = Array.isArray(data.list) ? data.list : [];
  return {
    items: rows.flatMap(normalizeApiCommandRow),
    pagination: {
      pageNum: Number(data.pageNum || page),
      pageSize: Number(data.pageSize || pageSize),
      totalPage: Number(data.totalPage || 0),
      total: Number(data.total || 0)
    }
  };
}
