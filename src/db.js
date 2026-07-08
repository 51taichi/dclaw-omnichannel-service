import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR || "data");
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "worktool-bot-service.sqlite");
const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS bot_agent_bindings (
    bot_id TEXT PRIMARY KEY,
    bot_name TEXT,
    agent_id TEXT NOT NULL,
    agent_name TEXT,
    agent_api_url TEXT NOT NULL,
    agent_api_key TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversations (
    conversation_key TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    dclaw_session_id TEXT,
    room_type INTEGER,
    received_name TEXT,
    group_name TEXT,
    last_message_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS incoming_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    message_id TEXT,
    conversation_key TEXT,
    spoken TEXT,
    raw_spoken TEXT,
    received_name TEXT,
    group_name TEXT,
    room_type INTEGER,
    text_type INTEGER,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS outgoing_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    agent_id TEXT,
    conversation_key TEXT,
    message_id TEXT,
    target_name TEXT,
    content TEXT NOT NULL,
    worktool_response_json TEXT,
    callback_error_code INTEGER,
    callback_error_reason TEXT,
    callback_payload_json TEXT,
    callback_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS command_callbacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    message_id TEXT,
    error_code INTEGER,
    error_reason TEXT,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_invocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    incoming_message_id TEXT,
    request_json TEXT NOT NULL,
    response_json TEXT,
    status TEXT NOT NULL,
    error_message TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS message_processing (
    message_key TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    message_id TEXT,
    status TEXT NOT NULL,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT
  );

  CREATE TABLE IF NOT EXISTS proactive_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    agent_id TEXT,
    title TEXT,
    content TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'text',
    message_payload_json TEXT,
    status TEXT NOT NULL,
    total_count INTEGER NOT NULL DEFAULT 0,
    sent_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
  );

  CREATE TABLE IF NOT EXISTS proactive_task_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    bot_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_name TEXT NOT NULL,
    content TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'text',
    message_payload_json TEXT,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    message_id TEXT,
    error_message TEXT,
    worktool_response_json TEXT,
    agent_sync_status TEXT NOT NULL DEFAULT 'pending',
    agent_sync_error TEXT,
    agent_sync_response_json TEXT,
    agent_sync_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    FOREIGN KEY(task_id) REFERENCES proactive_tasks(id)
  );

  CREATE TABLE IF NOT EXISTS proactive_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_name TEXT NOT NULL,
    display_name TEXT,
    source TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_seen_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_proactive_targets_unique
  ON proactive_targets (bot_id, target_type, target_name);

  CREATE TABLE IF NOT EXISTS flow_machines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    version TEXT,
    entry_node_id TEXT NOT NULL,
    config_json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS flow_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    conversation_key TEXT NOT NULL UNIQUE,
    current_node_id TEXT NOT NULL,
    collected_data_json TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    last_message_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversation_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    direction TEXT NOT NULL,
    sender_name TEXT,
    content TEXT NOT NULL,
    raw_payload_json TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS flow_state_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    from_node_id TEXT,
    to_node_id TEXT,
    reason TEXT,
    agent_decision_json TEXT,
    created_at TEXT NOT NULL
  );
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("bot_agent_bindings", "dclaw_base_url", "TEXT");
ensureColumn("bot_agent_bindings", "dclaw_public_id", "TEXT");
ensureColumn("outgoing_messages", "callback_error_code", "INTEGER");
ensureColumn("outgoing_messages", "callback_error_reason", "TEXT");
ensureColumn("outgoing_messages", "callback_payload_json", "TEXT");
ensureColumn("outgoing_messages", "callback_at", "TEXT");
ensureColumn("proactive_tasks", "message_type", "TEXT NOT NULL DEFAULT 'text'");
ensureColumn("proactive_tasks", "message_payload_json", "TEXT");
ensureColumn("proactive_task_targets", "message_type", "TEXT NOT NULL DEFAULT 'text'");
ensureColumn("proactive_task_targets", "message_payload_json", "TEXT");
ensureColumn("proactive_task_targets", "agent_sync_status", "TEXT NOT NULL DEFAULT 'pending'");
ensureColumn("proactive_task_targets", "agent_sync_error", "TEXT");
ensureColumn("proactive_task_targets", "agent_sync_response_json", "TEXT");
ensureColumn("proactive_task_targets", "agent_sync_at", "TEXT");

function now() {
  return new Date().toISOString();
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value) {
  return value ? JSON.parse(value) : null;
}

