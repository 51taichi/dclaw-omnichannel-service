import fs from "node:fs";
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
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("bot_agent_bindings", "dclaw_base_url", "TEXT");
ensureColumn("bot_agent_bindings", "dclaw_public_id", "TEXT");

function now() {
  return new Date().toISOString();
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value) {
  return value ? JSON.parse(value) : null;
}

function rowToBinding(row) {
  if (!row) return null;
  return {
    botId: row.bot_id,
    botName: row.bot_name,
    agentId: row.agent_id,
    agentName: row.agent_name,
    dclawBaseUrl: row.dclaw_base_url,
    dclawPublicId: row.dclaw_public_id,
    agentApiUrl: row.agent_api_url,
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
  if (Number(message.roomType) === 1 && message.groupName) {
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

export function listRecords(name, limit = 50) {
  const allowed = {
    "incoming-messages": {
      table: "incoming_messages",
      mapper: (row) => ({ ...row, payload: parseJson(row.payload_json) })
    },
    "outgoing-messages": {
      table: "outgoing_messages",
      mapper: (row) => ({
        ...row,
        worktoolResponse: parseJson(row.worktool_response_json)
      })
    },
    "outgoing-commands": {
      table: "outgoing_messages",
      mapper: (row) => ({
        ...row,
        worktoolResponse: parseJson(row.worktool_response_json)
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
    conversations: {
      table: "conversations",
      mapper: (row) => row,
      orderBy: "updated_at"
    }
  };
  const config = allowed[name];
  if (!config) return null;
  return db
    .prepare(`SELECT * FROM ${config.table} ORDER BY ${config.orderBy || "id"} DESC LIMIT ?`)
    .all(Number(limit))
    .map(config.mapper);
}