export function buildMessageKey({ botId, conversationKey, message }) {
  const messageId = String(message?.messageId || "").trim();
  if (messageId) {
    return `${botId}:message:${messageId}`;
  }

  const roomType = message?.roomType ?? "";
  const receivedName = message?.receivedName || "";
  const groupName = message?.groupName || "";
  const raw = message?.rawSpoken || message?.rawMessage || message?.spoken || "";
  const bucket = Math.floor(Date.now() / 10000);
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify({ botId, conversationKey, roomType, receivedName, groupName, raw, bucket }))
    .digest("hex")
    .slice(0, 24);
  return `${botId}:synthetic:${digest}`;
}

export function beginMessageProcessing({ messageKey, botId, conversationKey, messageId }) {
  const timestamp = now();
  const result = db.prepare(`
    INSERT OR IGNORE INTO message_processing (
      message_key, bot_id, conversation_key, message_id, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, 'processing', ?, ?)
  `).run(messageKey, botId, conversationKey, messageId || "", timestamp, timestamp);
  return Boolean(result.changes);
}

export function finishMessageProcessing({ messageKey, status, error }) {
  db.prepare(`
    UPDATE message_processing
    SET status = ?,
        error_message = ?,
        updated_at = ?,
        finished_at = ?
    WHERE message_key = ?
  `).run(status, error || "", now(), now(), messageKey);
}

function rowToBinding(row) {
  if (!row) return null;
  const dclawBaseUrl = (row.dclaw_base_url || "").replace(/\/$/, "");
  const dclawPublicId = row.dclaw_public_id || row.agent_id;
  const agentApiUrl =
    dclawBaseUrl && dclawPublicId
      ? `${dclawBaseUrl}/api/open/v1/targets/${encodeURIComponent(dclawPublicId)}/messages`
      : row.agent_api_url;

  return {
    botId: row.bot_id,
    botName: row.bot_name,
    agentId: row.agent_id,
    agentName: row.agent_name,
    dclawBaseUrl,
    dclawPublicId,
    agentApiUrl,
    agentApiKey: row.agent_api_key,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function upsertBotBinding(binding) {
  const timestamp = now();
  const dclawBaseUrl = (binding.dclawBaseUrl || "").replace(/\/$/, "");
  const dclawPublicId = binding.dclawPublicId || binding.agentId;
  const agentApiUrl =
    dclawBaseUrl && dclawPublicId
      ? `${dclawBaseUrl}/api/open/v1/targets/${encodeURIComponent(dclawPublicId)}/messages`
      : "";

  db.prepare(`
    INSERT INTO bot_agent_bindings (
      bot_id, bot_name, agent_id, agent_name, dclaw_base_url, dclaw_public_id, agent_api_url, agent_api_key,
      enabled, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bot_id) DO UPDATE SET
      bot_name = excluded.bot_name,
      agent_id = excluded.agent_id,
      agent_name = excluded.agent_name,
      dclaw_base_url = excluded.dclaw_base_url,
      dclaw_public_id = excluded.dclaw_public_id,
      agent_api_url = excluded.agent_api_url,
      agent_api_key = excluded.agent_api_key,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).run(
    binding.botId,
    binding.botName || "",
    binding.agentId,
    binding.agentName || "",
    dclawBaseUrl,
    dclawPublicId,
    agentApiUrl,
    binding.agentApiKey || "",
    binding.enabled === false ? 0 : 1,
    timestamp,
    timestamp
  );
  return getBotBinding(binding.botId);
}

export function getBotBinding(botId) {
  return rowToBinding(
    db.prepare("SELECT * FROM bot_agent_bindings WHERE bot_id = ?").get(botId)
  );
}

export function listBotBindings() {
  return db
    .prepare("SELECT * FROM bot_agent_bindings ORDER BY updated_at DESC")
    .all()
    .map(rowToBinding);
}

export function getSetting(key, defaultValue = null) {
  const row = db.prepare("SELECT value_json FROM app_settings WHERE key = ?").get(key);
  return row ? parseJson(row.value_json) : defaultValue;
}

export function setSetting(key, value) {
  db.prepare(`
    INSERT INTO app_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(key, json(value), now());
  return getSetting(key);
}

export function getConversationKey(botId, message) {
  const roomType = Number(message.roomType);
  if ((roomType === 1 || roomType === 3) && message.groupName) {
    return `${botId}:group:${message.groupName}`;
  }
  return `${botId}:private:${message.receivedName || "unknown"}`;
}

export function upsertConversation({ botId, agentId, conversationKey, message }) {
  const timestamp = now();
  db.prepare(`
    INSERT INTO conversations (
      conversation_key, bot_id, agent_id, room_type, received_name, group_name,
      last_message_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(conversation_key) DO UPDATE SET
      agent_id = excluded.agent_id,
      room_type = excluded.room_type,
      received_name = excluded.received_name,
      group_name = excluded.group_name,
      last_message_at = excluded.last_message_at,
      updated_at = excluded.updated_at
  `).run(
    conversationKey,
    botId,
    agentId,
    message.roomType ?? null,
    message.receivedName || "",
    message.groupName || "",
    timestamp,
    timestamp,
    timestamp
  );
  return getConversation(conversationKey);
}

export function updateConversationSession(conversationKey, dclawSessionId) {
  db.prepare(`
    UPDATE conversations
    SET dclaw_session_id = ?, updated_at = ?
    WHERE conversation_key = ?
  `).run(dclawSessionId || null, now(), conversationKey);
}

export function getConversation(conversationKey) {
  const row = db
    .prepare("SELECT * FROM conversations WHERE conversation_key = ?")
    .get(conversationKey);
  if (!row) return null;
  return {
    conversationKey: row.conversation_key,
    botId: row.bot_id,
    agentId: row.agent_id,
    dclawSessionId: row.dclaw_session_id,
    roomType: row.room_type,
    receivedName: row.received_name,
    groupName: row.group_name,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function insertIncomingMessage({ botId, conversationKey, payload }) {
  const timestamp = now();
  db.prepare(`
    INSERT INTO incoming_messages (
      bot_id, message_id, conversation_key, spoken, raw_spoken, received_name,
      group_name, room_type, text_type, payload_json, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    botId,
    payload.messageId || "",
    conversationKey || "",
    payload.spoken || "",
    payload.rawSpoken || "",
    payload.receivedName || "",
    payload.groupName || "",
    payload.roomType ?? null,
    payload.textType ?? null,
    json(payload),
    timestamp
  );
}

export function insertOutgoingMessage({
  botId,
  agentId,
  conversationKey,
  messageId,
  targetName,
  content,
  worktoolResponse
}) {
  db.prepare(`
    INSERT INTO outgoing_messages (
      bot_id, agent_id, conversation_key, message_id, target_name, content,
      worktool_response_json, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    botId,
    agentId || "",
    conversationKey || "",
    messageId || "",
    targetName || "",
    content,
    json(worktoolResponse),
    now()
  );
}

export function insertCommandCallback({ botId, payload }) {
  db.prepare(`
    INSERT INTO command_callbacks (
      bot_id, message_id, error_code, error_reason, payload_json, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    botId,
    payload.messageId || "",
    payload.errorCode ?? null,
    payload.errorReason || "",
    json(payload),
    now()
  );
}

export function updateOutgoingMessageFromCommandCallback({ messageId, payload }) {
  if (!messageId) return false;
  const result = db.prepare(`
    UPDATE outgoing_messages
    SET callback_error_code = ?,
        callback_error_reason = ?,
        callback_payload_json = ?,
        callback_at = ?
    WHERE message_id = ?
  `).run(
    payload.errorCode ?? null,
    payload.errorReason || "",
    json(payload),
    now(),
    messageId
  );
  return result.changes > 0;
}

export function insertAgentInvocationStart({
  botId,
  agentId,
  conversationKey,
  incomingMessageId,
  request
}) {
  const result = db.prepare(`
    INSERT INTO agent_invocations (
      bot_id, agent_id, conversation_key, incoming_message_id, request_json,
      status, started_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    botId,
    agentId,
    conversationKey,
    incomingMessageId || "",
    json(request),
    "started",
    now()
  );
  return result.lastInsertRowid;
}

export function finishAgentInvocation({ id, response, status = "success", error }) {
  db.prepare(`
    UPDATE agent_invocations
    SET response_json = ?, status = ?, error_message = ?, finished_at = ?
    WHERE id = ?
  `).run(json(response), status, error || "", now(), id);
}

function rowToProactiveTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    botId: row.bot_id,
    agentId: row.agent_id,
    title: row.title,
    content: row.content,
    messageType: row.message_type || "text",
    messagePayload: parseJson(row.message_payload_json),
    status: row.status,
    totalCount: row.total_count,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

function rowToProactiveTarget(row) {
  if (!row) return null;
  return {
    id: row.id,
    taskId: row.task_id,
    botId: row.bot_id,
    targetType: row.target_type,
    targetName: row.target_name,
    content: row.content,
    messageType: row.message_type || "text",
    messagePayload: parseJson(row.message_payload_json),
    status: row.status,
    attempts: row.attempts,
    messageId: row.message_id,
    errorMessage: row.error_message,
    worktoolResponse: parseJson(row.worktool_response_json),
    agentSyncStatus: row.agent_sync_status || "pending",
    agentSyncError: row.agent_sync_error || "",
    agentSyncResponse: parseJson(row.agent_sync_response_json),
    agentSyncAt: row.agent_sync_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

function rowToProactiveAddressBookTarget(row) {
  if (!row) return null;
  return {
    id: row.id,
    botId: row.bot_id,
    targetType: row.target_type,
    targetName: row.target_name,
    displayName: row.display_name || row.target_name,
    source: row.source,
    enabled: Boolean(row.enabled),
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeFlowConfig(input) {
  const config = input && typeof input === "object" ? input : {};
  const nodes = Array.isArray(config.nodes) ? config.nodes : [];
  if (!nodes.length) {
    throw new Error("flow machine requires at least one node");
  }
  const normalizedNodes = nodes.map((node) => ({
    id: String(node.id || "").trim(),
    name: String(node.name || "").trim(),
    goal: String(node.goal || "").trim(),
    completionCriteria: String(node.completionCriteria || "").trim(),
    collectFields: Array.isArray(node.collectFields) ? node.collectFields.map(String) : [],
    conversationTips: Array.isArray(node.conversationTips) ? node.conversationTips.map(String) : [],
    nextNodeId: String(node.nextNodeId || "").trim(),
    transitions: Array.isArray(node.transitions) ? node.transitions : []
  }));
  if (normalizedNodes.some((node) => !node.id || !node.name)) {
    throw new Error("each flow node requires id and name");
  }
  const ids = new Set(normalizedNodes.map((node) => node.id));
  if (ids.size !== normalizedNodes.length) {
    throw new Error("flow node ids must be unique");
  }
  const entryNodeId = String(config.entryNodeId || normalizedNodes[0].id).trim();
  if (!ids.has(entryNodeId)) {
    throw new Error("entryNodeId must match a node id");
  }
  for (const node of normalizedNodes) {
    if (node.nextNodeId && !ids.has(node.nextNodeId)) {
      throw new Error(`nextNodeId not found: ${node.nextNodeId}`);
    }
  }
  return {
    name: String(config.name || "默认客服流程").trim(),
    version: String(config.version || "1.0.0").trim(),
    entryNodeId,
    nodes: normalizedNodes
  };
}

function rowToFlowMachine(row) {
  if (!row) return null;
  const config = parseJson(row.config_json) || {};
  return {
    id: row.id,
    botId: row.bot_id,
    name: row.name,
    version: row.version,
    entryNodeId: row.entry_node_id,
    config,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToFlowSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    botId: row.bot_id,
    conversationKey: row.conversation_key,
    currentNodeId: row.current_node_id,
    collectedData: parseJson(row.collected_data_json) || {},
    status: row.status,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToConversationMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    botId: row.bot_id,
    conversationKey: row.conversation_key,
    direction: row.direction,
    senderName: row.sender_name,
    content: row.content,
    rawPayload: parseJson(row.raw_payload_json),
    createdAt: row.created_at
  };
}

function rowToFlowStateEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    botId: row.bot_id,
    conversationKey: row.conversation_key,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    reason: row.reason,
    agentDecision: parseJson(row.agent_decision_json),
    createdAt: row.created_at
  };
}

export function upsertFlowMachine({ botId, config, enabled = true }) {
  const normalized = normalizeFlowConfig(config);
  const timestamp = now();
  db.prepare(`
    INSERT INTO flow_machines (
      bot_id, name, version, entry_node_id, config_json, enabled, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bot_id) DO UPDATE SET
      name = excluded.name,
      version = excluded.version,
      entry_node_id = excluded.entry_node_id,
      config_json = excluded.config_json,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).run(
    botId,
    normalized.name,
    normalized.version,
    normalized.entryNodeId,
    json(normalized),
    enabled === false ? 0 : 1,
    timestamp,
    timestamp
  );
  return getFlowMachine(botId);
}

export function getFlowMachine(botId) {
  return rowToFlowMachine(
    db.prepare("SELECT * FROM flow_machines WHERE bot_id = ?").get(botId)
  );
}

export function listFlowMachines({ botId = "" } = {}) {
  const rows = botId
    ? db.prepare("SELECT * FROM flow_machines WHERE bot_id = ? ORDER BY updated_at DESC").all(botId)
    : db.prepare("SELECT * FROM flow_machines ORDER BY updated_at DESC").all();
  return rows.map(rowToFlowMachine);
}

export function getOrCreateFlowSession({ botId, conversationKey, machine }) {
  let row = db
    .prepare("SELECT * FROM flow_sessions WHERE conversation_key = ?")
    .get(conversationKey);
  if (!row) {
    const timestamp = now();
    db.prepare(`
      INSERT INTO flow_sessions (
        bot_id, conversation_key, current_node_id, collected_data_json, status,
        last_message_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      botId,
      conversationKey,
      machine.entryNodeId,
      json({}),
      timestamp,
      timestamp,
      timestamp
    );
    row = db.prepare("SELECT * FROM flow_sessions WHERE conversation_key = ?").get(conversationKey);
  }
  return rowToFlowSession(row);
}

export function listFlowSessions({ botId, limit = 100 } = {}) {
  const params = [];
  let where = "";
  if (botId) {
    where = "WHERE fs.bot_id = ?";
    params.push(botId);
  }
  params.push(Number(limit));
  return db.prepare(`
    SELECT
      fs.*,
      c.received_name,
      c.group_name,
      c.room_type,
      fm.name AS flow_name
    FROM flow_sessions fs
    LEFT JOIN conversations c ON c.conversation_key = fs.conversation_key
    LEFT JOIN flow_machines fm ON fm.bot_id = fs.bot_id
    ${where}
    ORDER BY fs.last_message_at DESC
    LIMIT ?
  `).all(...params).map((row) => ({
    ...rowToFlowSession(row),
    receivedName: row.received_name,
    groupName: row.group_name,
    roomType: row.room_type,
    flowName: row.flow_name
  }));
}

export function updateFlowSessionNode({ botId, conversationKey, nextNodeId, reason, decision = null }) {
  const session = rowToFlowSession(
    db.prepare("SELECT * FROM flow_sessions WHERE conversation_key = ?").get(conversationKey)
  );
  if (!session) throw new Error("flow session not found");
  const timestamp = now();
  db.prepare(`
    UPDATE flow_sessions
    SET current_node_id = ?, updated_at = ?, last_message_at = ?
    WHERE conversation_key = ?
  `).run(nextNodeId, timestamp, timestamp, conversationKey);
  db.prepare(`
    INSERT INTO flow_state_events (
      bot_id, conversation_key, from_node_id, to_node_id, reason, agent_decision_json, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    botId,
    conversationKey,
    session.currentNodeId,
    nextNodeId,
    reason || "",
    json(decision),
    timestamp
  );
  return getOrCreateFlowSession({ botId, conversationKey, machine: { entryNodeId: nextNodeId } });
}

export function mergeFlowSessionData({ conversationKey, patch = {} }) {
  const session = rowToFlowSession(
    db.prepare("SELECT * FROM flow_sessions WHERE conversation_key = ?").get(conversationKey)
  );
  if (!session) return null;
  const nextData = {
    ...(session.collectedData || {}),
    ...(patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {})
  };
  const timestamp = now();
  db.prepare(`
    UPDATE flow_sessions
    SET collected_data_json = ?, last_message_at = ?, updated_at = ?
    WHERE conversation_key = ?
  `).run(json(nextData), timestamp, timestamp, conversationKey);
  return rowToFlowSession(
    db.prepare("SELECT * FROM flow_sessions WHERE conversation_key = ?").get(conversationKey)
  );
}

export function insertConversationMessage({
  botId,
  conversationKey,
  direction,
  senderName,
  content,
  rawPayload
}) {
  db.prepare(`
    INSERT INTO conversation_messages (
      bot_id, conversation_key, direction, sender_name, content, raw_payload_json, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    botId,
    conversationKey,
    direction,
    senderName || "",
    content || "",
    json(rawPayload),
    now()
  );
}

export function listConversationMessages({ conversationKey, limit = 200 }) {
  return db
    .prepare(`
      SELECT *
      FROM conversation_messages
      WHERE conversation_key = ?
      ORDER BY id ASC
      LIMIT ?
    `)
    .all(conversationKey, Number(limit))
    .map(rowToConversationMessage);
}

export function listFlowStateEvents({ conversationKey, limit = 100 }) {
  return db
    .prepare(`
      SELECT *
      FROM flow_state_events
      WHERE conversation_key = ?
      ORDER BY id ASC
      LIMIT ?
    `)
    .all(conversationKey, Number(limit))
    .map(rowToFlowStateEvent);
}

export function upsertProactiveAddressBookTarget({
  botId,
  targetType,
  targetName,
  displayName,
  source = "manual",
  enabled = true,
  lastSeenAt
}) {
  const normalizedType = targetType === "group" ? "group" : "private";
  const normalizedName = String(targetName || "").trim();
  if (!botId || !normalizedName) return null;

  const timestamp = now();
  db.prepare(`
    INSERT INTO proactive_targets (
      bot_id, target_type, target_name, display_name, source, enabled,
      last_seen_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bot_id, target_type, target_name) DO UPDATE SET
      display_name = COALESCE(NULLIF(excluded.display_name, ''), proactive_targets.display_name),
      source = CASE
        WHEN proactive_targets.source = 'manual' THEN proactive_targets.source
        ELSE excluded.source
      END,
      enabled = excluded.enabled,
      last_seen_at = COALESCE(excluded.last_seen_at, proactive_targets.last_seen_at),
      updated_at = excluded.updated_at
  `).run(
    botId,
    normalizedType,
    normalizedName,
    displayName || normalizedName,
    source,
    enabled === false ? 0 : 1,
    lastSeenAt || timestamp,
    timestamp,
    timestamp
  );

  return db
    .prepare(
      "SELECT * FROM proactive_targets WHERE bot_id = ? AND target_type = ? AND target_name = ?"
    )
    .get(botId, normalizedType, normalizedName);
}

export function syncProactiveTargetsFromIncoming(botId) {
  const params = [];
  const botFilter = botId ? "WHERE bot_id = ?" : "";
  if (botId) params.push(botId);

  const rows = db
    .prepare(`
      SELECT
        bot_id,
        CASE
          WHEN room_type IN (1, 3) THEN 'group'
          ELSE 'private'
        END AS target_type,
        CASE
          WHEN room_type IN (1, 3) THEN group_name
          ELSE received_name
        END AS target_name,
        MAX(created_at) AS last_seen_at
      FROM incoming_messages
      ${botFilter}
      GROUP BY bot_id, target_type, target_name
    `)
    .all(...params);

  for (const row of rows) {
    if (!row.target_name) continue;
    upsertProactiveAddressBookTarget({
      botId: row.bot_id,
      targetType: row.target_type,
      targetName: row.target_name,
      displayName: row.target_name,
      source: "incoming",
      lastSeenAt: row.last_seen_at
    });
  }
}

export function listProactiveAddressBookTargets({ botId, targetType, query, limit = 200 }) {
  syncProactiveTargetsFromIncoming(botId);

  const where = ["enabled = 1"];
  const params = [];
  if (botId) {
    where.push("bot_id = ?");
    params.push(botId);
  }
  if (targetType === "private" || targetType === "group") {
    where.push("target_type = ?");
    params.push(targetType);
  }
  if (query) {
    where.push("(target_name LIKE ? OR display_name LIKE ?)");
    params.push(`%${query}%`, `%${query}%`);
  }
  params.push(Number(limit));

  return db
    .prepare(`
      SELECT *
      FROM proactive_targets
      WHERE ${where.join(" AND ")}
      ORDER BY target_type ASC, COALESCE(last_seen_at, updated_at) DESC, target_name ASC
      LIMIT ?
    `)
    .all(...params)
    .map(rowToProactiveAddressBookTarget);
}

export function insertMockProactiveTargets(botId) {
  const targets = [
    { targetType: "private", targetName: "魔兮", source: "mock" },
    { targetType: "private", targetName: "张三", source: "mock" },
    { targetType: "private", targetName: "李四", source: "mock" },
    { targetType: "group", targetName: "A招商服务群", source: "mock" },
    { targetType: "group", targetName: "B招商服务群", source: "mock" },
    { targetType: "group", targetName: "渠道伙伴群", source: "mock" }
  ];
  return targets.map((target) =>
    rowToProactiveAddressBookTarget(
      upsertProactiveAddressBookTarget({
        botId,
        ...target,
        displayName: target.targetName
      })
    )
  );
}

export function createProactiveTask({
  botId,
  agentId,
  title,
  content,
  messageType = "text",
  messagePayload = {},
  targets,
  createdBy
}) {
  const timestamp = now();
  const normalizedTargets = targets.map((target) => ({
    targetType: target.targetType === "group" ? "group" : "private",
    targetName: String(target.targetName || "").trim()
  }));
  const normalizedMessageType = ["text", "media"].includes(messageType)
    ? messageType
    : "text";

  const result = db.prepare(`
    INSERT INTO proactive_tasks (
      bot_id, agent_id, title, content, message_type, message_payload_json,
      status, total_count, created_by, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    botId,
    agentId || "",
    title || "",
    content,
    normalizedMessageType,
    json(messagePayload),
    "pending",
    normalizedTargets.length,
    createdBy || "console",
    timestamp,
    timestamp
  );

  const taskId = result.lastInsertRowid;
  const insertTarget = db.prepare(`
    INSERT INTO proactive_task_targets (
      task_id, bot_id, target_type, target_name, content, message_type,
      message_payload_json, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const target of normalizedTargets) {
    insertTarget.run(
      taskId,
      botId,
      target.targetType,
      target.targetName,
      content,
      normalizedMessageType,
      json(messagePayload),
      "pending",
      timestamp,
      timestamp
    );
  }

  return getProactiveTask(taskId);
}

export function getProactiveTask(id) {
  return rowToProactiveTask(
    db.prepare("SELECT * FROM proactive_tasks WHERE id = ?").get(id)
  );
}

export function listProactiveTasks({ limit = 20, botId = "", dateFrom = "", dateTo = "" } = {}) {
  const filters = [];
  const values = [];
  if (botId) {
    filters.push("bot_id = ?");
    values.push(botId);
  }
  if (dateFrom) {
    filters.push("created_at >= ?");
    values.push(dateFrom);
  }
  if (dateTo) {
    filters.push("created_at < ?");
    values.push(dateTo);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  return db
    .prepare(`SELECT * FROM proactive_tasks ${where} ORDER BY id DESC LIMIT ?`)
    .all(...values, Number(limit))
    .map(rowToProactiveTask);
}

export function listProactiveTaskTargets(taskId) {
  return db
    .prepare("SELECT * FROM proactive_task_targets WHERE task_id = ? ORDER BY id ASC")
    .all(taskId)
    .map(rowToProactiveTarget);
}

export function claimNextProactiveTarget() {
  const target = db
    .prepare(`
      SELECT *
      FROM proactive_task_targets
      WHERE status = 'pending'
      ORDER BY id ASC
      LIMIT 1
    `)
    .get();
  if (!target) return null;

  const timestamp = now();
  const result = db.prepare(`
    UPDATE proactive_task_targets
    SET status = 'sending',
        attempts = attempts + 1,
        started_at = COALESCE(started_at, ?),
        updated_at = ?
    WHERE id = ? AND status = 'pending'
  `).run(timestamp, timestamp, target.id);
  if (!result.changes) return null;

  db.prepare(`
    UPDATE proactive_tasks
    SET status = CASE WHEN status = 'pending' THEN 'sending' ELSE status END,
        started_at = COALESCE(started_at, ?),
        updated_at = ?
    WHERE id = ?
  `).run(timestamp, timestamp, target.task_id);

  return rowToProactiveTarget(
    db.prepare("SELECT * FROM proactive_task_targets WHERE id = ?").get(target.id)
  );
}

export function resetInterruptedProactiveTargets() {
  const timestamp = now();
  db.prepare(`
    UPDATE proactive_task_targets
    SET status = 'pending',
        updated_at = ?
    WHERE status = 'sending'
  `).run(timestamp);
  db.prepare(`
    UPDATE proactive_tasks
    SET status = 'pending',
        updated_at = ?
    WHERE status = 'sending'
      AND id NOT IN (
        SELECT DISTINCT task_id
        FROM proactive_task_targets
        WHERE status IN ('sent', 'failed')
      )
  `).run(timestamp);
}

export function markProactiveTargetSent({ id, messageId, worktoolResponse }) {
  const timestamp = now();
  const target = db.prepare("SELECT task_id FROM proactive_task_targets WHERE id = ?").get(id);
  db.prepare(`
    UPDATE proactive_task_targets
    SET status = 'sent',
        message_id = ?,
        error_message = '',
        worktool_response_json = ?,
        finished_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(messageId || "", json(worktoolResponse), timestamp, timestamp, id);
  if (target) refreshProactiveTaskStatus(target.task_id);
}

export function markProactiveTargetAgentSync({ id, status, response, error }) {
  db.prepare(`
    UPDATE proactive_task_targets
    SET agent_sync_status = ?,
        agent_sync_error = ?,
        agent_sync_response_json = ?,
        agent_sync_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    status,
    error || "",
    response === undefined ? null : json(response),
    now(),
    now(),
    id
  );
}

export function updateProactiveTargetFromCommandCallback({ messageId, payload }) {
  if (!messageId) return false;
  const target = db
    .prepare("SELECT id, task_id FROM proactive_task_targets WHERE message_id = ?")
    .get(messageId);
  if (!target) return false;

  const errorCode = Number(payload.errorCode || 0);
  const failed =
    errorCode !== 0 ||
    (Array.isArray(payload.failList) && payload.failList.length > 0);
  const timestamp = now();

  db.prepare(`
    UPDATE proactive_task_targets
    SET status = ?,
        error_message = ?,
        worktool_response_json = ?,
        finished_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    failed ? "failed" : "sent",
    failed ? payload.errorReason || payload.errorMsg || "WorkTool command failed" : "",
    json(payload),
    timestamp,
    timestamp,
    target.id
  );
  refreshProactiveTaskStatus(target.task_id);
  return true;
}

export function markProactiveTargetFailed({ id, error, retry = false }) {
  const timestamp = now();
  const target = db.prepare("SELECT task_id FROM proactive_task_targets WHERE id = ?").get(id);
  db.prepare(`
    UPDATE proactive_task_targets
    SET status = ?,
        error_message = ?,
        finished_at = CASE WHEN ? THEN finished_at ELSE ? END,
        updated_at = ?
    WHERE id = ?
  `).run(retry ? "pending" : "failed", error || "", retry ? 1 : 0, timestamp, timestamp, id);
  if (target) refreshProactiveTaskStatus(target.task_id);
}

export function refreshProactiveTaskStatus(taskId) {
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status IN ('pending', 'sending') THEN 1 ELSE 0 END) AS active
    FROM proactive_task_targets
    WHERE task_id = ?
  `).get(taskId);

  let status = "pending";
  let finishedAt = null;
  if (counts.total > 0 && counts.sent === counts.total) {
    status = "sent";
    finishedAt = now();
  } else if (counts.total > 0 && counts.failed === counts.total) {
    status = "failed";
    finishedAt = now();
  } else if (counts.active > 0 && (counts.sent > 0 || counts.failed > 0)) {
    status = "sending";
  } else if (counts.failed > 0 && counts.sent > 0) {
    status = "partial";
    finishedAt = now();
  } else if (counts.active === 0 && counts.failed > 0) {
    status = counts.sent > 0 ? "partial" : "failed";
    finishedAt = now();
  } else {
    status = "sending";
  }

  db.prepare(`
    UPDATE proactive_tasks
    SET status = ?,
        total_count = ?,
        sent_count = ?,
        failed_count = ?,
        finished_at = COALESCE(finished_at, ?),
        updated_at = ?
    WHERE id = ?
  `).run(
    status,
    counts.total || 0,
    counts.sent || 0,
    counts.failed || 0,
    finishedAt,
    now(),
    taskId
  );
}

export function listRecords(name, { limit = 50, botId = "" } = {}) {
  const allowed = {
    "incoming-messages": {
      table: "incoming_messages",
      mapper: (row) => ({ ...row, payload: parseJson(row.payload_json) })
    },
    "outgoing-messages": {
      table: "outgoing_messages",
      mapper: (row) => ({
        ...row,
        worktoolResponse: parseJson(row.worktool_response_json),
        callbackPayload: parseJson(row.callback_payload_json)
      })
    },
    "outgoing-commands": {
      table: "outgoing_messages",
      mapper: (row) => ({
        ...row,
        worktoolResponse: parseJson(row.worktool_response_json),
        callbackPayload: parseJson(row.callback_payload_json)
      })
    },
    "command-callbacks": {
      table: "command_callbacks",
      mapper: (row) => ({ ...row, payload: parseJson(row.payload_json) })
    },
    "agent-invocations": {
      table: "agent_invocations",
      mapper: (row) => ({
        ...row,
        request: parseJson(row.request_json),
        response: parseJson(row.response_json)
      })
    },
    "message-processing": {
      table: "message_processing",
      mapper: (row) => row,
      orderBy: "updated_at"
    },
    conversations: {
      table: "conversations",
      mapper: (row) => row,
      orderBy: "updated_at"
    },
    "flow-machines": {
      table: "flow_machines",
      mapper: rowToFlowMachine,
      orderBy: "updated_at"
    },
    "flow-sessions": {
      table: "flow_sessions",
      mapper: rowToFlowSession,
      orderBy: "updated_at"
    },
    "conversation-messages": {
      table: "conversation_messages",
      mapper: rowToConversationMessage
    },
    "flow-state-events": {
      table: "flow_state_events",
      mapper: rowToFlowStateEvent
    },
    "proactive-tasks": {
      table: "proactive_tasks",
      mapper: rowToProactiveTask
    },
    "proactive-targets": {
      table: "proactive_task_targets",
      mapper: rowToProactiveTarget
    },
    "proactive-address-book": {
      table: "proactive_targets",
      mapper: rowToProactiveAddressBookTarget
    }
  };
  const config = allowed[name];
  if (!config) return null;
  if (botId) {
    return db
      .prepare(`SELECT * FROM ${config.table} WHERE bot_id = ? ORDER BY ${config.orderBy || "id"} DESC LIMIT ?`)
      .all(botId, Number(limit))
      .map(config.mapper);
  }
  return db
    .prepare(`SELECT * FROM ${config.table} ORDER BY ${config.orderBy || "id"} DESC LIMIT ?`)
    .all(Number(limit))
    .map(config.mapper);
}
