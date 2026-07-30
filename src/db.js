import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mergeInlineActions } from "./action-chips.js";
import { hashAccessKey } from "./auth.js";
import { definitionSemanticHash } from "./cockpit-domain.js";
import {
  areConversationMessagesDuplicates,
  dedupeConversationMessages
} from "./conversation-message-dedupe.js";
import { dateTagIdFor, normalizeTagActivation, normalizeTagSchema } from "./tags.js";
import { normalizeWorktoolTimestamp } from "./worktool-history.js";

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

  CREATE TABLE IF NOT EXISTS agents (
    agent_id TEXT PRIMARY KEY,
    agent_name TEXT,
    dclaw_base_url TEXT NOT NULL,
    dclaw_public_id TEXT NOT NULL,
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
    conversation_epoch TEXT NOT NULL,
    dclaw_session_id TEXT,
    reset_pending INTEGER NOT NULL DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS agent_response_validation_failures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invocation_id INTEGER,
    bot_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    incoming_message_id TEXT,
    attempt_number INTEGER NOT NULL,
    stage TEXT NOT NULL,
    error_type TEXT NOT NULL,
    error_path TEXT,
    error_message TEXT NOT NULL,
    line INTEGER,
    column INTEGER,
    raw_response_text TEXT,
    retry_requested INTEGER NOT NULL DEFAULT 0,
    retry_outcome TEXT NOT NULL DEFAULT 'unknown',
    retry_error_message TEXT NOT NULL DEFAULT '',
    retry_finished_at TEXT,
    repair_actions_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_tag_evaluations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invocation_id INTEGER NOT NULL,
    bot_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    incoming_message_id TEXT,
    group_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    matched INTEGER NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    evidence_message_id TEXT NOT NULL DEFAULT '',
    evidence_text TEXT NOT NULL DEFAULT '',
    decision_action TEXT NOT NULL DEFAULT 'none',
    created_at TEXT NOT NULL,
    UNIQUE (invocation_id, group_id, tag_id)
  );

  CREATE INDEX IF NOT EXISTS idx_agent_tag_evaluations_bot_created
  ON agent_tag_evaluations (bot_id, created_at);

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS global_admin_credentials (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    username TEXT NOT NULL DEFAULT 'admin',
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workspaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    challenge_text TEXT NOT NULL,
    response_hash TEXT NOT NULL,
    auth_version INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workspace_bots (
    workspace_id INTEGER NOT NULL,
    bot_id TEXT NOT NULL UNIQUE,
    assigned_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, bot_id)
  );

  CREATE TABLE IF NOT EXISTS workspace_sessions (
    token_hash TEXT PRIMARY KEY,
    workspace_id INTEGER NOT NULL,
    auth_version INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_workspace_sessions_expiry
  ON workspace_sessions (expires_at);

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
    finished_at TEXT,
    scheduled_at TEXT,
    canceled_at TEXT,
    cancel_reason TEXT
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

  CREATE TABLE IF NOT EXISTS agent_flow_machines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    version TEXT,
    entry_node_id TEXT NOT NULL,
    config_json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_flow_machine_migration_sources (
    agent_id TEXT PRIMARY KEY,
    legacy_bot_id TEXT NOT NULL,
    migrated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_flow_machine_migration_conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    legacy_bot_id TEXT NOT NULL,
    selected_legacy_bot_id TEXT NOT NULL,
    legacy_config_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(agent_id, legacy_bot_id)
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

  CREATE TABLE IF NOT EXISTS worktool_api_message_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    command_index INTEGER NOT NULL,
    target_name TEXT NOT NULL,
    message_type INTEGER NOT NULL,
    content TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    raw_payload_json TEXT NOT NULL,
    cached_at TEXT NOT NULL,
    UNIQUE(bot_id, message_id, command_index, target_name)
  );

  CREATE INDEX IF NOT EXISTS idx_worktool_api_cache_target
  ON worktool_api_message_cache (bot_id, target_name, occurred_at);

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

  CREATE TABLE IF NOT EXISTS flow_activation_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    node_id TEXT NOT NULL,
    generation INTEGER NOT NULL DEFAULT 0,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    max_times INTEGER NOT NULL DEFAULT 1,
    interval_minutes INTEGER NOT NULL DEFAULT 30,
    polish_by_agent INTEGER NOT NULL DEFAULT 1,
    messages_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    anchor_at TEXT,
    due_at TEXT NOT NULL,
    processing_started_at TEXT,
    sent_at TEXT,
    canceled_at TEXT,
    cancel_reason TEXT,
    error_message TEXT,
    worktool_message_ids_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_flow_activation_tasks_due
  ON flow_activation_tasks (status, due_at, id);

  CREATE INDEX IF NOT EXISTS idx_flow_activation_tasks_conversation
  ON flow_activation_tasks (conversation_key, status, id);

  CREATE TABLE IF NOT EXISTS flow_action_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    source TEXT NOT NULL,
    node_id TEXT NOT NULL,
    activation_task_id TEXT NOT NULL DEFAULT '',
    action_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    action_json TEXT NOT NULL,
    status TEXT NOT NULL,
    worktool_message_id TEXT,
    worktool_response_json TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT,
    UNIQUE(bot_id, agent_id, conversation_key, source, node_id, activation_task_id, action_id)
  );

  CREATE INDEX IF NOT EXISTS idx_flow_action_executions_conversation
  ON flow_action_executions (conversation_key, source, node_id, activation_task_id);

  CREATE TABLE IF NOT EXISTS agent_tag_schemas (
    agent_id TEXT PRIMARY KEY,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversation_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    group_id TEXT,
    group_name TEXT,
    tag_id TEXT NOT NULL,
    tag_name TEXT NOT NULL,
    tag_type TEXT NOT NULL DEFAULT 'normal',
    reason TEXT,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(bot_id, agent_id, conversation_key, tag_type, group_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS conversation_tag_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    event_type TEXT NOT NULL,
    group_id TEXT,
    tag_id TEXT,
    accepted INTEGER NOT NULL DEFAULT 1,
    reason TEXT,
    source TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tag_alert_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_tag_event_id INTEGER NOT NULL UNIQUE,
    bot_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    group_id TEXT NOT NULL,
    group_name TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    tag_name TEXT NOT NULL,
    reason TEXT,
    evidence_message_id INTEGER,
    evidence_text TEXT,
    created_at TEXT NOT NULL,
    read_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_tag_alert_events_unread
  ON tag_alert_events (bot_id, read_at, id);

  CREATE TABLE IF NOT EXISTS tag_activation_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    group_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    message_index INTEGER NOT NULL DEFAULT 0,
    message_content TEXT NOT NULL,
    max_times INTEGER NOT NULL DEFAULT 1,
    interval_minutes INTEGER NOT NULL DEFAULT 30,
    polish_by_agent INTEGER NOT NULL DEFAULT 1,
    messages_json TEXT NOT NULL,
    status TEXT NOT NULL,
    due_at TEXT NOT NULL,
    processing_started_at TEXT,
    sent_at TEXT,
    canceled_at TEXT,
    cancel_reason TEXT,
    error_message TEXT,
    worktool_message_ids_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversation_reset_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    conversation_epoch TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    due_at TEXT NOT NULL,
    processing_started_at TEXT,
    completed_at TEXT,
    canceled_at TEXT,
    cancel_reason TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_conversation_reset_tasks_due
  ON conversation_reset_tasks (status, due_at, id);

  CREATE TABLE IF NOT EXISTS managed_groups (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL,
    conversation_key TEXT NOT NULL UNIQUE,
    current_name TEXT NOT NULL,
    current_remark TEXT NOT NULL DEFAULT '',
    announcement TEXT NOT NULL DEFAULT '',
    reply_policy TEXT NOT NULL DEFAULT 'mention_only'
      CHECK (reply_policy IN ('always', 'mention_only', 'never')),
    background TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL,
    lifecycle_status TEXT NOT NULL DEFAULT 'confirmed'
      CHECK (lifecycle_status IN ('creating', 'confirmed', 'failed', 'conflict')),
    group_created_at TEXT,
    date_source TEXT NOT NULL DEFAULT 'first_discovered',
    config_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_managed_groups_bot_name
  ON managed_groups (bot_id, current_name);

  CREATE TABLE IF NOT EXISTS managed_group_aliases (
    group_id TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    alias_type TEXT NOT NULL CHECK (alias_type IN ('name', 'remark')),
    alias_value TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (group_id, alias_type, alias_value)
  );

  CREATE INDEX IF NOT EXISTS idx_managed_group_alias_lookup
  ON managed_group_aliases (bot_id, alias_value);

  CREATE TABLE IF NOT EXISTS managed_group_roles (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    current_name TEXT NOT NULL,
    identity_type TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    reply_policy TEXT NOT NULL DEFAULT 'inherit'
      CHECK (reply_policy IN ('inherit', 'always', 'mention_only', 'never')),
    desired_mark_name TEXT NOT NULL DEFAULT '',
    original_mark_name TEXT NOT NULL DEFAULT '',
    sync_mark_name INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (group_id, current_name)
  );

  CREATE TABLE IF NOT EXISTS managed_group_role_aliases (
    role_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    alias_value TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (role_id, alias_value)
  );

  CREATE INDEX IF NOT EXISTS idx_managed_group_role_alias_lookup
  ON managed_group_role_aliases (group_id, alias_value);

  CREATE TABLE IF NOT EXISTS managed_group_tag_groups (
    group_id TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    tag_group_id TEXT NOT NULL,
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (group_id, tag_group_id)
  );

  CREATE TABLE IF NOT EXISTS cockpit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_key TEXT NOT NULL UNIQUE,
    bot_id TEXT NOT NULL,
    conversation_key TEXT,
    customer_key TEXT,
    event_type TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    flow_version_id INTEGER,
    tag_version_id INTEGER,
    payload_json TEXT NOT NULL,
    source_ref_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_cockpit_events_bot_cursor
  ON cockpit_events (bot_id, id);

  CREATE INDEX IF NOT EXISTS idx_cockpit_events_bot_occurred
  ON cockpit_events (bot_id, occurred_at, id);

  CREATE TABLE IF NOT EXISTS cockpit_daily_counters (
    bot_id TEXT NOT NULL,
    local_date TEXT NOT NULL,
    metric_key TEXT NOT NULL,
    metric_value INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (bot_id, local_date, metric_key)
  );

  CREATE TABLE IF NOT EXISTS cockpit_configs (
    bot_id TEXT PRIMARY KEY,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cockpit_definition_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    definition_type TEXT NOT NULL,
    semantic_hash TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    revision_number INTEGER NOT NULL,
    config_json TEXT NOT NULL,
    effective_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (bot_id, definition_type, version_number, revision_number)
  );

  CREATE TABLE IF NOT EXISTS cockpit_aggregation_cursors (
    bot_id TEXT PRIMARY KEY,
    last_event_id INTEGER NOT NULL DEFAULT 0,
    last_success_at TEXT,
    last_error TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cockpit_aggregation_states (
    bot_id TEXT PRIMARY KEY,
    state_json TEXT NOT NULL,
    last_event_id INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cockpit_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    period_type TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    status TEXT NOT NULL,
    source_through_event_id INTEGER NOT NULL DEFAULT 0,
    metrics_json TEXT NOT NULL,
    charts_json TEXT NOT NULL,
    definitions_json TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_cockpit_snapshots_period
  ON cockpit_snapshots (bot_id, period_type, period_start, status, id);

  CREATE TABLE IF NOT EXISTS cockpit_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    snapshot_id INTEGER NOT NULL,
    report_type TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    revision INTEGER NOT NULL,
    status TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    document_json TEXT NOT NULL,
    ai_error TEXT,
    generated_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (bot_id, report_type, period_start, period_end, revision)
  );

  CREATE INDEX IF NOT EXISTS idx_cockpit_reports_history
  ON cockpit_reports (bot_id, report_type, period_start DESC, revision DESC);

  CREATE TABLE IF NOT EXISTS cockpit_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL,
    bot_id TEXT NOT NULL,
    recipient TEXT NOT NULL,
    status TEXT NOT NULL,
    attempt_number INTEGER NOT NULL DEFAULT 0,
    due_at TEXT NOT NULL,
    sent_at TEXT,
    error_message TEXT,
    worktool_response_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_cockpit_deliveries_due
  ON cockpit_deliveries (status, due_at, id);

  CREATE TABLE IF NOT EXISTS cockpit_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL,
    attempt_number INTEGER NOT NULL DEFAULT 0,
    due_at TEXT NOT NULL,
    processing_started_at TEXT,
    finished_at TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_cockpit_jobs_due
  ON cockpit_jobs (stage, status, due_at, id);
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("bot_agent_bindings", "dclaw_base_url", "TEXT");
ensureColumn("bot_agent_bindings", "dclaw_public_id", "TEXT");
ensureColumn("bot_agent_bindings", "access_key_hash", "TEXT");
ensureColumn("bot_agent_bindings", "access_key_updated_at", "TEXT");
ensureColumn("conversations", "reset_pending", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("conversations", "conversation_epoch", "TEXT NOT NULL DEFAULT ''");
ensureColumn("conversations", "last_friend_added_signal_at", "TEXT");
ensureColumn("conversation_reset_tasks", "conversation_epoch", "TEXT NOT NULL DEFAULT ''");
db.exec(`
  UPDATE conversations
  SET conversation_epoch = lower(hex(randomblob(16)))
  WHERE conversation_epoch IS NULL OR conversation_epoch = ''
`);
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
ensureColumn("flow_sessions", "handoff_status", "TEXT NOT NULL DEFAULT 'ai'");
ensureColumn("flow_sessions", "handoff_at", "TEXT");
ensureColumn("flow_sessions", "handoff_by", "TEXT");
ensureColumn("flow_sessions", "handoff_reason", "TEXT");
ensureColumn("flow_sessions", "customer_origin", "TEXT NOT NULL DEFAULT 'unknown'");
ensureColumn("flow_sessions", "history_sync_status", "TEXT NOT NULL DEFAULT 'not_required'");
ensureColumn("flow_sessions", "history_imported_count", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("flow_sessions", "history_synced_at", "TEXT");
ensureColumn("flow_sessions", "history_sync_error", "TEXT");
ensureColumn("flow_sessions", "history_context_sent_at", "TEXT");
ensureColumn("conversation_messages", "source", "TEXT NOT NULL DEFAULT 'local'");
ensureColumn("conversation_messages", "source_key", "TEXT");
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_messages_external_source
  ON conversation_messages (bot_id, source, source_key)
  WHERE source_key IS NOT NULL AND source_key != '';

  CREATE INDEX IF NOT EXISTS idx_conversation_messages_scope_time
  ON conversation_messages (bot_id, conversation_key, created_at, id);

  CREATE INDEX IF NOT EXISTS idx_conversation_messages_scope_direction_time
  ON conversation_messages (bot_id, conversation_key, direction, created_at, id);
`);
ensureColumn(
  "agent_response_validation_failures",
  "retry_outcome",
  "TEXT NOT NULL DEFAULT 'unknown'"
);
ensureColumn(
  "agent_response_validation_failures",
  "retry_error_message",
  "TEXT NOT NULL DEFAULT ''"
);
ensureColumn("agent_response_validation_failures", "retry_finished_at", "TEXT");
ensureColumn(
  "agent_response_validation_failures",
  "repair_actions_json",
  "TEXT NOT NULL DEFAULT '[]'"
);
ensureColumn("flow_sessions", "activation_generation", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("flow_sessions", "activation_state_json", "TEXT");
ensureColumn("flow_sessions", "last_friend_added_at", "TEXT");
ensureColumn("flow_activation_tasks", "anchor_at", "TEXT");
ensureColumn("flow_activation_tasks", "message_index", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("flow_activation_tasks", "message_content", "TEXT");
ensureColumn("proactive_tasks", "scheduled_at", "TEXT");
ensureColumn("proactive_tasks", "canceled_at", "TEXT");
ensureColumn("proactive_tasks", "cancel_reason", "TEXT");

function now() {
  return new Date().toISOString();
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value) {
  return value ? JSON.parse(value) : null;
}

function normalizePage(value, fallback = 1) {
  return Math.max(1, Number.parseInt(value, 10) || fallback);
}

function normalizePageSize(value, fallback = 20, max = 100) {
  const parsed = Math.max(1, Number.parseInt(value, 10) || fallback);
  return Math.min(parsed, max);
}

function paginationResult({ total, page, pageSize }) {
  const normalizedTotal = Math.max(0, Number.parseInt(total, 10) || 0);
  const totalPages = Math.max(1, Math.ceil(normalizedTotal / pageSize));
  const normalizedPage = Math.min(normalizePage(page), totalPages);
  return {
    page: normalizedPage,
    pageSize,
    total: normalizedTotal,
    totalPages,
    hasPrev: normalizedPage > 1,
    hasNext: normalizedPage < totalPages
  };
}

const SYSTEM_DATE_TAG_GROUP_ID = "__date__";
const groupReplyPolicies = new Set(["always", "mention_only", "never"]);
const groupRoleReplyPolicies = new Set(["inherit", ...groupReplyPolicies]);

function normalizeManagedGroupCreatedAt(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const worktoolTimestamp = normalizeWorktoolTimestamp(raw);
  const parsed = new Date(worktoolTimestamp || raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

export function canonicalGroupConversationKey({ botId, groupId }) {
  return `${String(botId || "").trim()}:group-id:${String(groupId || "").trim()}`;
}

function listManagedGroupTagGroupIds(groupId) {
  return db.prepare(`
    SELECT tag_group_id
    FROM managed_group_tag_groups
    WHERE group_id = ?
    ORDER BY is_system DESC, tag_group_id ASC
  `).all(groupId).map((row) => row.tag_group_id);
}

function rowToManagedGroup(row) {
  if (!row) return null;
  return {
    id: row.id,
    botId: row.bot_id,
    conversationKey: row.conversation_key,
    currentName: row.current_name,
    currentRemark: row.current_remark || "",
    announcement: row.announcement || "",
    replyPolicy: row.reply_policy,
    background: row.background || "",
    source: row.source,
    lifecycleStatus: row.lifecycle_status,
    groupCreatedAt: row.group_created_at || "",
    dateSource: row.date_source,
    version: Number(row.config_version || 1),
    tagGroupIds: listManagedGroupTagGroupIds(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function addManagedGroupAlias({ groupId, botId, aliasType, aliasValue, createdAt = now() }) {
  const value = String(aliasValue || "").trim();
  if (!value) return;
  db.prepare(`
    INSERT OR IGNORE INTO managed_group_aliases (
      group_id, bot_id, alias_type, alias_value, created_at
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(groupId, botId, aliasType, value, createdAt);
}

function migrateLegacyGroupConversationKey({ botId, groupName, conversationKey }) {
  const legacyKey = `${botId}:group:${String(groupName || "").trim()}`;
  if (legacyKey === conversationKey) return false;
  const legacy = db.prepare(`
    SELECT conversation_key
    FROM conversations
    WHERE bot_id = ? AND conversation_key = ?
  `).get(botId, legacyKey);
  if (!legacy) return false;
  const existingCanonical = db.prepare(`
    SELECT conversation_key
    FROM conversations
    WHERE bot_id = ? AND conversation_key = ?
  `).get(botId, conversationKey);
  if (existingCanonical) return false;
  const scopedTables = [
    "incoming_messages",
    "outgoing_messages",
    "agent_invocations",
    "agent_response_validation_failures",
    "agent_tag_evaluations",
    "message_processing",
    "flow_sessions",
    "conversation_messages",
    "flow_state_events",
    "flow_activation_tasks",
    "flow_action_executions",
    "conversation_tags",
    "conversation_tag_events",
    "tag_alert_events",
    "tag_activation_tasks",
    "conversation_reset_tasks"
  ];
  for (const table of scopedTables) {
    db.prepare(`
      UPDATE ${table}
      SET conversation_key = ?
      WHERE bot_id = ? AND conversation_key = ?
    `).run(conversationKey, botId, legacyKey);
  }
  db.prepare(`
    UPDATE conversations
    SET conversation_key = ?
    WHERE bot_id = ? AND conversation_key = ?
  `).run(conversationKey, botId, legacyKey);
  return true;
}

export function getGroupById({ botId, groupId }) {
  return rowToManagedGroup(
    db.prepare(`
      SELECT *
      FROM managed_groups
      WHERE bot_id = ? AND id = ?
    `).get(botId, groupId)
  );
}

export function getGroupByConversationKey({ botId, conversationKey }) {
  return rowToManagedGroup(
    db.prepare(`
      SELECT *
      FROM managed_groups
      WHERE bot_id = ? AND conversation_key = ?
    `).get(botId, conversationKey)
  );
}

export function listGroupsPage({ botId, search = "", page = 1, pageSize = 50 }) {
  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedPageSize = Math.max(1, Math.min(100, Number(pageSize) || 50));
  const term = String(search || "").trim();
  const where = term
    ? `bot_id = ? AND (
        current_name LIKE ? ESCAPE '\\'
        OR current_remark LIKE ? ESCAPE '\\'
      )`
    : "bot_id = ?";
  const escaped = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
  const params = term ? [botId, escaped, escaped] : [botId];
  const total = Number(
    db.prepare(`SELECT COUNT(*) AS total FROM managed_groups WHERE ${where}`)
      .get(...params)?.total || 0
  );
  const rows = db.prepare(`
    SELECT *
    FROM managed_groups
    WHERE ${where}
    ORDER BY updated_at DESC, current_name ASC, id ASC
    LIMIT ? OFFSET ?
  `).all(
    ...params,
    normalizedPageSize,
    (normalizedPage - 1) * normalizedPageSize
  );
  return {
    items: rows.map(rowToManagedGroup),
    pagination: {
      page: normalizedPage,
      pageSize: normalizedPageSize,
      total,
      totalPages: Math.ceil(total / normalizedPageSize)
    }
  };
}

export function resolveGroupByAddress({ botId, groupName, groupRemark = "" }) {
  const values = [...new Set(
    [groupName, groupRemark].map((value) => String(value || "").trim()).filter(Boolean)
  )];
  if (!botId || !values.length) return null;
  const placeholders = values.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT DISTINCT mg.*
    FROM managed_groups mg
    LEFT JOIN managed_group_aliases mga ON mga.group_id = mg.id
    WHERE mg.bot_id = ?
      AND (
        mg.current_name IN (${placeholders})
        OR mg.current_remark IN (${placeholders})
        OR mga.alias_value IN (${placeholders})
      )
    ORDER BY mg.updated_at DESC, mg.id ASC
  `).all(botId, ...values, ...values, ...values);
  if (!rows.length) return null;
  if (rows.length > 1) {
    return { status: "ambiguous", candidates: rows.map(rowToManagedGroup) };
  }
  const row = rows[0];
  let matchedBy = "alias";
  if (values.includes(row.current_name)) matchedBy = "name";
  else if (values.includes(row.current_remark)) matchedBy = "remark";
  return { status: "resolved", group: rowToManagedGroup(row), matchedBy };
}

export function createOrGetGroup({
  botId,
  currentName,
  currentRemark = "",
  source,
  discoveredAt = now(),
  createdAt = "",
  dateSource = ""
}) {
  const name = String(currentName || "").trim();
  if (!botId || !name) throw new Error("botId and currentName are required");
  const resolved = resolveGroupByAddress({ botId, groupName: name, groupRemark: currentRemark });
  const authoritativeCreatedAt = normalizeManagedGroupCreatedAt(createdAt);
  if (resolved?.status === "resolved") {
    if (!authoritativeCreatedAt) return resolved.group;
    const normalizedDateSource = String(dateSource || "worktool");
    if (
      resolved.group.groupCreatedAt !== authoritativeCreatedAt
      || resolved.group.dateSource !== normalizedDateSource
    ) {
      const timestamp = String(discoveredAt || now());
      db.prepare(`
        UPDATE managed_groups
        SET group_created_at = ?,
            date_source = ?,
            updated_at = ?
        WHERE bot_id = ? AND id = ?
      `).run(
        authoritativeCreatedAt,
        normalizedDateSource,
        timestamp,
        botId,
        resolved.group.id
      );
    }
    const updatedGroup = getGroupById({ botId, groupId: resolved.group.id });
    const binding = getBotBinding(botId);
    if (binding?.agentId) {
      ensureManagedGroupConversationDateTag({
        botId,
        agentId: binding.agentId,
        conversationKey: updatedGroup.conversationKey,
        groupCreatedAt: updatedGroup.groupCreatedAt
      });
    }
    return updatedGroup;
  }
  if (resolved?.status === "ambiguous") {
    const error = new Error("managed group address is ambiguous");
    error.code = "GROUP_ADDRESS_AMBIGUOUS";
    throw error;
  }
  const timestamp = String(discoveredAt || now());
  const groupId = crypto.randomUUID();
  const conversationKey = canonicalGroupConversationKey({ botId, groupId });
  const groupCreatedAt = authoritativeCreatedAt
    || normalizeManagedGroupCreatedAt(timestamp)
    || timestamp;
  const normalizedDateSource = String(
    dateSource
      || (authoritativeCreatedAt
        ? "worktool"
        : source === "created"
          ? "system_created"
          : "first_discovered")
  );
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO managed_groups (
        id, bot_id, conversation_key, current_name, current_remark,
        reply_policy, background, source, lifecycle_status,
        group_created_at, date_source, config_version, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'mention_only', '', ?, ?, ?, ?, 1, ?, ?)
    `).run(
      groupId,
      botId,
      conversationKey,
      name,
      String(currentRemark || "").trim(),
      String(source || "callback"),
      source === "created" ? "creating" : "confirmed",
      groupCreatedAt,
      normalizedDateSource,
      timestamp,
      timestamp
    );
    addManagedGroupAlias({ groupId, botId, aliasType: "name", aliasValue: name, createdAt: timestamp });
    addManagedGroupAlias({
      groupId,
      botId,
      aliasType: "remark",
      aliasValue: currentRemark,
      createdAt: timestamp
    });
    db.prepare(`
      INSERT INTO managed_group_tag_groups (
        group_id, bot_id, tag_group_id, is_system, created_at
      )
      VALUES (?, ?, ?, 1, ?)
    `).run(groupId, botId, SYSTEM_DATE_TAG_GROUP_ID, timestamp);
    migrateLegacyGroupConversationKey({
      botId,
      groupName: name,
      conversationKey
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getGroupById({ botId, groupId });
}

function assertManagedGroupVersion({ botId, groupId, expectedVersion }) {
  const group = getGroupById({ botId, groupId });
  if (!group) throw new Error("managed group not found");
  if (Number(group.version) !== Number(expectedVersion)) {
    const error = new Error("group configuration version conflict");
    error.code = "GROUP_VERSION_CONFLICT";
    throw error;
  }
  return group;
}

export function updateGroupExternalSnapshot({
  botId,
  groupId,
  expectedVersion,
  currentName,
  currentRemark,
  announcement
}) {
  const group = assertManagedGroupVersion({ botId, groupId, expectedVersion });
  const nextName = currentName === undefined ? group.currentName : String(currentName || "").trim();
  const nextRemark = currentRemark === undefined
    ? group.currentRemark
    : String(currentRemark || "").trim();
  const nextAnnouncement = announcement === undefined
    ? group.announcement
    : String(announcement || "");
  if (!nextName) throw new Error("currentName is required");
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    addManagedGroupAlias({
      groupId,
      botId,
      aliasType: "name",
      aliasValue: group.currentName,
      createdAt: timestamp
    });
    addManagedGroupAlias({
      groupId,
      botId,
      aliasType: "name",
      aliasValue: nextName,
      createdAt: timestamp
    });
    addManagedGroupAlias({
      groupId,
      botId,
      aliasType: "remark",
      aliasValue: group.currentRemark,
      createdAt: timestamp
    });
    addManagedGroupAlias({
      groupId,
      botId,
      aliasType: "remark",
      aliasValue: nextRemark,
      createdAt: timestamp
    });
    db.prepare(`
      UPDATE managed_groups
      SET current_name = ?,
          current_remark = ?,
          announcement = ?,
          config_version = config_version + 1,
          updated_at = ?
      WHERE bot_id = ? AND id = ? AND config_version = ?
    `).run(
      nextName,
      nextRemark,
      nextAnnouncement,
      timestamp,
      botId,
      groupId,
      Number(expectedVersion)
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getGroupById({ botId, groupId });
}

export function saveGroupConfig({
  botId,
  groupId,
  expectedVersion,
  replyPolicy,
  background = "",
  tagGroupIds = []
}) {
  assertManagedGroupVersion({ botId, groupId, expectedVersion });
  if (!groupReplyPolicies.has(replyPolicy)) throw new Error("invalid group reply policy");
  const normalizedTagGroupIds = [...new Set([
    SYSTEM_DATE_TAG_GROUP_ID,
    ...(Array.isArray(tagGroupIds) ? tagGroupIds : [])
  ].map((value) => String(value || "").trim()).filter(Boolean))];
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE managed_groups
      SET reply_policy = ?,
          background = ?,
          config_version = config_version + 1,
          updated_at = ?
      WHERE bot_id = ? AND id = ? AND config_version = ?
    `).run(
      replyPolicy,
      String(background || ""),
      timestamp,
      botId,
      groupId,
      Number(expectedVersion)
    );
    db.prepare(`
      DELETE FROM managed_group_tag_groups
      WHERE bot_id = ? AND group_id = ? AND is_system = 0
    `).run(botId, groupId);
    const insert = db.prepare(`
      INSERT OR IGNORE INTO managed_group_tag_groups (
        group_id, bot_id, tag_group_id, is_system, created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const tagGroupId of normalizedTagGroupIds) {
      insert.run(
        groupId,
        botId,
        tagGroupId,
        tagGroupId === SYSTEM_DATE_TAG_GROUP_ID ? 1 : 0,
        timestamp
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getGroupById({ botId, groupId });
}

function listManagedGroupRoleAliases(roleId) {
  return db.prepare(`
    SELECT alias_value
    FROM managed_group_role_aliases
    WHERE role_id = ?
    ORDER BY created_at ASC, alias_value ASC
  `).all(roleId).map((row) => row.alias_value);
}

function rowToManagedGroupRole(row) {
  return row ? {
    id: row.id,
    groupId: row.group_id,
    botId: row.bot_id,
    currentName: row.current_name,
    identityType: row.identity_type || "",
    description: row.description || "",
    replyPolicy: row.reply_policy,
    desiredMarkName: row.desired_mark_name || "",
    originalMarkName: row.original_mark_name || "",
    syncMarkName: Boolean(row.sync_mark_name),
    aliases: listManagedGroupRoleAliases(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } : null;
}

export function listGroupRoles({ botId, groupId }) {
  return db.prepare(`
    SELECT *
    FROM managed_group_roles
    WHERE bot_id = ? AND group_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(botId, groupId).map(rowToManagedGroupRole);
}

export function saveGroupRoles({ botId, groupId, expectedVersion, roles = [] }) {
  assertManagedGroupVersion({ botId, groupId, expectedVersion });
  const normalizedRoles = Array.isArray(roles) ? roles : [];
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const retainedIds = [];
    for (const role of normalizedRoles) {
      const currentName = String(role?.currentName || "").trim();
      if (!currentName) throw new Error("role currentName is required");
      const replyPolicy = String(role?.replyPolicy || "inherit");
      if (!groupRoleReplyPolicies.has(replyPolicy)) throw new Error("invalid group role reply policy");
      const existing = role.id
        ? db.prepare(`
            SELECT *
            FROM managed_group_roles
            WHERE id = ? AND bot_id = ? AND group_id = ?
          `).get(role.id, botId, groupId)
        : null;
      const roleId = existing?.id || crypto.randomUUID();
      if (existing && existing.current_name !== currentName) {
        db.prepare(`
          INSERT OR IGNORE INTO managed_group_role_aliases (
            role_id, group_id, bot_id, alias_value, created_at
          )
          VALUES (?, ?, ?, ?, ?)
        `).run(roleId, groupId, botId, existing.current_name, timestamp);
      }
      db.prepare(`
        INSERT INTO managed_group_roles (
          id, group_id, bot_id, current_name, identity_type, description,
          reply_policy, desired_mark_name, original_mark_name, sync_mark_name,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          current_name = excluded.current_name,
          identity_type = excluded.identity_type,
          description = excluded.description,
          reply_policy = excluded.reply_policy,
          desired_mark_name = excluded.desired_mark_name,
          original_mark_name = excluded.original_mark_name,
          sync_mark_name = excluded.sync_mark_name,
          updated_at = excluded.updated_at
      `).run(
        roleId,
        groupId,
        botId,
        currentName,
        String(role.identityType || ""),
        String(role.description || ""),
        replyPolicy,
        String(role.desiredMarkName || ""),
        String(role.originalMarkName || ""),
        role.syncMarkName ? 1 : 0,
        existing?.created_at || timestamp,
        timestamp
      );
      retainedIds.push(roleId);
    }
    if (retainedIds.length) {
      const placeholders = retainedIds.map(() => "?").join(", ");
      db.prepare(`
        DELETE FROM managed_group_roles
        WHERE bot_id = ? AND group_id = ? AND id NOT IN (${placeholders})
      `).run(botId, groupId, ...retainedIds);
    } else {
      db.prepare(`
        DELETE FROM managed_group_roles
        WHERE bot_id = ? AND group_id = ?
      `).run(botId, groupId);
    }
    db.prepare(`
      UPDATE managed_groups
      SET config_version = config_version + 1, updated_at = ?
      WHERE bot_id = ? AND id = ? AND config_version = ?
    `).run(timestamp, botId, groupId, Number(expectedVersion));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return {
    group: getGroupById({ botId, groupId }),
    roles: listGroupRoles({ botId, groupId })
  };
}

export function markGroupRoleRemarkSynced({ botId, groupId, roleId, markName }) {
  const normalized = String(markName || "").trim();
  if (!normalized) throw new Error("markName is required");
  const existing = db.prepare(`
    SELECT *
    FROM managed_group_roles
    WHERE bot_id = ? AND group_id = ? AND id = ?
  `).get(botId, groupId, roleId);
  if (!existing) throw new Error("managed group role not found");
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (existing.current_name !== normalized) {
      db.prepare(`
        INSERT OR IGNORE INTO managed_group_role_aliases (
          role_id, group_id, bot_id, alias_value, created_at
        )
        VALUES (?, ?, ?, ?, ?)
      `).run(roleId, groupId, botId, existing.current_name, timestamp);
    }
    db.prepare(`
      UPDATE managed_group_roles
      SET current_name = ?,
          original_mark_name = ?,
          desired_mark_name = ?,
          sync_mark_name = 0,
          updated_at = ?
      WHERE bot_id = ? AND group_id = ? AND id = ?
    `).run(normalized, normalized, normalized, timestamp, botId, groupId, roleId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return rowToManagedGroupRole(
    db.prepare(`
      SELECT *
      FROM managed_group_roles
      WHERE bot_id = ? AND group_id = ? AND id = ?
    `).get(botId, groupId, roleId)
  );
}

export function mergeGroupAlias({ botId, sourceGroupId, targetGroupId }) {
  if (!botId || !sourceGroupId || !targetGroupId || sourceGroupId === targetGroupId) {
    throw new Error("distinct source and target groups are required");
  }
  const source = getGroupById({ botId, groupId: sourceGroupId });
  const target = getGroupById({ botId, groupId: targetGroupId });
  if (!source || !target) throw new Error("managed group not found");
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const aliases = db.prepare(`
      SELECT alias_type, alias_value
      FROM managed_group_aliases
      WHERE bot_id = ? AND group_id = ?
    `).all(botId, sourceGroupId);
    aliases.push(
      { alias_type: "name", alias_value: source.currentName },
      { alias_type: "remark", alias_value: source.currentRemark }
    );
    for (const alias of aliases) {
      addManagedGroupAlias({
        groupId: targetGroupId,
        botId,
        aliasType: alias.alias_type,
        aliasValue: alias.alias_value,
        createdAt: timestamp
      });
    }
    db.prepare(`
      DELETE FROM managed_group_role_aliases
      WHERE bot_id = ? AND group_id = ?
    `).run(botId, sourceGroupId);
    db.prepare(`
      DELETE FROM managed_group_roles
      WHERE bot_id = ? AND group_id = ?
    `).run(botId, sourceGroupId);
    db.prepare(`
      DELETE FROM managed_group_tag_groups
      WHERE bot_id = ? AND group_id = ?
    `).run(botId, sourceGroupId);
    db.prepare(`
      DELETE FROM managed_group_aliases
      WHERE bot_id = ? AND group_id = ?
    `).run(botId, sourceGroupId);
    db.prepare(`
      DELETE FROM managed_groups
      WHERE bot_id = ? AND id = ?
    `).run(botId, sourceGroupId);
    db.prepare(`
      UPDATE managed_groups
      SET config_version = config_version + 1, updated_at = ?
      WHERE bot_id = ? AND id = ?
    `).run(timestamp, botId, targetGroupId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getGroupById({ botId, groupId: targetGroupId });
}

export function buildMessageKey({ botId, conversationKey, message, nowMs = Date.now() }) {
  const messageId = String(message?.messageId || "").trim();
  const isFriendAdded = Number(message?.textType) === 22 && Number(message?.type) === 105;
  if (messageId && !isFriendAdded) {
    const contentDigest = crypto
      .createHash("sha256")
      .update(JSON.stringify({
        conversationKey,
        roomType: message?.roomType ?? "",
        textType: message?.textType ?? "",
        receivedName: message?.receivedName || "",
        groupName: message?.groupName || "",
        raw: message?.rawSpoken || message?.rawMessage || message?.spoken || "",
        fileName: message?.fileName || "",
        filePath: message?.filePath || ""
      }))
      .digest("hex")
      .slice(0, 16);
    return `${botId}:message:${messageId}:${contentDigest}`;
  }

  const roomType = message?.roomType ?? "";
  const receivedName = message?.receivedName || "";
  const groupName = message?.groupName || "";
  const friendName = isFriendAdded ? String(message?.friendName || "").trim() : "";
  const friendRemark = isFriendAdded ? String(message?.friendRemark || "").trim() : "";
  const raw = message?.rawSpoken || message?.rawMessage || message?.spoken || "";
  const bucket = Math.floor((Number(nowMs) || Date.now()) / 10000);
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify({
      botId,
      conversationKey,
      roomType,
      receivedName,
      groupName,
      textType: message?.textType ?? "",
      eventType: message?.type ?? "",
      messageId: isFriendAdded ? messageId : "",
      friendName,
      friendRemark,
      raw,
      bucket
    }))
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

function buildAgentApiUrl(dclawBaseUrl, dclawPublicId, fallback = "") {
  const baseUrl = String(dclawBaseUrl || "").replace(/\/$/, "");
  const publicId = String(dclawPublicId || "").trim();
  if (baseUrl && publicId) {
    return `${baseUrl}/api/open/v1/targets/${encodeURIComponent(publicId)}/messages`;
  }
  return fallback || "";
}

function rowToAgent(row) {
  if (!row) return null;
  const dclawBaseUrl = (row.dclaw_base_url || "").replace(/\/$/, "");
  const dclawPublicId = row.dclaw_public_id || row.agent_id;

  return {
    agentId: row.agent_id,
    agentName: row.agent_name || "",
    dclawBaseUrl,
    dclawPublicId,
    agentApiUrl: buildAgentApiUrl(dclawBaseUrl, dclawPublicId, row.agent_api_url),
    agentApiKey: row.agent_api_key || "",
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToBinding(row) {
  if (!row) return null;
  const agent = getAgent(row.agent_id);
  const legacyAgent = rowToAgent(row);
  const agentConfig = agent || legacyAgent;

  return {
    botId: row.bot_id,
    botName: row.bot_name,
    agentId: row.agent_id,
    agentName: agentConfig?.agentName || "",
    dclawBaseUrl: agentConfig?.dclawBaseUrl || "",
    dclawPublicId: agentConfig?.dclawPublicId || "",
    agentApiUrl: agentConfig?.agentApiUrl || "",
    agentApiKey: agentConfig?.agentApiKey || "",
    accessKeyHash: row.access_key_hash || "",
    accessKeyUpdatedAt: row.access_key_updated_at || "",
    enabled: Boolean(row.enabled) && agentConfig?.enabled !== false,
    botEnabled: Boolean(row.enabled),
    agentEnabled: agentConfig?.enabled !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function upsertAgent(agent) {
  const timestamp = now();
  const agentId = String(agent.agentId || "").trim();
  if (!agentId) throw new Error("agentId is required");
  const dclawBaseUrl = (agent.dclawBaseUrl || "").replace(/\/$/, "");
  const dclawPublicId = agent.dclawPublicId || agentId;
  const agentApiUrl = buildAgentApiUrl(dclawBaseUrl, dclawPublicId, agent.agentApiUrl);
  if (!dclawBaseUrl) throw new Error("dclawBaseUrl is required");
  if (!dclawPublicId) throw new Error("dclawPublicId is required");

  db.prepare(`
    INSERT INTO agents (
      agent_id, agent_name, dclaw_base_url, dclaw_public_id, agent_api_url, agent_api_key,
      enabled, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      agent_name = excluded.agent_name,
      dclaw_base_url = excluded.dclaw_base_url,
      dclaw_public_id = excluded.dclaw_public_id,
      agent_api_url = excluded.agent_api_url,
      agent_api_key = excluded.agent_api_key,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).run(
    agentId,
    agent.agentName || "",
    dclawBaseUrl,
    dclawPublicId,
    agentApiUrl,
    agent.agentApiKey || "",
    agent.enabled === false ? 0 : 1,
    timestamp,
    timestamp
  );
  return getAgent(agentId);
}

export function getAgent(agentId) {
  const normalizedAgentId = String(agentId || "").trim();
  if (!normalizedAgentId) return null;
  return rowToAgent(
    db.prepare("SELECT * FROM agents WHERE agent_id = ?").get(normalizedAgentId)
  );
}

export function listAgents() {
  return db
    .prepare("SELECT * FROM agents ORDER BY updated_at DESC")
    .all()
    .map(rowToAgent);
}

export function deleteAgent(agentId) {
  const normalizedAgentId = String(agentId || "").trim();
  if (!normalizedAgentId) throw new Error("agentId is required");
  const agent = getAgent(normalizedAgentId);
  if (!agent) return null;
  const boundCount = db
    .prepare("SELECT COUNT(*) AS count FROM bot_agent_bindings WHERE agent_id = ?")
    .get(normalizedAgentId)?.count || 0;
  if (boundCount > 0) {
    throw new Error(`agent is bound by ${boundCount} bot${boundCount > 1 ? "s" : ""}`);
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM agent_flow_machine_migration_conflicts WHERE agent_id = ?")
      .run(normalizedAgentId);
    db.prepare("DELETE FROM agent_flow_machine_migration_sources WHERE agent_id = ?")
      .run(normalizedAgentId);
    db.prepare("DELETE FROM agent_flow_machines WHERE agent_id = ?").run(normalizedAgentId);
    db.prepare("DELETE FROM agents WHERE agent_id = ?").run(normalizedAgentId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return agent;
}

function backfillAgentsFromLegacyBindings() {
  const rows = db
    .prepare("SELECT * FROM bot_agent_bindings WHERE agent_id IS NOT NULL AND agent_id != ''")
    .all();
  for (const row of rows) {
    if (getAgent(row.agent_id)) continue;
    const legacyAgent = rowToAgent(row);
    if (!legacyAgent?.dclawBaseUrl || !legacyAgent?.dclawPublicId) continue;
    upsertAgent(legacyAgent);
  }
}

backfillAgentsFromLegacyBindings();

export function migrateLegacyFlowMachinesToAgents() {
  const legacyRows = db.prepare(`
    SELECT fm.*, bab.agent_id
    FROM flow_machines fm
    JOIN bot_agent_bindings bab ON bab.bot_id = fm.bot_id
    WHERE bab.agent_id IS NOT NULL
      AND bab.agent_id != ''
    ORDER BY fm.id ASC
  `).all();
  const selectedByAgent = new Map(
    db.prepare(`
      SELECT fm.agent_id, fm.config_json, source.legacy_bot_id
      FROM agent_flow_machines fm
      LEFT JOIN agent_flow_machine_migration_sources source ON source.agent_id = fm.agent_id
    `).all().map((row) => [row.agent_id, {
      configJson: row.config_json,
      legacyBotId: row.legacy_bot_id || "__existing_agent_flow__"
    }])
  );
  for (const row of legacyRows) {
    const selected = selectedByAgent.get(row.agent_id);
    if (!selected) {
      db.prepare(`
        INSERT INTO agent_flow_machines (
          agent_id, name, version, entry_node_id, config_json, enabled, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.agent_id,
        row.name,
        row.version,
        row.entry_node_id,
        row.config_json,
        row.enabled,
        row.created_at,
        row.updated_at
      );
      db.prepare(`
        INSERT INTO agent_flow_machine_migration_sources (agent_id, legacy_bot_id, migrated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(agent_id) DO NOTHING
      `).run(row.agent_id, row.bot_id, now());
      selectedByAgent.set(row.agent_id, {
        configJson: row.config_json,
        legacyBotId: row.bot_id
      });
      continue;
    }
    if (selected.legacyBotId === row.bot_id || selected.configJson === row.config_json) continue;
    db.prepare(`
      INSERT INTO agent_flow_machine_migration_conflicts (
        agent_id, legacy_bot_id, selected_legacy_bot_id, legacy_config_json, created_at
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(agent_id, legacy_bot_id) DO NOTHING
    `).run(
      row.agent_id,
      row.bot_id,
      selected.legacyBotId,
      row.config_json,
      now()
    );
  }
}

migrateLegacyFlowMachinesToAgents();

export function upsertBotBinding(binding) {
  const timestamp = now();
  const agentId = String(binding.agentId || "").trim();
  if (!agentId) throw new Error("agentId is required");
  if ((binding.dclawBaseUrl || binding.dclawPublicId || binding.agentApiKey || binding.agentName) && !getAgent(agentId)) {
    upsertAgent({
      agentId,
      agentName: binding.agentName || "",
      dclawBaseUrl: binding.dclawBaseUrl || "",
      dclawPublicId: binding.dclawPublicId || agentId,
      agentApiKey: binding.agentApiKey || "",
      enabled: true
    });
  }
  const agent = getAgent(agentId);
  const dclawBaseUrl = agent?.dclawBaseUrl || "";
  const dclawPublicId = agent?.dclawPublicId || agentId;
  const agentApiUrl = buildAgentApiUrl(dclawBaseUrl, dclawPublicId, agent?.agentApiUrl || "");

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
    agentId,
    agent?.agentName || binding.agentName || "",
    dclawBaseUrl,
    dclawPublicId,
    agentApiUrl,
    agent?.agentApiKey || binding.agentApiKey || "",
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

export function setBotAccessKey({ botId, accessKey }) {
  const timestamp = now();
  db.prepare(`
    UPDATE bot_agent_bindings
    SET access_key_hash = ?,
        access_key_updated_at = ?,
        updated_at = ?
    WHERE bot_id = ?
  `).run(hashAccessKey(accessKey), timestamp, timestamp, botId);
  const binding = getBotBinding(botId);
  if (!binding) throw new Error("bot not found");
  return binding;
}

export function listBotBindings() {
  return db
    .prepare("SELECT * FROM bot_agent_bindings ORDER BY updated_at DESC")
    .all()
    .map(rowToBinding);
}

export function deleteBotData(botId) {
  const normalizedBotId = String(botId || "").trim();
  if (!normalizedBotId) throw new Error("botId is required");

  const binding = getBotBinding(normalizedBotId);
  if (!binding) return null;

  const tables = [
    "workspace_bots",
    "cockpit_deliveries",
    "cockpit_reports",
    "cockpit_snapshots",
    "cockpit_jobs",
    "cockpit_aggregation_states",
    "cockpit_aggregation_cursors",
    "cockpit_definition_versions",
    "cockpit_configs",
    "cockpit_daily_counters",
    "cockpit_events",
    "conversation_reset_tasks",
    "flow_activation_tasks",
    "flow_state_events",
    "conversation_messages",
    "flow_sessions",
    "proactive_task_targets",
    "proactive_tasks",
    "proactive_targets",
    "message_processing",
    "agent_invocations",
    "command_callbacks",
    "outgoing_messages",
    "incoming_messages",
    "conversations",
    "flow_machines",
    "bot_agent_bindings"
  ];

  db.exec("BEGIN IMMEDIATE");
  try {
    const deleted = {};
    for (const table of tables) {
      const result = db.prepare(`DELETE FROM ${table} WHERE bot_id = ?`).run(normalizedBotId);
      deleted[table] = result.changes;
    }
    db.exec("COMMIT");
    return {
      ok: true,
      botId: normalizedBotId,
      deleted,
      binding
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function resetBotFlowStateForAgentRebind({
  botId,
  oldAgentId = "",
  newAgentId = ""
}) {
  const normalizedBotId = String(botId || "").trim();
  if (!normalizedBotId) throw new Error("botId is required");
  const timestamp = now();

  db.exec("BEGIN IMMEDIATE");
  try {
    const canceledActivationTasks = db.prepare(`
      UPDATE flow_activation_tasks
      SET status = 'canceled',
          canceled_at = ?,
          cancel_reason = 'agent_rebound',
          updated_at = ?
      WHERE bot_id = ?
        AND status IN ('pending', 'processing')
    `).run(timestamp, timestamp, normalizedBotId).changes;
    const deletedFlowStateEvents = db.prepare(
      "DELETE FROM flow_state_events WHERE bot_id = ?"
    ).run(normalizedBotId).changes;
    const resetNodeId = getFlowMachineForBot(normalizedBotId)?.entryNodeId || "__conversation__";
    const resetFlowSessions = db.prepare(`
      UPDATE flow_sessions
      SET current_node_id = ?,
          collected_data_json = ?,
          status = 'active',
          handoff_status = 'ai',
          handoff_at = NULL,
          handoff_by = '',
          handoff_reason = '',
          activation_generation = COALESCE(activation_generation, 0) + 1,
          activation_state_json = NULL,
          updated_at = ?
      WHERE bot_id = ?
    `).run(resetNodeId, json({}), timestamp, normalizedBotId).changes;
    db.exec("COMMIT");
    return {
      canceledActivationTasks,
      resetFlowSessions,
      deletedFlowStateEvents
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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

const legacyHistoryOutboundSenderMigrationKey =
  "legacy_history_outbound_sender_name_v1";

export function migrateLegacyHistoryOutboundSenderNames() {
  if (getSetting(legacyHistoryOutboundSenderMigrationKey)) return 0;
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db.prepare(`
      UPDATE conversation_messages AS messages
      SET sender_name = (
        SELECT COALESCE(
          NULLIF(TRIM(bindings.bot_name), ''),
          NULLIF(TRIM(bindings.agent_name), ''),
          '机器人'
        )
        FROM bot_agent_bindings AS bindings
        WHERE bindings.bot_id = messages.bot_id
      )
      WHERE messages.direction = 'outbound'
        AND messages.source IN ('worktool_customer_history', 'worktool_api_history')
        AND EXISTS (
          SELECT 1
          FROM bot_agent_bindings AS bindings
          WHERE bindings.bot_id = messages.bot_id
        )
    `).run();
    setSetting(legacyHistoryOutboundSenderMigrationKey, {
      migratedAt: timestamp,
      updatedCount: Number(result.changes || 0)
    });
    db.exec("COMMIT");
    return Number(result.changes || 0);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function rowToGlobalAdminCredential(row) {
  if (!row) return null;
  return {
    username: row.username,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function getGlobalAdminCredential() {
  return rowToGlobalAdminCredential(
    db.prepare("SELECT * FROM global_admin_credentials WHERE singleton_id = 1").get()
  );
}

export function initializeGlobalAdminCredential({ passwordHash }) {
  const normalizedHash = String(passwordHash || "").trim();
  if (!normalizedHash) throw new Error("passwordHash is required");
  const timestamp = now();
  const result = db.prepare(`
    INSERT OR IGNORE INTO global_admin_credentials (
      singleton_id, username, password_hash, created_at, updated_at
    )
    VALUES (1, 'admin', ?, ?, ?)
  `).run(normalizedHash, timestamp, timestamp);
  return {
    initialized: Boolean(result.changes),
    credential: getGlobalAdminCredential()
  };
}

export function updateGlobalAdminCredential({ passwordHash }) {
  const normalizedHash = String(passwordHash || "").trim();
  if (!normalizedHash) throw new Error("passwordHash is required");
  const timestamp = now();
  const result = db.prepare(`
    UPDATE global_admin_credentials
    SET password_hash = ?,
        updated_at = ?
    WHERE singleton_id = 1
  `).run(normalizedHash, timestamp);
  if (!result.changes) throw new Error("admin credential is not initialized");
  return getGlobalAdminCredential();
}

function rowToWorkspace(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    challengeText: row.challenge_text,
    responseHash: row.response_hash,
    authVersion: Number(row.auth_version || 1),
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function insertWorkspace({
  name,
  slug,
  challengeText,
  responseHash,
  authVersion = 1,
  enabled = true
}) {
  const timestamp = now();
  const result = db.prepare(`
    INSERT INTO workspaces (
      name, slug, challenge_text, response_hash, auth_version, enabled, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(name || "").trim(),
    String(slug || "").trim(),
    String(challengeText || "").trim(),
    String(responseHash || ""),
    authVersion,
    enabled === false ? 0 : 1,
    timestamp,
    timestamp
  );
  return getWorkspaceById(result.lastInsertRowid);
}

export function updateWorkspaceRecord({
  id,
  name,
  slug,
  challengeText,
  responseHash,
  authVersion,
  enabled
}) {
  const result = db.prepare(`
    UPDATE workspaces
    SET name = ?,
        slug = ?,
        challenge_text = ?,
        response_hash = ?,
        auth_version = ?,
        enabled = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    name,
    slug,
    challengeText,
    responseHash,
    authVersion,
    enabled === false ? 0 : 1,
    now(),
    id
  );
  if (!result.changes) throw new Error("workspace not found");
  return getWorkspaceById(id);
}

export function getWorkspaceById(id) {
  return rowToWorkspace(db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id));
}

export function getWorkspaceBySlug(slug) {
  return rowToWorkspace(db.prepare("SELECT * FROM workspaces WHERE slug = ?").get(slug));
}

export function listWorkspaces() {
  return db.prepare("SELECT * FROM workspaces ORDER BY created_at ASC, id ASC").all()
    .map((row) => ({
      ...rowToWorkspace(row),
      botCount: Number(
        db.prepare("SELECT COUNT(*) AS count FROM workspace_bots WHERE workspace_id = ?")
          .get(row.id)?.count || 0
      )
    }));
}

export function deleteWorkspaceRecord(id) {
  const workspace = getWorkspaceById(id);
  if (!workspace) return null;
  db.exec("BEGIN IMMEDIATE");
  try {
    const unassignedBotCount = db.prepare(
      "DELETE FROM workspace_bots WHERE workspace_id = ?"
    ).run(id).changes;
    db.prepare("DELETE FROM workspace_sessions WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
    db.exec("COMMIT");
    return { workspace, unassignedBotCount };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function assignBotsToWorkspace({ workspaceId, botIds }) {
  if (!getWorkspaceById(workspaceId)) throw new Error("workspace not found");
  const ids = [...new Set((botIds || []).map((item) => String(item || "").trim()).filter(Boolean))];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const botId of ids) {
      if (!getBotBinding(botId)) throw new Error(`bot not found: ${botId}`);
      const current = db.prepare(
        "SELECT workspace_id FROM workspace_bots WHERE bot_id = ?"
      ).get(botId);
      if (current) throw new Error(`bot already assigned: ${botId}`);
      db.prepare(`
        INSERT INTO workspace_bots (workspace_id, bot_id, assigned_at)
        VALUES (?, ?, ?)
      `).run(workspaceId, botId, now());
    }
    db.exec("COMMIT");
    return listWorkspaceBots(workspaceId);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function unassignBotFromWorkspace({ workspaceId, botId }) {
  return Boolean(db.prepare(`
    DELETE FROM workspace_bots
    WHERE workspace_id = ? AND bot_id = ?
  `).run(workspaceId, botId).changes);
}

export function transferBotToWorkspace({ botId, targetWorkspaceId }) {
  if (!getWorkspaceById(targetWorkspaceId)) throw new Error("workspace not found");
  if (!getBotBinding(botId)) throw new Error("bot not found");
  const result = db.prepare(`
    UPDATE workspace_bots
    SET workspace_id = ?,
        assigned_at = ?
    WHERE bot_id = ?
  `).run(targetWorkspaceId, now(), botId);
  if (!result.changes) {
    db.prepare(`
      INSERT INTO workspace_bots (workspace_id, bot_id, assigned_at)
      VALUES (?, ?, ?)
    `).run(targetWorkspaceId, botId, now());
  }
  return listWorkspaceBots(targetWorkspaceId).find((item) => item.botId === botId);
}

export function listWorkspaceBots(workspaceId) {
  return db.prepare(`
    SELECT bindings.*
    FROM workspace_bots assignments
    JOIN bot_agent_bindings bindings ON bindings.bot_id = assignments.bot_id
    WHERE assignments.workspace_id = ?
    ORDER BY assignments.assigned_at ASC, bindings.bot_id ASC
  `).all(workspaceId).map(rowToBinding);
}

export function listUnassignedBotBindings() {
  return db.prepare(`
    SELECT bindings.*
    FROM bot_agent_bindings bindings
    LEFT JOIN workspace_bots assignments ON assignments.bot_id = bindings.bot_id
    WHERE assignments.bot_id IS NULL
    ORDER BY bindings.updated_at DESC
  `).all().map(rowToBinding);
}

export function getWorkspaceAssignment(botId) {
  const row = db.prepare(`
    SELECT workspaces.*
    FROM workspace_bots
    JOIN workspaces ON workspaces.id = workspace_bots.workspace_id
    WHERE workspace_bots.bot_id = ?
  `).get(botId);
  return rowToWorkspace(row);
}

export function insertWorkspaceSession({
  tokenHash,
  workspaceId,
  authVersion,
  expiresAt,
  createdAt = now()
}) {
  db.prepare(`
    INSERT INTO workspace_sessions (
      token_hash, workspace_id, auth_version, expires_at, created_at
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(tokenHash, workspaceId, authVersion, expiresAt, createdAt);
  return getWorkspaceSessionByTokenHash(tokenHash);
}

export function getWorkspaceSessionByTokenHash(tokenHash) {
  const row = db.prepare(`
    SELECT sessions.*, workspaces.name, workspaces.slug, workspaces.challenge_text,
           workspaces.response_hash, workspaces.auth_version AS workspace_auth_version,
           workspaces.enabled, workspaces.created_at AS workspace_created_at,
           workspaces.updated_at AS workspace_updated_at
    FROM workspace_sessions sessions
    JOIN workspaces ON workspaces.id = sessions.workspace_id
    WHERE sessions.token_hash = ?
  `).get(tokenHash);
  if (!row) return null;
  return {
    tokenHash: row.token_hash,
    workspaceId: row.workspace_id,
    authVersion: row.auth_version,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    workspace: rowToWorkspace({
      id: row.workspace_id,
      name: row.name,
      slug: row.slug,
      challenge_text: row.challenge_text,
      response_hash: row.response_hash,
      auth_version: row.workspace_auth_version,
      enabled: row.enabled,
      created_at: row.workspace_created_at,
      updated_at: row.workspace_updated_at
    })
  };
}

export function deleteWorkspaceSessionByTokenHash(tokenHash) {
  return Boolean(
    db.prepare("DELETE FROM workspace_sessions WHERE token_hash = ?").run(tokenHash).changes
  );
}

export function deleteWorkspaceSessions(workspaceId) {
  return db.prepare("DELETE FROM workspace_sessions WHERE workspace_id = ?")
    .run(workspaceId).changes;
}

export function getConversationKey(botId, message) {
  const roomType = Number(message.roomType);
  if ((roomType === 1 || roomType === 3) && message.groupName) {
    return `${botId}:group:${message.groupName}`;
  }
  return `${botId}:private:${message.receivedName || "unknown"}`;
}

export function upsertConversation({
  botId,
  agentId,
  conversationKey,
  message,
  resetPending = false,
  skipFirstSeenDateTag = false
}) {
  const timestamp = now();
  db.prepare(`
    INSERT INTO conversations (
      conversation_key, bot_id, agent_id, conversation_epoch, reset_pending,
      room_type, received_name, group_name,
      last_message_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    crypto.randomUUID(),
    resetPending ? 1 : 0,
    message.roomType ?? null,
    message.receivedName || "",
    message.groupName || "",
    timestamp,
    timestamp,
    timestamp
  );
  const conversation = getConversation(conversationKey);
  if (!skipFirstSeenDateTag) syncConversationFirstSeenDateTag(conversation);
  return conversation;
}

export function updateConversationSession(conversationKey, dclawSessionId) {
  db.prepare(`
    UPDATE conversations
    SET dclaw_session_id = ?, updated_at = ?
    WHERE conversation_key = ?
  `).run(dclawSessionId || null, now(), conversationKey);
}

export function getConversationResetPending(conversationKey) {
  const row = db
    .prepare("SELECT reset_pending FROM conversations WHERE conversation_key = ?")
    .get(conversationKey);
  return Boolean(row?.reset_pending);
}

export function markConversationResetHandledForEpoch(conversationKey, conversationEpoch) {
  const result = db.prepare(`
    UPDATE conversations
    SET reset_pending = 0,
        updated_at = ?
    WHERE conversation_key = ?
      AND conversation_epoch = ?
  `).run(now(), conversationKey, conversationEpoch);
  return Boolean(result.changes);
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
    conversationEpoch: row.conversation_epoch,
    dclawSessionId: row.dclaw_session_id,
    resetPending: Boolean(row.reset_pending),
    roomType: row.room_type,
    receivedName: row.received_name,
    groupName: row.group_name,
    lastFriendAddedSignalAt: row.last_friend_added_signal_at || "",
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function markConversationFriendAddedSignal({
  botId,
  conversationKey,
  occurredAt = now()
}) {
  const normalizedBotId = String(botId || "").trim();
  const normalizedConversationKey = String(conversationKey || "").trim();
  if (!normalizedBotId || !normalizedConversationKey) {
    throw new Error("botId and conversationKey are required");
  }
  const occurredAtMs = Date.parse(occurredAt);
  const timestamp = Number.isFinite(occurredAtMs)
    ? new Date(occurredAtMs).toISOString()
    : now();
  const result = db.prepare(`
    UPDATE conversations
    SET last_friend_added_signal_at = ?
    WHERE conversation_key = ? AND bot_id = ?
  `).run(timestamp, normalizedConversationKey, normalizedBotId);
  if (!result.changes) throw new Error("conversation not found");
  return getConversation(normalizedConversationKey);
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

export function updateOutgoingMessageFromCommandCallback({ botId, messageId, payload }) {
  if (!botId || !messageId) return false;
  const result = db.prepare(`
    UPDATE outgoing_messages
    SET callback_error_code = ?,
        callback_error_reason = ?,
        callback_payload_json = ?,
        callback_at = ?
    WHERE message_id = ?
      AND bot_id = ?
  `).run(
    payload.errorCode ?? null,
    payload.errorReason || "",
    json(payload),
    now(),
    messageId,
    botId
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
  const historyAnalysis = request?.metadata?.historyAnalysis;
  const auditRequest = historyAnalysis
    ? {
        ...request,
        message: [
          "历史客户发言已从审计记录中省略。",
          `selectedCount=${Number(historyAnalysis.selectedCount || 0)}`,
          `selectedChars=${Number(historyAnalysis.selectedChars || 0)}`,
          `configuredLimit=${Number(historyAnalysis.configuredLimit || 0)}`
        ].join(" ")
      }
    : request;
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
    json(auditRequest),
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

export function insertAgentResponseValidationFailure({
  invocationId,
  botId,
  agentId,
  conversationKey,
  incomingMessageId,
  attemptNumber,
  stage,
  errorType,
  errorPath = "",
  errorMessage,
  line = null,
  column = null,
  rawResponseText = "",
  retryRequested = false,
  retryOutcome,
  repairActions = []
}) {
  const normalizedRetryOutcome = retryOutcome || (
    stage === "initial" ? "pending" : "not_applicable"
  );
  const createdAt = now();
  const retryFinishedAt = normalizedRetryOutcome === "locally_repaired" ? createdAt : null;
  const result = db.prepare(`
    INSERT INTO agent_response_validation_failures (
      invocation_id, bot_id, agent_id, conversation_key, incoming_message_id,
      attempt_number, stage, error_type, error_path, error_message,
      line, column, raw_response_text, retry_requested, retry_outcome,
      repair_actions_json, retry_finished_at, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    invocationId ?? null,
    botId,
    agentId,
    conversationKey,
    incomingMessageId || "",
    Math.max(1, Number.parseInt(attemptNumber, 10) || 1),
    stage || "initial",
    errorType || "validation",
    errorPath || "",
    errorMessage || "Agent response validation failed",
    Number.isFinite(Number(line)) ? Number(line) : null,
    Number.isFinite(Number(column)) ? Number(column) : null,
    String(rawResponseText || ""),
    retryRequested ? 1 : 0,
    normalizedRetryOutcome,
    json(Array.isArray(repairActions) ? repairActions : []),
    retryFinishedAt,
    createdAt
  );
  return result.lastInsertRowid;
}

export function updateAgentResponseValidationRetryOutcome({
  invocationId,
  outcome,
  errorMessage = ""
}) {
  const normalizedOutcome = [
    "succeeded",
    "failed",
    "call_failed",
    "not_attempted",
    "pending",
    "locally_repaired",
    "unknown"
  ].includes(outcome)
    ? outcome
    : "not_attempted";
  const result = db.prepare(`
    UPDATE agent_response_validation_failures
    SET retry_outcome = ?, retry_error_message = ?, retry_finished_at = ?
    WHERE invocation_id = ?
      AND attempt_number = 1
      AND stage = 'initial'
  `).run(
    normalizedOutcome,
    String(errorMessage || ""),
    now(),
    invocationId ?? null
  );
  return result.changes;
}

function rowToAgentTagEvaluation(row) {
  if (!row) return null;
  return {
    ...row,
    invocationId: row.invocation_id,
    botId: row.bot_id,
    agentId: row.agent_id,
    conversationKey: row.conversation_key,
    incomingMessageId: row.incoming_message_id,
    groupId: row.group_id,
    tagId: row.tag_id,
    matched: Boolean(row.matched),
    evidenceMessageId: row.evidence_message_id || "",
    evidenceText: row.evidence_text || "",
    decisionAction: row.decision_action || "none",
    createdAt: row.created_at
  };
}

export function insertAgentTagEvaluations({
  invocationId,
  botId,
  agentId,
  conversationKey,
  incomingMessageId,
  evaluations = [],
  decision = {}
}) {
  const addKeys = new Set(
    (Array.isArray(decision?.add) ? decision.add : [])
      .map((item) => `${String(item?.groupId || "").trim()}:${String(item?.tagId || "").trim()}`)
  );
  const removeKeys = new Set(
    (Array.isArray(decision?.remove) ? decision.remove : [])
      .map((item) => `${String(item?.groupId || "").trim()}:${String(item?.tagId || "").trim()}`)
  );
  const upsert = db.prepare(`
    INSERT INTO agent_tag_evaluations (
      invocation_id, bot_id, agent_id, conversation_key, incoming_message_id,
      group_id, tag_id, matched, reason, evidence_message_id, evidence_text,
      decision_action, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (invocation_id, group_id, tag_id) DO UPDATE SET
      matched = excluded.matched,
      reason = excluded.reason,
      evidence_message_id = excluded.evidence_message_id,
      evidence_text = excluded.evidence_text,
      decision_action = excluded.decision_action,
      created_at = excluded.created_at
  `);
  const select = db.prepare(`
    SELECT *
    FROM agent_tag_evaluations
    WHERE invocation_id = ? AND group_id = ? AND tag_id = ?
  `);
  const rows = [];

  for (const evaluation of Array.isArray(evaluations) ? evaluations : []) {
    const groupId = String(evaluation?.groupId || "").trim();
    const tagId = String(evaluation?.tagId || "").trim();
    if (!groupId || !tagId) continue;
    const evaluationKey = `${groupId}:${tagId}`;
    const decisionAction = addKeys.has(evaluationKey)
      ? "add"
      : removeKeys.has(evaluationKey)
        ? "remove"
        : "none";
    upsert.run(
      invocationId,
      botId,
      agentId,
      conversationKey,
      incomingMessageId || "",
      groupId,
      tagId,
      evaluation?.matched === true ? 1 : 0,
      String(evaluation?.reason || ""),
      String(evaluation?.evidenceMessageId || ""),
      String(evaluation?.evidenceText || ""),
      decisionAction,
      now()
    );
    rows.push(rowToAgentTagEvaluation(select.get(invocationId, groupId, tagId)));
  }
  return rows;
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
    finishedAt: row.finished_at,
    scheduledAt: row.scheduled_at,
    canceledAt: row.canceled_at,
    cancelReason: row.cancel_reason
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
  const normalizedNodes = nodes.map((node) => {
    const actionsOnComplete = normalizeFlowActions(node.actionsOnComplete);
    return {
      id: String(node.id || "").trim(),
      name: String(node.name || "").trim(),
      goal: String(node.goal || "").trim(),
      completionCriteria: String(node.completionCriteria || "").trim(),
      collectFields: Array.isArray(node.collectFields) ? node.collectFields.map(String) : [],
      conversationTips: Array.isArray(node.conversationTips) ? node.conversationTips.map(String) : [],
      activation: normalizeActivationConfig(node.activation),
      nextNodeId: String(node.nextNodeId || "").trim(),
      transitions: Array.isArray(node.transitions) ? node.transitions : [],
      ...(actionsOnComplete.length ? { actionsOnComplete } : {})
    };
  });
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
    generalRule: String(config.generalRule || "").trim(),
    nodes: normalizedNodes
  };
}

function rowToFlowMachine(row) {
  if (!row) return null;
  const config = parseJson(row.config_json) || {};
  return {
    id: row.id,
    agentId: row.agent_id || "",
    botId: row.bot_id || "",
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
    handoffStatus: row.handoff_status || "ai",
    handoffAt: row.handoff_at || "",
    handoffBy: row.handoff_by || "",
    handoffReason: row.handoff_reason || "",
    customerOrigin: row.customer_origin || "unknown",
    historySyncStatus: row.history_sync_status || "not_required",
    historyImportedCount: Number(row.history_imported_count || 0),
    historySyncedAt: row.history_synced_at || "",
    historySyncError: row.history_sync_error || "",
    historyContextSentAt: row.history_context_sent_at || "",
    activationGeneration: Number(row.activation_generation || 0),
    activationState: parseJson(row.activation_state_json),
    lastFriendAddedAt: row.last_friend_added_at || "",
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToFlowActivationTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    botId: row.bot_id,
    agentId: row.agent_id,
    conversationKey: row.conversation_key,
    nodeId: row.node_id,
    generation: Number(row.generation || 0),
    attemptNumber: Number(row.attempt_number || 1),
    messageIndex: Number(row.message_index || 0),
    messageContent: row.message_content || "",
    maxTimes: Number(row.max_times || 1),
    intervalMinutes: Number(row.interval_minutes || 30),
    polishByAgent: Boolean(row.polish_by_agent),
    messages: parseJson(row.messages_json) || [],
    status: row.status,
    anchorAt: row.anchor_at || row.due_at,
    dueAt: row.due_at,
    processingStartedAt: row.processing_started_at || "",
    sentAt: row.sent_at || "",
    canceledAt: row.canceled_at || "",
    cancelReason: row.cancel_reason || "",
    errorMessage: row.error_message || "",
    worktoolMessageIds: parseJson(row.worktool_message_ids_json) || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToFlowActionExecution(row) {
  if (!row) return null;
  return {
    id: row.id,
    botId: row.bot_id,
    agentId: row.agent_id,
    conversationKey: row.conversation_key,
    source: row.source,
    nodeId: row.node_id,
    activationTaskId: row.activation_task_id || "",
    actionId: row.action_id,
    actionType: row.action_type,
    action: parseJson(row.action_json),
    status: row.status,
    worktoolMessageId: row.worktool_message_id || "",
    worktoolResponse: parseJson(row.worktool_response_json),
    errorMessage: row.error_message || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at || ""
  };
}

function rowToAgentTagSchema(row) {
  if (!row) return null;
  return {
    agentId: row.agent_id,
    config: parseJson(row.config_json) || { dateTag: { enabled: false }, groups: [] },
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToConversationTag(row) {
  if (!row) return null;
  return {
    id: row.id,
    botId: row.bot_id,
    agentId: row.agent_id,
    conversationKey: row.conversation_key,
    groupId: row.group_id || "",
    groupName: row.group_name || "",
    tagId: row.tag_id,
    tagName: row.tag_name,
    tagType: row.tag_type,
    reason: row.reason || "",
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToTagAlertEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    sourceTagEventId: row.source_tag_event_id,
    botId: row.bot_id,
    agentId: row.agent_id,
    conversationKey: row.conversation_key,
    customerName: row.customer_name,
    groupId: row.group_id,
    groupName: row.group_name,
    tagId: row.tag_id,
    tagName: row.tag_name,
    reason: row.reason || "",
    evidenceMessageId: row.evidence_message_id || null,
    evidenceText: row.evidence_text || "",
    createdAt: row.created_at,
    readAt: row.read_at || ""
  };
}

function rowToTagActivationTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    botId: row.bot_id,
    agentId: row.agent_id,
    conversationKey: row.conversation_key,
    groupId: row.group_id,
    tagId: row.tag_id,
    attemptNumber: row.attempt_number,
    messageIndex: row.message_index,
    messageContent: row.message_content,
    maxTimes: row.max_times,
    intervalMinutes: row.interval_minutes,
    polishByAgent: Boolean(row.polish_by_agent),
    messages: parseJson(row.messages_json) || [],
    status: row.status,
    dueAt: row.due_at,
    processingStartedAt: row.processing_started_at || "",
    sentAt: row.sent_at || "",
    canceledAt: row.canceled_at || "",
    cancelReason: row.cancel_reason || "",
    errorMessage: row.error_message || "",
    worktoolMessageIds: parseJson(row.worktool_message_ids_json) || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToConversationResetTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    botId: row.bot_id,
    agentId: row.agent_id,
    conversationKey: row.conversation_key,
    conversationEpoch: row.conversation_epoch || "",
    status: row.status,
    attemptNumber: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 3),
    dueAt: row.due_at,
    processingStartedAt: row.processing_started_at || "",
    completedAt: row.completed_at || "",
    canceledAt: row.canceled_at || "",
    cancelReason: row.cancel_reason || "",
    errorMessage: row.error_message || "",
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
    source: row.source || "local",
    sourceKey: row.source_key || "",
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

function getFlowCollectFields(machine) {
  const fields = [];
  const seen = new Set();
  for (const node of machine?.config?.nodes || []) {
    for (const rawField of node.collectFields || []) {
      const field = String(rawField || "").trim();
      if (!field || seen.has(field)) continue;
      seen.add(field);
      fields.push(field);
    }
  }
  return fields;
}

export function getConversationAssets({ botId, conversationKey }) {
  const machine = getFlowMachineForBot(botId);
  const session = rowToFlowSession(
    db.prepare("SELECT * FROM flow_sessions WHERE conversation_key = ? AND bot_id = ?")
      .get(conversationKey, botId)
  );
  const collectedData = session?.collectedData || {};
  const fields = getFlowCollectFields(machine).map((field) => {
    const rawValue = collectedData[field];
    const value = rawValue == null ? "" : String(rawValue).trim();
    return {
      key: field,
      label: field,
      value,
      collected: Boolean(value)
    };
  });
  return {
    fields,
    totalCount: fields.length,
    collectedCount: fields.filter((field) => field.collected).length
  };
}

function resolveFlowMachineAgentId({ agentId = "", botId = "" } = {}) {
  const explicitAgentId = String(agentId || "").trim();
  if (explicitAgentId) return explicitAgentId;
  const bindingAgentId = getBotBinding(botId)?.agentId || "";
  return String(bindingAgentId || "").trim();
}

export function upsertFlowMachine({ agentId = "", botId = "", config, enabled = true }) {
  const resolvedAgentId = resolveFlowMachineAgentId({ agentId, botId });
  if (!resolvedAgentId) throw new Error("agent binding is required");
  if (!getAgent(resolvedAgentId)) throw new Error("agent not found");
  const normalized = normalizeFlowConfig(config);
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO agent_flow_machines (
        agent_id, name, version, entry_node_id, config_json, enabled, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        name = excluded.name,
        version = excluded.version,
        entry_node_id = excluded.entry_node_id,
        config_json = excluded.config_json,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `).run(
      resolvedAgentId,
      normalized.name,
      normalized.version,
      normalized.entryNodeId,
      json(normalized),
      enabled === false ? 0 : 1,
      timestamp,
      timestamp
    );
    resetAgentFlowActivationState({
      agentId: resolvedAgentId,
      machine: normalized,
      enabled: enabled !== false,
      timestamp
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getFlowMachine(resolvedAgentId);
}

function flowActivationDueAt({ anchorAt, intervalMinutes, attemptNumber, fallbackAt }) {
  const anchorMs = Date.parse(anchorAt || "");
  const fallbackMs = Date.parse(fallbackAt || "");
  const baseMs = Number.isFinite(anchorMs)
    ? anchorMs
    : Number.isFinite(fallbackMs)
      ? fallbackMs
      : Date.now();
  const multiplier = 2 ** Math.max(0, Number(attemptNumber || 1) - 1);
  return new Date(baseMs + Number(intervalMinutes || 0) * multiplier * 60 * 1000).toISOString();
}

function resetAgentFlowActivationState({
  agentId,
  machine,
  enabled = true,
  timestamp = now()
}) {
  const boundBots = "SELECT bot_id FROM bot_agent_bindings WHERE agent_id = ?";
  const pendingTasks = db.prepare(`
    SELECT
      fat.*,
      fs.current_node_id AS session_node_id,
      fs.status AS session_status,
      fs.handoff_status AS session_handoff_status,
      fs.activation_generation AS session_activation_generation,
      fs.activation_state_json AS session_activation_state_json
    FROM flow_activation_tasks fat
    LEFT JOIN flow_sessions fs
      ON fs.bot_id = fat.bot_id
     AND fs.conversation_key = fat.conversation_key
    WHERE fat.bot_id IN (${boundBots})
      AND fat.status = 'pending'
    ORDER BY fat.conversation_key ASC, fat.due_at ASC, fat.id ASC
  `).all(agentId);

  // In-flight work keeps the old immutable snapshot and must not be restarted.
  db.prepare(`
    UPDATE flow_activation_tasks
    SET status = 'canceled',
        canceled_at = ?,
        cancel_reason = 'flow_machine_saved',
        updated_at = ?
    WHERE bot_id IN (${boundBots})
      AND status = 'processing'
  `).run(timestamp, timestamp, agentId);
  db.prepare(`
    UPDATE flow_sessions
    SET activation_generation = COALESCE(activation_generation, 0) + 1,
        updated_at = ?
    WHERE bot_id IN (${boundBots})
  `).run(timestamp, agentId);

  const nodesById = new Map((machine?.nodes || []).map((node) => [node.id, node]));
  const migratedConversations = new Set();
  const cancelPending = db.prepare(`
    UPDATE flow_activation_tasks
    SET status = 'canceled',
        canceled_at = ?,
        cancel_reason = 'flow_machine_saved',
        updated_at = ?
    WHERE id = ?
      AND status = 'pending'
  `);
  const migratePending = db.prepare(`
    UPDATE flow_activation_tasks
    SET generation = ?,
        attempt_number = ?,
        message_index = ?,
        message_content = ?,
        max_times = ?,
        interval_minutes = ?,
        polish_by_agent = ?,
        messages_json = ?,
        anchor_at = ?,
        due_at = ?,
        updated_at = ?
    WHERE id = ?
      AND status = 'pending'
  `);

  for (const row of pendingTasks) {
    const node = nodesById.get(row.session_node_id);
    const activation = normalizeActivationConfig(node?.activation || {});
    const state = parseJson(row.session_activation_state_json);
    const currentProgress = getActivationProgressFromState({
      nodeId: row.session_node_id,
      state
    });
    let messageIndex = currentProgress.messageIndex;
    let sentCount = currentProgress.sentCount;
    while (
      activation.messages[messageIndex]
      && sentCount >= activation.messages[messageIndex].maxTimes
    ) {
      messageIndex += 1;
      sentCount = 0;
    }
    const message = activation.messages[messageIndex];
    const eligible = (
      enabled
      && row.session_status === "active"
      && row.session_handoff_status !== "human"
      && String(row.conversation_key || "").includes(":private:")
      && row.node_id === row.session_node_id
      && Number(row.generation || 0) === Number(row.session_activation_generation || 0)
      && activation.enabled
      && message
      && !migratedConversations.has(row.conversation_key)
    );
    if (!eligible) {
      cancelPending.run(timestamp, timestamp, row.id);
      continue;
    }

    const attemptNumber = sentCount + 1;
    const progressAdvanced = (
      messageIndex !== currentProgress.messageIndex
      || sentCount !== currentProgress.sentCount
    );
    const anchorAt = progressAdvanced ? timestamp : row.anchor_at || timestamp;
    const dueAt = flowActivationDueAt({
      anchorAt,
      intervalMinutes: message.intervalMinutes,
      attemptNumber,
      fallbackAt: timestamp
    });
    const nextGeneration = Number(row.session_activation_generation || 0) + 1;
    migratePending.run(
      nextGeneration,
      attemptNumber,
      messageIndex,
      message.content || "",
      message.maxTimes,
      message.intervalMinutes,
      activation.polishByAgent ? 1 : 0,
      json(activation.messages),
      anchorAt,
      dueAt,
      timestamp,
      row.id
    );
    if (progressAdvanced) {
      db.prepare(`
        UPDATE flow_sessions
        SET activation_state_json = ?, updated_at = ?
        WHERE conversation_key = ?
          AND current_node_id = ?
      `).run(
        json({ nodeId: row.session_node_id, messageIndex, sentCount }),
        timestamp,
        row.conversation_key,
        row.session_node_id
      );
    }
    migratedConversations.add(row.conversation_key);
  }
}

export function getFlowMachine(agentId) {
  return rowToFlowMachine(
    db.prepare("SELECT * FROM agent_flow_machines WHERE agent_id = ?").get(agentId)
  );
}

export function getFlowMachineForBot(botId) {
  const agentId = resolveFlowMachineAgentId({ botId });
  return agentId ? getFlowMachine(agentId) : null;
}

export function listFlowMachines({ agentId = "", botId = "" } = {}) {
  const resolvedAgentId = resolveFlowMachineAgentId({ agentId, botId });
  if ((agentId || botId) && !resolvedAgentId) return [];
  const rows = resolvedAgentId
    ? db.prepare("SELECT * FROM agent_flow_machines WHERE agent_id = ? ORDER BY updated_at DESC").all(resolvedAgentId)
    : db.prepare("SELECT * FROM agent_flow_machines ORDER BY updated_at DESC").all();
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
  const session = rowToFlowSession(row);
  if (session?.botId !== botId) throw new Error("flow session not found");
  return session;
}

export function createLegacyFlowSession({ botId, conversationKey, machine }) {
  const nodes = (machine?.config?.nodes || machine?.nodes || [])
    .filter((node) => String(node?.id || "").trim());
  const currentNodeId = String(nodes.at(-1)?.id || "").trim();
  if (!botId || !conversationKey || !currentNodeId) {
    throw new Error("botId, conversationKey, and a final flow node are required");
  }
  const timestamp = now();
  db.prepare(`
    INSERT INTO flow_sessions (
      bot_id, conversation_key, current_node_id, collected_data_json, status,
      customer_origin, history_sync_status, history_imported_count,
      last_message_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, 'active', 'legacy', 'loading', 0, ?, ?, ?)
    ON CONFLICT(conversation_key) DO UPDATE SET
      current_node_id = excluded.current_node_id,
      customer_origin = 'legacy',
      history_sync_status = 'loading',
      history_sync_error = NULL,
      history_context_sent_at = NULL,
      last_message_at = excluded.last_message_at,
      updated_at = excluded.updated_at
  `).run(
    botId,
    conversationKey,
    currentNodeId,
    json({}),
    timestamp,
    timestamp,
    timestamp
  );
  return getFlowSessionForBot({ botId, conversationKey });
}

export function updateLegacyHistorySync({
  botId,
  conversationKey,
  status,
  importedCount = 0,
  errorMessage = ""
}) {
  if (!["success", "empty", "failed"].includes(status)) {
    throw new Error("invalid legacy history sync status");
  }
  const timestamp = now();
  db.prepare(`
    UPDATE flow_sessions
    SET history_sync_status = ?,
        history_imported_count = ?,
        history_synced_at = ?,
        history_sync_error = ?,
        updated_at = ?
    WHERE bot_id = ? AND conversation_key = ?
  `).run(
    status,
    Math.max(0, Number(importedCount) || 0),
    timestamp,
    String(errorMessage || "").slice(0, 500),
    timestamp,
    botId,
    conversationKey
  );
  return getFlowSessionForBot({ botId, conversationKey });
}

export function markLegacyHistoryContextSent({ botId, conversationKey }) {
  const timestamp = now();
  db.prepare(`
    UPDATE flow_sessions
    SET history_context_sent_at = ?, updated_at = ?
    WHERE bot_id = ? AND conversation_key = ?
  `).run(timestamp, timestamp, botId, conversationKey);
  return getFlowSessionForBot({ botId, conversationKey });
}

export function resetConversationForFriendGreeting({
  botId,
  agentId,
  conversationKey,
  timestamp = now()
}) {
  const normalizedBotId = String(botId || "").trim();
  const normalizedAgentId = String(agentId || "").trim();
  const normalizedConversationKey = String(conversationKey || "").trim();
  if (!normalizedBotId || !normalizedAgentId || !normalizedConversationKey) {
    throw new Error("botId, agentId, and conversationKey are required");
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM conversation_messages WHERE conversation_key = ? AND bot_id = ?")
      .run(normalizedConversationKey, normalizedBotId);
    db.prepare("DELETE FROM flow_state_events WHERE conversation_key = ? AND bot_id = ?")
      .run(normalizedConversationKey, normalizedBotId);
    db.prepare(`
      DELETE FROM conversation_tags
      WHERE bot_id = ?
        AND agent_id = ?
        AND conversation_key = ?
    `).run(normalizedBotId, normalizedAgentId, normalizedConversationKey);
    db.prepare(`
      UPDATE flow_activation_tasks
      SET status = 'canceled',
          canceled_at = ?,
          cancel_reason = 'friend_added_reentry',
          updated_at = ?
      WHERE conversation_key = ?
        AND bot_id = ?
        AND status IN ('pending', 'processing')
    `).run(timestamp, timestamp, normalizedConversationKey, normalizedBotId);
    db.prepare(`
      UPDATE tag_activation_tasks
      SET status = 'canceled',
          canceled_at = ?,
          cancel_reason = 'friend_added_reentry',
          updated_at = ?
      WHERE bot_id = ?
        AND agent_id = ?
        AND conversation_key = ?
        AND status IN ('pending', 'processing')
    `).run(timestamp, timestamp, normalizedBotId, normalizedAgentId, normalizedConversationKey);
    db.prepare(`
      UPDATE flow_sessions
      SET collected_data_json = ?,
          status = 'active',
          handoff_status = 'ai',
          handoff_at = NULL,
          handoff_by = '',
          handoff_reason = '',
          customer_origin = 'new',
          history_sync_status = 'not_required',
          history_imported_count = 0,
          history_synced_at = NULL,
          history_sync_error = NULL,
          history_context_sent_at = NULL,
          activation_state_json = NULL,
          last_message_at = ?,
          updated_at = ?
      WHERE conversation_key = ?
        AND bot_id = ?
    `).run(json({}), timestamp, timestamp, normalizedConversationKey, normalizedBotId);
    db.prepare(`
      UPDATE conversations
      SET conversation_epoch = ?,
          dclaw_session_id = NULL,
          reset_pending = 1,
          last_message_at = ?,
          updated_at = ?
      WHERE conversation_key = ?
        AND bot_id = ?
    `).run(
      crypto.randomUUID(),
      timestamp,
      timestamp,
      normalizedConversationKey,
      normalizedBotId
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function beginFriendAddedFlowEntry({
  botId,
  conversationKey,
  machine,
  cooldownMs = 0,
  occurredAt = now(),
  activationTask = null,
  forceReentry = false
}) {
  const normalizedBotId = String(botId || "").trim();
  const normalizedConversationKey = String(conversationKey || "").trim();
  const entryNodeId = String(machine?.entryNodeId || "").trim();
  if (!normalizedBotId || !normalizedConversationKey || !entryNodeId) {
    throw new Error("botId, conversationKey, and entryNodeId are required");
  }

  const occurredAtMs = Date.parse(occurredAt);
  const timestamp = Number.isFinite(occurredAtMs) ? new Date(occurredAtMs).toISOString() : now();
  const timestampMs = Date.parse(timestamp);
  const normalizedCooldownMs = Math.max(0, Number(cooldownMs) || 0);

  db.exec("BEGIN IMMEDIATE");
  try {
    let row = db.prepare("SELECT * FROM flow_sessions WHERE conversation_key = ?")
      .get(normalizedConversationKey);
    if (!row) {
      db.prepare(`
        INSERT INTO flow_sessions (
          bot_id, conversation_key, current_node_id, collected_data_json, status,
          handoff_status, activation_generation, activation_state_json, last_friend_added_at,
          last_message_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, 'active', 'ai', 1, NULL, ?, ?, ?, ?)
      `).run(
        normalizedBotId,
        normalizedConversationKey,
        entryNodeId,
        json({}),
        timestamp,
        timestamp,
        timestamp,
        timestamp
      );
      row = db.prepare("SELECT * FROM flow_sessions WHERE conversation_key = ?")
        .get(normalizedConversationKey);
      const session = rowToFlowSession(row);
      const task = activationTask
        ? scheduleFlowActivationTask({
            ...activationTask,
            botId: normalizedBotId,
            conversationKey: normalizedConversationKey,
            nodeId: entryNodeId,
            generation: session.activationGeneration
          })
        : null;
      db.exec("COMMIT");
      return { status: "created", session, task };
    }
    if (row.bot_id !== normalizedBotId) throw new Error("flow session not found");

    const lastFriendAddedAtMs = Date.parse(row.last_friend_added_at || "");
    if (
      Number.isFinite(lastFriendAddedAtMs) &&
      timestampMs - lastFriendAddedAtMs >= 0 &&
      timestampMs - lastFriendAddedAtMs < normalizedCooldownMs
    ) {
      db.exec("COMMIT");
      return { status: "cooldown", session: rowToFlowSession(row), task: null };
    }
    if (row.current_node_id === entryNodeId && !forceReentry) {
      db.exec("COMMIT");
      return { status: "duplicate", session: rowToFlowSession(row), task: null };
    }

    db.prepare(`
      UPDATE flow_activation_tasks
      SET status = 'canceled',
          canceled_at = ?,
          cancel_reason = 'friend_added_reentry',
          updated_at = ?
      WHERE conversation_key = ?
        AND status IN ('pending', 'processing')
    `).run(timestamp, timestamp, normalizedConversationKey);

    db.prepare(`
      UPDATE flow_sessions
      SET current_node_id = ?,
          collected_data_json = ?,
          status = 'active',
          handoff_status = 'ai',
          handoff_at = NULL,
          handoff_by = '',
          handoff_reason = '',
          activation_generation = COALESCE(activation_generation, 0) + 1,
          activation_state_json = NULL,
          last_friend_added_at = ?,
          last_message_at = ?,
          updated_at = ?
      WHERE conversation_key = ?
        AND bot_id = ?
    `).run(
      entryNodeId,
      json({}),
      timestamp,
      timestamp,
      timestamp,
      normalizedConversationKey,
      normalizedBotId
    );
    db.prepare(`
      INSERT INTO flow_state_events (
        bot_id, conversation_key, from_node_id, to_node_id, reason, agent_decision_json, created_at
      )
      VALUES (?, ?, ?, ?, 'friend_added_reentry', ?, ?)
    `).run(
      normalizedBotId,
      normalizedConversationKey,
      row.current_node_id,
      entryNodeId,
      json(null),
      timestamp
    );
    row = db.prepare("SELECT * FROM flow_sessions WHERE conversation_key = ?")
      .get(normalizedConversationKey);
    const session = rowToFlowSession(row);
    const task = activationTask
      ? scheduleFlowActivationTask({
          ...activationTask,
          botId: normalizedBotId,
          conversationKey: normalizedConversationKey,
          nodeId: entryNodeId,
          generation: session.activationGeneration
        })
      : null;
    db.exec("COMMIT");
    return { status: "reentered", session, task };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getOrCreateConversationSession({
  botId,
  conversationKey,
  currentNodeId = "__conversation__"
}) {
  let row = db
    .prepare("SELECT * FROM flow_sessions WHERE conversation_key = ?")
    .get(conversationKey);
  const timestamp = now();
  if (!row) {
    db.prepare(`
      INSERT INTO flow_sessions (
        bot_id, conversation_key, current_node_id, collected_data_json, status,
        last_message_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      botId,
      conversationKey,
      currentNodeId,
      json({}),
      timestamp,
      timestamp,
      timestamp
    );
    row = db.prepare("SELECT * FROM flow_sessions WHERE conversation_key = ?").get(conversationKey);
  } else {
    db.prepare(`
      UPDATE flow_sessions
      SET last_message_at = ?, updated_at = ?
      WHERE conversation_key = ?
    `).run(timestamp, timestamp, conversationKey);
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
    LEFT JOIN bot_agent_bindings bab ON bab.bot_id = fs.bot_id
    LEFT JOIN agent_flow_machines fm ON fm.agent_id = bab.agent_id
    ${where}
    ORDER BY fs.last_message_at DESC
    LIMIT ?
  `).all(...params).map((row) => ({
    ...rowToFlowSession(row),
    receivedName: row.received_name,
    groupName: row.group_name,
    roomType: row.room_type,
    flowName: row.flow_name,
    assets: getConversationAssets({
      botId: row.bot_id,
      conversationKey: row.conversation_key
    })
  }));
}

function normalizeFlowSessionType(value) {
  return ["private", "group"].includes(value) ? value : "all";
}

function normalizeNormalTagFilters(values = []) {
  const rawValues = Array.isArray(values) ? values : String(values || "").split(",");
  return rawValues
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .map((value) => {
      const separatorIndex = value.indexOf(":");
      if (separatorIndex <= 0 || separatorIndex === value.length - 1) return null;
      return {
        groupId: value.slice(0, separatorIndex),
        tagId: value.slice(separatorIndex + 1)
      };
    })
    .filter(Boolean);
}

function normalizeDateTagFilter(value = "") {
  const raw = String(value || "").trim();
  const candidate = raw.startsWith("date:") ? raw.slice(5) : raw;
  const digits = candidate.replace(/\D/g, "").slice(0, 8);
  return digits.length === 8 ? digits : "";
}

function flowSessionPageWhere({
  botId,
  type = "all",
  query = "",
  nodeId = "",
  tagFilters = [],
  dateTag = ""
} = {}) {
  const filters = [];
  const values = [];
  if (botId) {
    filters.push("fs.bot_id = ?");
    values.push(botId);
  }

  const normalizedType = normalizeFlowSessionType(type);
  if (normalizedType === "private") {
    filters.push("(c.room_type IN (2, 4) OR (c.room_type IS NULL AND fs.conversation_key LIKE ?))");
    values.push("%:private:%");
  } else if (normalizedType === "group") {
    filters.push("(c.room_type IN (1, 3) OR fs.conversation_key LIKE ? OR fs.conversation_key LIKE ?)");
    values.push("%:group:%", "%:group-id:%");
  }

  const normalizedQuery = String(query || "").trim();
  if (normalizedQuery) {
    filters.push(`(
      COALESCE(c.received_name, '') LIKE ?
      OR COALESCE(c.group_name, '') LIKE ?
      OR fs.conversation_key LIKE ?
    )`);
    const likeQuery = `%${normalizedQuery}%`;
    values.push(likeQuery, likeQuery, likeQuery);
  }

  const normalizedNodeId = String(nodeId || "").trim();
  if (normalizedNodeId && normalizedNodeId !== "all") {
    filters.push(`(
      c.room_type IN (1, 3)
      OR fs.conversation_key LIKE '%:group:%'
      OR fs.conversation_key LIKE '%:group-id:%'
      OR fs.current_node_id = ?
    )`);
    values.push(normalizedNodeId);
  }

  const normalizedTagFilters = normalizeNormalTagFilters(tagFilters);
  if (normalizedTagFilters.length) {
    const tagClauses = normalizedTagFilters
      .map(() => "(ct.group_id = ? AND ct.tag_id = ?)")
      .join(" OR ");
    filters.push(`
      EXISTS (
        SELECT 1
        FROM conversation_tags ct
        WHERE ct.bot_id = fs.bot_id
          AND ct.agent_id = bab.agent_id
          AND ct.conversation_key = fs.conversation_key
          AND ct.tag_type = 'normal'
          AND (${tagClauses})
      )
    `);
    for (const tag of normalizedTagFilters) {
      values.push(tag.groupId, tag.tagId);
    }
  }

  const normalizedDateTag = normalizeDateTagFilter(dateTag);
  if (normalizedDateTag) {
    filters.push(`
      EXISTS (
        SELECT 1
        FROM conversation_tags ct_date
        WHERE ct_date.bot_id = fs.bot_id
          AND ct_date.agent_id = bab.agent_id
          AND ct_date.conversation_key = fs.conversation_key
          AND ct_date.tag_type = 'date'
          AND ct_date.tag_id = ?
      )
    `);
    values.push(normalizedDateTag);
  }

  return {
    where: filters.length ? `WHERE ${filters.join(" AND ")}` : "",
    values
  };
}

export function listFlowSessionsPage({
  botId,
  page = 1,
  pageSize = 20,
  type = "all",
  query = "",
  nodeId = "",
  tagFilters = [],
  dateTag = ""
} = {}) {
  const normalizedPageSize = normalizePageSize(pageSize, 20, 100);
  const requestedPage = normalizePage(page);
  const { where, values } = flowSessionPageWhere({
    botId,
    type,
    query,
    nodeId,
    tagFilters,
    dateTag
  });
  const from = `
    FROM flow_sessions fs
    LEFT JOIN conversations c ON c.conversation_key = fs.conversation_key
    LEFT JOIN bot_agent_bindings bab ON bab.bot_id = fs.bot_id
    LEFT JOIN agent_flow_machines fm ON fm.agent_id = bab.agent_id
  `;
  const total = db.prepare(`SELECT COUNT(*) AS total ${from} ${where}`).get(...values)?.total || 0;
  const pagination = paginationResult({
    total,
    page: requestedPage,
    pageSize: normalizedPageSize
  });
  const offset = (pagination.page - 1) * pagination.pageSize;
  const items = db.prepare(`
    SELECT
      fs.*,
      c.received_name,
      c.group_name,
      c.room_type,
      fm.name AS flow_name
    ${from}
    ${where}
    ORDER BY fs.last_message_at DESC, fs.id DESC
    LIMIT ? OFFSET ?
  `).all(...values, pagination.pageSize, offset).map((row) => ({
    ...rowToFlowSession(row),
    receivedName: row.received_name,
    groupName: row.group_name,
    roomType: row.room_type,
    flowName: row.flow_name,
    assets: getConversationAssets({
      botId: row.bot_id,
      conversationKey: row.conversation_key
    })
  }));

  return { items, pagination };
}

export function updateFlowSessionNode({ botId, conversationKey, nextNodeId, reason, decision = null }) {
  const session = getFlowSessionForBot({ botId, conversationKey });
  if (!session) throw new Error("flow session not found");
  const timestamp = now();
  db.prepare(`
    UPDATE flow_sessions
    SET current_node_id = ?,
        activation_state_json = NULL,
        updated_at = ?,
        last_message_at = ?
    WHERE conversation_key = ?
      AND bot_id = ?
  `).run(nextNodeId, timestamp, timestamp, conversationKey, botId);
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

export function touchFlowSession(conversationKey) {
  const timestamp = now();
  db.prepare(`
    UPDATE flow_sessions
    SET last_message_at = ?, updated_at = ?
    WHERE conversation_key = ?
  `).run(timestamp, timestamp, conversationKey);
}

export function getFlowSession(conversationKey) {
  return rowToFlowSession(
    db.prepare("SELECT * FROM flow_sessions WHERE conversation_key = ?").get(conversationKey)
  );
}

export function getFlowSessionForBot({ botId, conversationKey }) {
  return rowToFlowSession(
    db.prepare("SELECT * FROM flow_sessions WHERE conversation_key = ? AND bot_id = ?")
      .get(conversationKey, botId)
  );
}

export function updateFlowSessionHandoff({
  botId,
  conversationKey,
  handoffStatus,
  handoffBy = "console",
  reason = ""
}) {
  const status = handoffStatus === "human" ? "human" : "ai";
  const session = getFlowSession(conversationKey);
  if (!session || session.botId !== botId) {
    throw new Error("flow session not found");
  }
  const timestamp = now();
  db.prepare(`
    UPDATE flow_sessions
    SET handoff_status = ?,
        handoff_at = ?,
        handoff_by = ?,
        handoff_reason = ?,
        updated_at = ?
    WHERE conversation_key = ?
      AND bot_id = ?
  `).run(status, timestamp, handoffBy || "", reason || "", timestamp, conversationKey, botId);
  return getFlowSession(conversationKey);
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

export function normalizeFlowActions(rawActions = []) {
  if (!Array.isArray(rawActions)) return [];
  const seenIds = new Set();
  const actions = [];

  for (const [index, raw] of rawActions.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const type = String(raw.type || "").trim();
    if (type !== "invite_to_group") continue;
    const groupName = String(raw.groupName || "").trim();
    if (!groupName) continue;
    const target = String(raw.target || "current_contact").trim() || "current_contact";
    if (target !== "current_contact") continue;

    let id = String(raw.id || `action_${index + 1}`).trim();
    if (!id || seenIds.has(id)) {
      let nextIndex = actions.length + 1;
      while (seenIds.has(`action_${nextIndex}`)) nextIndex += 1;
      id = `action_${nextIndex}`;
    }
    seenIds.add(id);

    actions.push({
      id,
      type,
      groupName,
      target,
      showMessageHistory: false,
      runOnce: raw.runOnce !== false
    });
  }

  return actions;
}

function normalizeActivationMessage(raw, defaults) {
  const source = typeof raw === "string" ? { content: raw } : raw || {};
  const merged = mergeInlineActions({
    content: String(source.content || "").trim(),
    actions: source.actionsAfterSend
  });
  const content = merged.content;
  const actionsAfterSend = normalizeFlowActions(merged.actions);
  if (!content && actionsAfterSend.length === 0) return null;
  return {
    content,
    intervalMinutes: Math.max(1, Number.parseInt(source.intervalMinutes ?? defaults.intervalMinutes, 10) || defaults.intervalMinutes),
    maxTimes: Math.max(1, Number.parseInt(source.maxTimes ?? defaults.maxTimes, 10) || defaults.maxTimes),
    ...(actionsAfterSend.length ? { actionsAfterSend } : {})
  };
}

export function normalizeActivationConfig(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const intervalMinutes = Math.max(1, Number.parseInt(source.intervalMinutes ?? 30, 10) || 30);
  const maxTimes = Math.max(1, Number.parseInt(source.maxTimes ?? 1, 10) || 1);
  const messages = Array.isArray(source.messages)
    ? source.messages
      .map((item) => normalizeActivationMessage(item, { intervalMinutes, maxTimes }))
      .filter(Boolean)
    : [];
  return {
    enabled: Boolean(source.enabled),
    polishByAgent: source.polishByAgent !== false,
    messages
  };
}

export function scheduleFlowActivationTask({
  botId,
  agentId,
  conversationKey,
  nodeId,
  generation = 0,
  activation,
  anchorAt,
  dueAt,
  attemptNumber = 1,
  messageIndex = 0
}) {
  const config = normalizeActivationConfig(activation);
  const timestamp = now();
  const taskAnchorAt = anchorAt || timestamp;
  const normalizedMessageIndex = Math.max(0, Number.parseInt(messageIndex, 10) || 0);
  const message = config.messages[normalizedMessageIndex] || null;
  const result = db.prepare(`
    INSERT INTO flow_activation_tasks (
      bot_id,
      agent_id,
      conversation_key,
      node_id,
      generation,
      attempt_number,
      message_index,
      message_content,
      max_times,
      interval_minutes,
      polish_by_agent,
      messages_json,
      status,
      anchor_at,
      due_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `).run(
    botId,
    agentId,
    conversationKey,
    nodeId,
    Number(generation || 0),
    Math.max(1, Number.parseInt(attemptNumber, 10) || 1),
    normalizedMessageIndex,
    message?.content || "",
    message?.maxTimes || 1,
    message?.intervalMinutes || 30,
    config.polishByAgent ? 1 : 0,
    json(config.messages),
    taskAnchorAt,
    dueAt || timestamp,
    timestamp,
    timestamp
  );
  return rowToFlowActivationTask(
    db.prepare("SELECT * FROM flow_activation_tasks WHERE id = ?").get(result.lastInsertRowid)
  );
}

export function claimDueFlowActivationTasks({ limit = 20, nowIso = now(), staleBeforeIso = "" } = {}) {
  const timestamp = now();
  if (staleBeforeIso) {
    db.prepare(`
      UPDATE flow_activation_tasks
      SET status = 'pending',
          processing_started_at = NULL,
          updated_at = ?
      WHERE status = 'processing'
        AND processing_started_at < ?
    `).run(timestamp, staleBeforeIso);
  }

  const rows = db.prepare(`
    SELECT *
    FROM flow_activation_tasks
    WHERE status = 'pending'
      AND due_at <= ?
    ORDER BY due_at ASC, id ASC
    LIMIT ?
  `).all(nowIso, Math.max(1, Number.parseInt(limit, 10) || 20));

  const claimed = [];
  for (const row of rows) {
    const result = db.prepare(`
      UPDATE flow_activation_tasks
      SET status = 'processing',
          processing_started_at = ?,
          updated_at = ?
      WHERE id = ?
        AND status = 'pending'
    `).run(timestamp, timestamp, row.id);
    if (result.changes > 0) {
      claimed.push(rowToFlowActivationTask(
        db.prepare("SELECT * FROM flow_activation_tasks WHERE id = ?").get(row.id)
      ));
    }
  }
  return claimed;
}

export function cancelFlowActivationTasks({ conversationKey, reason = "" }) {
  const timestamp = now();
  const result = db.prepare(`
    UPDATE flow_activation_tasks
    SET status = 'canceled',
        canceled_at = ?,
        cancel_reason = ?,
        updated_at = ?
    WHERE conversation_key = ?
      AND status IN ('pending', 'processing')
  `).run(timestamp, reason || "", timestamp, conversationKey);
  return result.changes;
}

export function isFlowActivationTaskProcessing({ id }) {
  return Boolean(db.prepare(`
    SELECT 1
    FROM flow_activation_tasks
    WHERE id = ?
      AND status = 'processing'
  `).get(id));
}

export function markFlowActivationTaskSent({ id, worktoolMessageIds = [] }) {
  const timestamp = now();
  const task = db.prepare("SELECT status FROM flow_activation_tasks WHERE id = ?").get(id);
  if (!task || !["processing", "canceled"].includes(task.status)) return null;
  const result = db.prepare(`
    UPDATE flow_activation_tasks
    SET status = 'sent',
        sent_at = ?,
        error_message = '',
        worktool_message_ids_json = ?,
        updated_at = ?
    WHERE id = ?
      AND status IN ('processing', 'canceled')
  `).run(timestamp, json(worktoolMessageIds), timestamp, id);
  if (result.changes === 0) return null;
  return {
    ...rowToFlowActivationTask(
    db.prepare("SELECT * FROM flow_activation_tasks WHERE id = ?").get(id)
    ),
    wasCanceled: task.status === "canceled"
  };
}

export function markFlowActivationTaskFailed({ id, error = "" }) {
  const timestamp = now();
  const result = db.prepare(`
    UPDATE flow_activation_tasks
    SET status = 'failed',
        error_message = ?,
        updated_at = ?
    WHERE id = ?
      AND status = 'processing'
  `).run(String(error || ""), timestamp, id);
  if (result.changes === 0) return null;
  return rowToFlowActivationTask(
    db.prepare("SELECT * FROM flow_activation_tasks WHERE id = ?").get(id)
  );
}

export function reserveFlowActionExecution({
  botId,
  agentId,
  conversationKey,
  source,
  nodeId,
  activationTaskId = "",
  action
}) {
  const normalizedAction = normalizeFlowActions([action])[0];
  if (!normalizedAction) {
    throw new Error("flow action must be a valid invite_to_group action");
  }

  const timestamp = now();
  const normalizedActivationTaskId = String(activationTaskId || "");
  const result = db.prepare(`
    INSERT OR IGNORE INTO flow_action_executions (
      bot_id,
      agent_id,
      conversation_key,
      source,
      node_id,
      activation_task_id,
      action_id,
      action_type,
      action_json,
      status,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?)
  `).run(
    botId,
    agentId,
    conversationKey,
    String(source || ""),
    String(nodeId || ""),
    normalizedActivationTaskId,
    normalizedAction.id,
    normalizedAction.type,
    json(normalizedAction),
    timestamp,
    timestamp
  );

  const execution = rowToFlowActionExecution(db.prepare(`
    SELECT *
    FROM flow_action_executions
    WHERE bot_id = ?
      AND agent_id = ?
      AND conversation_key = ?
      AND source = ?
      AND node_id = ?
      AND activation_task_id = ?
      AND action_id = ?
  `).get(
    botId,
    agentId,
    conversationKey,
    String(source || ""),
    String(nodeId || ""),
    normalizedActivationTaskId,
    normalizedAction.id
  ));

  return { reserved: result.changes > 0, execution };
}

export function markFlowActionExecutionSucceeded({ id, worktoolMessageId = "", worktoolResponse = null }) {
  const timestamp = now();
  const result = db.prepare(`
    UPDATE flow_action_executions
    SET status = 'success',
        worktool_message_id = ?,
        worktool_response_json = ?,
        error_message = '',
        finished_at = ?,
        updated_at = ?
    WHERE id = ?
      AND status = 'processing'
  `).run(String(worktoolMessageId || ""), json(worktoolResponse), timestamp, timestamp, id);
  if (result.changes === 0) return rowToFlowActionExecution(
    db.prepare("SELECT * FROM flow_action_executions WHERE id = ?").get(id)
  );
  return rowToFlowActionExecution(
    db.prepare("SELECT * FROM flow_action_executions WHERE id = ?").get(id)
  );
}

export function markFlowActionExecutionFailed({ id, errorMessage = "", worktoolResponse = null }) {
  const timestamp = now();
  const result = db.prepare(`
    UPDATE flow_action_executions
    SET status = 'failed',
        worktool_response_json = ?,
        error_message = ?,
        finished_at = ?,
        updated_at = ?
    WHERE id = ?
      AND status = 'processing'
  `).run(json(worktoolResponse), String(errorMessage || ""), timestamp, timestamp, id);
  if (result.changes === 0) return rowToFlowActionExecution(
    db.prepare("SELECT * FROM flow_action_executions WHERE id = ?").get(id)
  );
  return rowToFlowActionExecution(
    db.prepare("SELECT * FROM flow_action_executions WHERE id = ?").get(id)
  );
}

export function incrementFlowActivationGeneration({ conversationKey, reason = "" }) {
  const timestamp = now();
  db.prepare(`
    UPDATE flow_sessions
    SET activation_generation = COALESCE(activation_generation, 0) + 1,
        updated_at = ?
    WHERE conversation_key = ?
  `).run(timestamp, conversationKey);
  if (reason) {
    cancelFlowActivationTasks({ conversationKey, reason });
  }
  return getFlowSession(conversationKey);
}

export function getFlowActivationProgress({ conversationKey, nodeId }) {
  const normalizedNodeId = String(nodeId || "").trim();
  const defaultProgress = {
    nodeId: normalizedNodeId,
    messageIndex: 0,
    sentCount: 0
  };
  const row = db.prepare(`
    SELECT current_node_id, activation_state_json
    FROM flow_sessions
    WHERE conversation_key = ?
  `).get(conversationKey);
  const state = parseJson(row?.activation_state_json);
  if (!row || row.current_node_id !== normalizedNodeId || !state || state.nodeId !== normalizedNodeId) {
    return defaultProgress;
  }
  return {
    nodeId: normalizedNodeId,
    messageIndex: Math.max(0, Number.parseInt(state.messageIndex, 10) || 0),
    sentCount: Math.max(0, Number.parseInt(state.sentCount, 10) || 0)
  };
}

export function advanceFlowActivationProgress({
  conversationKey,
  nodeId,
  generation,
  messageIndex,
  attemptNumber,
  messages,
  allowStaleGeneration = false
}) {
  const input = createActivationProgressInput({
    conversationKey,
    nodeId,
    generation,
    messageIndex,
    attemptNumber,
    messages,
    allowStaleGeneration
  });
  if (!input) return null;

  db.exec("BEGIN IMMEDIATE");
  try {
    const progress = advanceFlowActivationProgressInTransaction(input);
    db.exec("COMMIT");
    return progress;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function createActivationProgressInput({
  conversationKey,
  nodeId,
  generation,
  messageIndex,
  attemptNumber,
  messages,
  allowStaleGeneration = false
}) {
  const normalizedNodeId = String(nodeId || "").trim();
  const normalizedMessageIndex = Math.max(0, Number.parseInt(messageIndex, 10) || 0);
  const normalizedAttemptNumber = Math.max(1, Number.parseInt(attemptNumber, 10) || 1);
  const normalizedMessages = Array.isArray(messages)
    ? messages
      .map((message) => normalizeActivationMessage(message, { intervalMinutes: 30, maxTimes: 1 }))
      .filter(Boolean)
    : [];
  const message = normalizedMessages[normalizedMessageIndex];
  if (!message) return null;

  return {
    conversationKey,
    normalizedNodeId,
    generation,
    normalizedMessageIndex,
    normalizedAttemptNumber,
    normalizedMessages,
    message,
    allowStaleGeneration
  };
}

function advanceFlowActivationProgressInTransaction({
  conversationKey,
  normalizedNodeId,
  generation,
  normalizedMessageIndex,
  normalizedAttemptNumber,
  message,
  allowStaleGeneration
}) {
  const session = db.prepare(`
      SELECT current_node_id, activation_generation, activation_state_json
      FROM flow_sessions
      WHERE conversation_key = ?
  `).get(conversationKey);
  if (
    !session ||
    session.current_node_id !== normalizedNodeId ||
    (!allowStaleGeneration && Number(session.activation_generation || 0) !== Number(generation || 0))
  ) {
    return null;
  }

  const currentProgress = getActivationProgressFromState({
    nodeId: normalizedNodeId,
    state: parseJson(session.activation_state_json)
  });
  const progress = normalizedAttemptNumber >= message.maxTimes
    ? { nodeId: normalizedNodeId, messageIndex: normalizedMessageIndex + 1, sentCount: 0 }
    : { nodeId: normalizedNodeId, messageIndex: normalizedMessageIndex, sentCount: normalizedAttemptNumber };
  const expectedProgress = {
    nodeId: normalizedNodeId,
    messageIndex: normalizedMessageIndex,
    sentCount: normalizedAttemptNumber - 1
  };
  if (compareActivationProgress(currentProgress, progress) >= 0) {
    return currentProgress;
  }
  if (compareActivationProgress(currentProgress, expectedProgress) !== 0) {
    return currentProgress;
  }
  const updateResult = allowStaleGeneration
    ? db.prepare(`
          UPDATE flow_sessions
          SET activation_state_json = ?, updated_at = ?
          WHERE conversation_key = ?
            AND current_node_id = ?
        `).run(json(progress), now(), conversationKey, normalizedNodeId)
    : db.prepare(`
          UPDATE flow_sessions
          SET activation_state_json = ?, updated_at = ?
          WHERE conversation_key = ?
            AND current_node_id = ?
            AND COALESCE(activation_generation, 0) = ?
        `).run(json(progress), now(), conversationKey, normalizedNodeId, Number(generation || 0));
  if (updateResult.changes === 0) {
    return null;
  }
  return progress;
}

export function finalizeFlowActivationTaskDelivery({ id, worktoolMessageIds = [] }) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const task = markFlowActivationTaskSent({ id, worktoolMessageIds });
    if (!task) {
      db.exec("ROLLBACK");
      return null;
    }
    const progressInput = createActivationProgressInput({
      conversationKey: task.conversationKey,
      nodeId: task.nodeId,
      generation: task.generation,
      messageIndex: task.messageIndex,
      attemptNumber: task.attemptNumber,
      messages: task.messages
    });
    const progress = task.wasCanceled || !progressInput
      ? null
      : advanceFlowActivationProgressInTransaction(progressInput);
    db.exec("COMMIT");
    return { task, progress };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function getActivationProgressFromState({ nodeId, state }) {
  if (!state || state.nodeId !== nodeId) {
    return { nodeId, messageIndex: 0, sentCount: 0 };
  }
  return {
    nodeId,
    messageIndex: Math.max(0, Number.parseInt(state.messageIndex, 10) || 0),
    sentCount: Math.max(0, Number.parseInt(state.sentCount, 10) || 0)
  };
}

function compareActivationProgress(left, right) {
  if (left.messageIndex !== right.messageIndex) return left.messageIndex - right.messageIndex;
  return left.sentCount - right.sentCount;
}

export function listFlowActivationTasks({ conversationKey = "", limit = 100 } = {}) {
  const normalizedLimit = Math.max(1, Number.parseInt(limit, 10) || 100);
  const rows = conversationKey
    ? db.prepare(`
        SELECT *
        FROM flow_activation_tasks
        WHERE conversation_key = ?
        ORDER BY id ASC
        LIMIT ?
      `).all(conversationKey, normalizedLimit)
    : db.prepare(`
        SELECT *
        FROM flow_activation_tasks
        ORDER BY id ASC
        LIMIT ?
      `).all(normalizedLimit);
  return rows.map(rowToFlowActivationTask);
}

export function getAgentTagSchema(agentId) {
  return rowToAgentTagSchema(
    db.prepare("SELECT * FROM agent_tag_schemas WHERE agent_id = ?").get(agentId)
  );
}

export function upsertAgentTagSchema({ agentId, schema }) {
  const timestamp = now();
  const previous = normalizeTagSchema(getAgentTagSchema(agentId)?.config || {});
  const requested = normalizeTagSchema({
    ...(schema || {}),
    dateTag: {
      ...(schema?.dateTag || {}),
      effectiveAt: ""
    }
  });
  const normalized = {
    ...requested,
    dateTag: resolveDateTagRuleForSave({ previous, requested, timestamp })
  };
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO agent_tag_schemas (agent_id, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        config_json = excluded.config_json,
        updated_at = excluded.updated_at
    `).run(agentId, json(normalized), timestamp, timestamp);
    cancelObsoleteTagActivationTasksForSchema({ agentId, schema: normalized, timestamp });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getAgentTagSchema(agentId);
}

function resolveDateTagRuleForSave({ previous, requested, timestamp }) {
  const next = requested.dateTag;
  if (!next.enabled) {
    return {
      enabled: false,
      cutoffTime: next.cutoffTime,
      effectiveAt: ""
    };
  }
  const unchanged = previous.dateTag.enabled
    && previous.dateTag.cutoffTime === next.cutoffTime
    && previous.dateTag.effectiveAt;
  return {
    enabled: true,
    cutoffTime: next.cutoffTime,
    effectiveAt: unchanged ? previous.dateTag.effectiveAt : timestamp
  };
}

function syncConversationFirstSeenDateTag(conversation) {
  if (!conversation || !conversation.agentId) return null;
  return ensureConversationDateTag({
    botId: conversation.botId,
    agentId: conversation.agentId,
    conversationKey: conversation.conversationKey,
    firstSeenAt: conversation.createdAt,
    source: "conversation_first_seen"
  });
}

export function backfillEnabledConversationFirstSeenDateTags() {
  return initializeLegacyDateTagRuleEffectiveTimes();
}

export function initializeLegacyDateTagRuleEffectiveTimes() {
  const schemas = db.prepare(`
    SELECT agent_id, config_json
    FROM agent_tag_schemas
  `).all();
  let agentCount = 0;
  const timestamp = now();
  for (const row of schemas) {
    const rawSchema = parseJson(row.config_json) || {};
    const schema = normalizeTagSchema(rawSchema);
    if (!schema.dateTag.enabled || schema.dateTag.effectiveAt) continue;
    schema.dateTag.effectiveAt = timestamp;
    db.prepare(`
      UPDATE agent_tag_schemas
      SET config_json = ?,
          updated_at = ?
      WHERE agent_id = ?
    `).run(json(schema), timestamp, row.agent_id);
    agentCount += 1;
  }
  return agentCount;
}

function cancelObsoleteTagActivationTasksForSchema({ agentId, schema, timestamp = now() }) {
  const activeKeys = new Set();
  for (const group of schema.groups || []) {
    for (const tag of group.tags || []) {
      if (tag.activation?.enabled && tag.activation.messages?.length) {
        activeKeys.add(`${group.id}:${tag.id}`);
      }
    }
  }

  const tasks = db.prepare(`
    SELECT id, group_id, tag_id
    FROM tag_activation_tasks
    WHERE agent_id = ?
      AND status IN ('pending', 'processing')
  `).all(agentId);

  for (const task of tasks) {
    if (activeKeys.has(`${task.group_id}:${task.tag_id}`)) continue;
    db.prepare(`
      UPDATE tag_activation_tasks
      SET status = 'canceled',
          canceled_at = ?,
          cancel_reason = 'tag_schema_saved',
          updated_at = ?
      WHERE id = ?
        AND status IN ('pending', 'processing')
    `).run(timestamp, timestamp, task.id);
  }
}

export function listConversationTags({ botId, agentId, conversationKey }) {
  return db.prepare(`
    SELECT *
    FROM conversation_tags
    WHERE bot_id = ?
      AND agent_id = ?
      AND conversation_key = ?
    ORDER BY tag_type ASC, group_id ASC, tag_id ASC
  `).all(botId, agentId, conversationKey).map(rowToConversationTag);
}

export function applyConversationTagChanges({
  botId,
  agentId,
  conversationKey,
  accepted = [],
  rejected = [],
  nextTags = [],
  source = "agent_decision"
}) {
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      DELETE FROM conversation_tags
      WHERE bot_id = ?
        AND agent_id = ?
        AND conversation_key = ?
        AND tag_type = 'normal'
    `).run(botId, agentId, conversationKey);
    for (const tag of nextTags) {
      db.prepare(`
        INSERT INTO conversation_tags (
          bot_id, agent_id, conversation_key, group_id, group_name, tag_id, tag_name,
          tag_type, reason, source, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'normal', ?, ?, ?, ?)
      `).run(
        botId,
        agentId,
        conversationKey,
        tag.groupId || "",
        tag.groupName || "",
        tag.tagId,
        tag.tagName || tag.name || tag.tagId,
        tag.reason || "",
        source,
        timestamp,
        timestamp
      );
    }
    for (const event of [...accepted, ...rejected]) {
      db.prepare(`
        INSERT INTO conversation_tag_events (
          bot_id, agent_id, conversation_key, event_type, group_id, tag_id,
          accepted, reason, source, payload_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        botId,
        agentId,
        conversationKey,
        event.action || "tag_decision",
        event.groupId || "",
        event.tagId || "",
        accepted.includes(event) ? 1 : 0,
        event.reason || "",
        source,
        json(event),
        timestamp
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return listConversationTags({ botId, agentId, conversationKey });
}

function insertTagActivationTaskRecord({
  botId,
  agentId,
  conversationKey,
  groupId,
  tagId,
  activation,
  dueAt,
  attemptNumber = 1,
  messageIndex = 0,
  timestamp = now()
}) {
  const config = normalizeTagActivation(activation);
  const normalizedMessageIndex = Math.max(0, Number.parseInt(messageIndex, 10) || 0);
  const message = config.messages[normalizedMessageIndex] || null;
  if (!config.enabled || !message) return null;
  const result = db.prepare(`
    INSERT INTO tag_activation_tasks (
      bot_id, agent_id, conversation_key, group_id, tag_id, attempt_number,
      message_index, message_content, max_times, interval_minutes, polish_by_agent,
      messages_json, status, due_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(
    botId,
    agentId,
    conversationKey,
    groupId,
    tagId,
    Math.max(1, Number.parseInt(attemptNumber, 10) || 1),
    normalizedMessageIndex,
    message.content,
    message.maxTimes,
    message.intervalMinutes,
    config.polishByAgent ? 1 : 0,
    json(config.messages),
    dueAt || timestamp,
    timestamp,
    timestamp
  );
  return rowToTagActivationTask(
    db.prepare("SELECT * FROM tag_activation_tasks WHERE id = ?").get(result.lastInsertRowid)
  );
}

export function applyAgentTagOutcome({
  botId,
  agentId,
  conversationKey,
  accepted = [],
  rejected = [],
  nextTags = [],
  source = "agent_decision",
  activationCandidates = [],
  alertCandidates = []
}) {
  const timestamp = now();
  const acceptedEvents = [];
  const rejectedEvents = [];
  const scheduledTagActivationTasks = [];
  const alerts = [];
  const nextTagByKey = new Map(
    nextTags.map((tag) => [`${tag.groupId}:${tag.tagId}`, tag])
  );
  const activationByKey = new Map(
    activationCandidates.map((candidate) => [`${candidate.groupId}:${candidate.tagId}`, candidate])
  );
  const alertByKey = new Map(
    alertCandidates.map((candidate) => [`${candidate.groupId}:${candidate.tagId}`, candidate])
  );

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const change of accepted) {
      const cancelTagIds = new Set(change.oldTagIds || []);
      if (change.action === "remove") cancelTagIds.add(change.tagId);
      for (const tagId of cancelTagIds) {
        db.prepare(`
          UPDATE tag_activation_tasks
          SET status = 'canceled',
              canceled_at = ?,
              cancel_reason = ?,
              updated_at = ?
          WHERE bot_id = ?
            AND agent_id = ?
            AND conversation_key = ?
            AND group_id = ?
            AND tag_id = ?
            AND status IN ('pending', 'processing')
        `).run(
          timestamp,
          change.action === "remove" ? "tag_removed" : "tag_changed",
          timestamp,
          botId,
          agentId,
          conversationKey,
          change.groupId || "",
          tagId
        );
      }
    }

    db.prepare(`
      DELETE FROM conversation_tags
      WHERE bot_id = ?
        AND agent_id = ?
        AND conversation_key = ?
        AND tag_type = 'normal'
    `).run(botId, agentId, conversationKey);
    for (const tag of nextTags) {
      db.prepare(`
        INSERT INTO conversation_tags (
          bot_id, agent_id, conversation_key, group_id, group_name, tag_id, tag_name,
          tag_type, reason, source, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'normal', ?, ?, ?, ?)
      `).run(
        botId,
        agentId,
        conversationKey,
        tag.groupId || "",
        tag.groupName || "",
        tag.tagId,
        tag.tagName || tag.name || tag.tagId,
        tag.reason || "",
        source,
        timestamp,
        timestamp
      );
    }

    const insertEvent = (event, acceptedFlag) => {
      const result = db.prepare(`
        INSERT INTO conversation_tag_events (
          bot_id, agent_id, conversation_key, event_type, group_id, tag_id,
          accepted, reason, source, payload_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        botId,
        agentId,
        conversationKey,
        event.action || "tag_decision",
        event.groupId || "",
        event.tagId || "",
        acceptedFlag ? 1 : 0,
        event.reason || "",
        source,
        json(event),
        timestamp
      );
      return {
        id: Number(result.lastInsertRowid),
        ...event,
        accepted: acceptedFlag,
        source,
        createdAt: timestamp
      };
    };

    for (const event of accepted) {
      const storedEvent = insertEvent(event, true);
      acceptedEvents.push(storedEvent);
      if (!["add", "replace"].includes(event.action)) continue;
      const key = `${event.groupId}:${event.tagId}`;
      const activationCandidate = activationByKey.get(key);
      if (activationCandidate) {
        const task = insertTagActivationTaskRecord({
          botId,
          agentId,
          conversationKey,
          ...activationCandidate,
          timestamp
        });
        if (task) scheduledTagActivationTasks.push(task);
      }
      const alertCandidate = alertByKey.get(key);
      if (!alertCandidate) continue;
      const nextTag = nextTagByKey.get(key) || {};
      const evidenceMessageId = Number(alertCandidate.evidenceMessageId) || null;
      const evidenceMessage = evidenceMessageId
        ? db.prepare(`
            SELECT id
            FROM conversation_messages
            WHERE id = ? AND bot_id = ? AND conversation_key = ?
          `).get(evidenceMessageId, botId, conversationKey)
        : null;
      db.prepare(`
        INSERT OR IGNORE INTO tag_alert_events (
          source_tag_event_id, bot_id, agent_id, conversation_key, customer_name,
          group_id, group_name, tag_id, tag_name, reason, evidence_message_id,
          evidence_text, created_at, read_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        storedEvent.id,
        botId,
        agentId,
        conversationKey,
        alertCandidate.customerName || "",
        event.groupId || "",
        event.groupName || nextTag.groupName || "",
        event.tagId || "",
        event.tagName || nextTag.tagName || nextTag.name || event.tagId || "",
        event.reason || "",
        evidenceMessage?.id || null,
        alertCandidate.evidenceText || "",
        timestamp
      );
      const alert = db.prepare(`
        SELECT *
        FROM tag_alert_events
        WHERE source_tag_event_id = ?
      `).get(storedEvent.id);
      if (alert) alerts.push(rowToTagAlertEvent(alert));
    }
    for (const event of rejected) {
      rejectedEvents.push(insertEvent(event, false));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    tags: listConversationTags({ botId, agentId, conversationKey }),
    accepted,
    rejected,
    tagEvents: [...acceptedEvents, ...rejectedEvents],
    scheduledTagActivationTasks,
    alerts
  };
}

export function listUnreadTagAlerts({ botId }) {
  if (!botId) return [];
  return db.prepare(`
    SELECT *
    FROM tag_alert_events
    WHERE bot_id = ?
      AND read_at IS NULL
    ORDER BY id DESC
  `).all(botId).map(rowToTagAlertEvent);
}

export function markTagAlertRead({ botId, alertId }) {
  if (!botId || !alertId) return null;
  const timestamp = now();
  const result = db.prepare(`
    UPDATE tag_alert_events
    SET read_at = ?
    WHERE id = ?
      AND bot_id = ?
      AND read_at IS NULL
  `).run(timestamp, alertId, botId);
  if (!result.changes) return null;
  return rowToTagAlertEvent(
    db.prepare("SELECT * FROM tag_alert_events WHERE id = ? AND bot_id = ?").get(alertId, botId)
  );
}

export function upsertSystemDateTag({
  botId,
  agentId,
  conversationKey,
  dateTagId,
  source = "friend_added",
  reason = "新增好友日期"
}) {
  const existing = listConversationTags({ botId, agentId, conversationKey })
    .find((tag) => tag.tagType === "date");
  if (existing) {
    return listConversationTags({ botId, agentId, conversationKey });
  }
  const timestamp = now();
  db.prepare(`
    INSERT INTO conversation_tags (
      bot_id, agent_id, conversation_key, group_id, group_name, tag_id, tag_name,
      tag_type, reason, source, created_at, updated_at
    )
    VALUES (?, ?, ?, '', '', ?, ?, 'date', ?, ?, ?, ?)
    ON CONFLICT(bot_id, agent_id, conversation_key, tag_type, group_id, tag_id)
    DO NOTHING
  `).run(
    botId,
    agentId,
    conversationKey,
    dateTagId,
    dateTagId,
    reason,
    source,
    timestamp,
    timestamp
  );
  return listConversationTags({ botId, agentId, conversationKey });
}

export function ensureConversationDateTag({
  botId,
  agentId,
  conversationKey,
  firstSeenAt,
  source = "conversation_first_seen"
}) {
  const conversation = getConversation(conversationKey);
  if (
    !conversation
    || conversation.botId !== botId
    || conversation.agentId !== agentId
    || ![2, 4].includes(Number(conversation.roomType))
  ) {
    return null;
  }
  const schema = normalizeTagSchema(getAgentTagSchema(agentId)?.config || {});
  if (!schema.dateTag.enabled || !schema.dateTag.effectiveAt) return null;
  const firstSeenDate = new Date(firstSeenAt);
  const effectiveDate = new Date(schema.dateTag.effectiveAt);
  if (
    Number.isNaN(firstSeenDate.getTime())
    || Number.isNaN(effectiveDate.getTime())
    || firstSeenDate.getTime() < effectiveDate.getTime()
  ) {
    return null;
  }
  const existing = listConversationTags({ botId, agentId, conversationKey })
    .find((tag) => tag.tagType === "date");
  if (existing) {
    return listConversationTags({ botId, agentId, conversationKey });
  }
  return upsertSystemDateTag({
    botId,
    agentId,
    conversationKey,
    dateTagId: dateTagIdFor(firstSeenDate, schema.dateTag.cutoffTime),
    source
  });
}

export function ensureManagedGroupConversationDateTag({
  botId,
  agentId,
  conversationKey,
  groupCreatedAt
}) {
  const conversation = getConversation(conversationKey);
  const group = getGroupByConversationKey({ botId, conversationKey });
  if (
    !conversation
    || conversation.botId !== botId
    || conversation.agentId !== agentId
    || ![1, 3].includes(Number(conversation.roomType))
    || !group
    || !group.tagGroupIds.includes(SYSTEM_DATE_TAG_GROUP_ID)
  ) {
    return null;
  }
  const schema = normalizeTagSchema(getAgentTagSchema(agentId)?.config || {});
  if (!schema.dateTag.enabled) return null;
  const normalizedCreatedAt = normalizeManagedGroupCreatedAt(
    groupCreatedAt || group.groupCreatedAt
  );
  if (!normalizedCreatedAt) return null;
  const createdAt = new Date(normalizedCreatedAt);
  const expectedDateTagId = dateTagIdFor(createdAt, schema.dateTag.cutoffTime);
  const existing = listConversationTags({ botId, agentId, conversationKey })
    .find((tag) => tag.tagType === "date");
  if (existing) {
    if (
      existing.source === "managed_group_created"
      && existing.tagId !== expectedDateTagId
    ) {
      const timestamp = now();
      db.prepare(`
        UPDATE conversation_tags
        SET tag_id = ?,
            tag_name = ?,
            reason = '群建立日期',
            updated_at = ?
        WHERE id = ?
      `).run(expectedDateTagId, expectedDateTagId, timestamp, existing.id);
    }
    return listConversationTags({ botId, agentId, conversationKey });
  }
  return upsertSystemDateTag({
    botId,
    agentId,
    conversationKey,
    dateTagId: expectedDateTagId,
    source: "managed_group_created",
    reason: "群建立日期"
  });
}

export function backfillManagedGroupConversationDateTags() {
  const rows = db.prepare(`
    SELECT
      mg.bot_id,
      bab.agent_id,
      mg.conversation_key,
      mg.group_created_at
    FROM managed_groups mg
    JOIN conversations c
      ON c.bot_id = mg.bot_id
     AND c.conversation_key = mg.conversation_key
    JOIN bot_agent_bindings bab
      ON bab.bot_id = mg.bot_id
    WHERE c.room_type IN (1, 3)
  `).all();
  let appliedCount = 0;
  for (const row of rows) {
    const hadDateTag = listConversationTags({
      botId: row.bot_id,
      agentId: row.agent_id,
      conversationKey: row.conversation_key
    }).some((tag) => tag.tagType === "date");
    const tags = ensureManagedGroupConversationDateTag({
      botId: row.bot_id,
      agentId: row.agent_id,
      conversationKey: row.conversation_key,
      groupCreatedAt: row.group_created_at
    });
    if (!hadDateTag && tags?.some((tag) => tag.tagType === "date")) {
      appliedCount += 1;
    }
  }
  return appliedCount;
}

export function ensureLegacyHistoryDateTag({
  botId,
  agentId,
  conversationKey,
  firstSeenAt
}) {
  const conversation = getConversation(conversationKey);
  if (
    !conversation
    || conversation.botId !== botId
    || conversation.agentId !== agentId
    || ![2, 4].includes(Number(conversation.roomType))
  ) {
    return null;
  }
  const schema = normalizeTagSchema(getAgentTagSchema(agentId)?.config || {});
  if (!schema.dateTag.enabled) return null;
  const firstSeenDate = new Date(firstSeenAt);
  if (Number.isNaN(firstSeenDate.getTime())) return null;
  return upsertSystemDateTag({
    botId,
    agentId,
    conversationKey,
    dateTagId: dateTagIdFor(firstSeenDate, schema.dateTag.cutoffTime),
    source: "legacy_history"
  });
}

export function scheduleTagActivationTask({
  botId,
  agentId,
  conversationKey,
  groupId,
  tagId,
  activation,
  dueAt,
  attemptNumber = 1,
  messageIndex = 0
}) {
  return insertTagActivationTaskRecord({
    botId,
    agentId,
    conversationKey,
    groupId,
    tagId,
    activation,
    dueAt,
    attemptNumber,
    messageIndex
  });
}

export function claimDueTagActivationTasks({ limit = 20, nowIso = now(), staleBeforeIso = "" } = {}) {
  const timestamp = now();
  if (staleBeforeIso) {
    db.prepare(`
      UPDATE tag_activation_tasks
      SET status = 'pending',
          processing_started_at = NULL,
          updated_at = ?
      WHERE status = 'processing'
        AND processing_started_at < ?
    `).run(timestamp, staleBeforeIso);
  }

  const rows = db.prepare(`
    SELECT *
    FROM tag_activation_tasks
    WHERE status = 'pending'
      AND due_at <= ?
    ORDER BY due_at ASC, id ASC
    LIMIT ?
  `).all(nowIso, Math.max(1, Number.parseInt(limit, 10) || 20));

  const claimed = [];
  for (const row of rows) {
    const result = db.prepare(`
      UPDATE tag_activation_tasks
      SET status = 'processing',
          processing_started_at = ?,
          updated_at = ?
      WHERE id = ?
        AND status = 'pending'
    `).run(timestamp, timestamp, row.id);
    if (result.changes > 0) {
      claimed.push(rowToTagActivationTask(
        db.prepare("SELECT * FROM tag_activation_tasks WHERE id = ?").get(row.id)
      ));
    }
  }
  return claimed;
}

export function cancelTagActivationTasks({ botId, agentId, conversationKey, groupId = "", tagId = "", reason = "" }) {
  const timestamp = now();
  const clauses = ["bot_id = ?", "agent_id = ?", "conversation_key = ?", "status IN ('pending', 'processing')"];
  const params = [botId, agentId, conversationKey];
  if (groupId) {
    clauses.push("group_id = ?");
    params.push(groupId);
  }
  if (tagId) {
    clauses.push("tag_id = ?");
    params.push(tagId);
  }
  return db.prepare(`
    UPDATE tag_activation_tasks
    SET status = 'canceled',
        canceled_at = ?,
        cancel_reason = ?,
        updated_at = ?
    WHERE ${clauses.join(" AND ")}
  `).run(timestamp, reason || "", timestamp, ...params).changes;
}

export function markTagActivationTaskSent({ id, worktoolMessageIds = [] }) {
  const timestamp = now();
  const result = db.prepare(`
    UPDATE tag_activation_tasks
    SET status = 'sent',
        sent_at = ?,
        error_message = '',
        worktool_message_ids_json = ?,
        updated_at = ?
    WHERE id = ?
      AND status IN ('processing', 'sending')
  `).run(timestamp, json(worktoolMessageIds), timestamp, id);
  if (result.changes === 0) return null;
  return rowToTagActivationTask(
    db.prepare("SELECT * FROM tag_activation_tasks WHERE id = ?").get(id)
  );
}

export function markTagActivationTaskFailed({ id, error = "" }) {
  const timestamp = now();
  const result = db.prepare(`
    UPDATE tag_activation_tasks
    SET status = 'failed',
        error_message = ?,
        updated_at = ?
    WHERE id = ?
      AND status IN ('processing', 'sending')
  `).run(String(error || ""), timestamp, id);
  if (result.changes === 0) return null;
  return rowToTagActivationTask(
    db.prepare("SELECT * FROM tag_activation_tasks WHERE id = ?").get(id)
  );
}

export function reserveTagActivationTaskForSend({ id }) {
  const timestamp = now();
  const result = db.prepare(`
    UPDATE tag_activation_tasks
    SET status = 'sending',
        updated_at = ?
    WHERE id = ?
      AND status = 'processing'
      AND EXISTS (
        SELECT 1
        FROM conversation_tags
        WHERE conversation_tags.bot_id = tag_activation_tasks.bot_id
          AND conversation_tags.agent_id = tag_activation_tasks.agent_id
          AND conversation_tags.conversation_key = tag_activation_tasks.conversation_key
          AND conversation_tags.group_id = tag_activation_tasks.group_id
          AND conversation_tags.tag_id = tag_activation_tasks.tag_id
      )
  `).run(timestamp, id);
  if (result.changes > 0) {
    return {
      task: rowToTagActivationTask(
        db.prepare("SELECT * FROM tag_activation_tasks WHERE id = ?").get(id)
      ),
      skippedReason: ""
    };
  }

  const row = db.prepare("SELECT * FROM tag_activation_tasks WHERE id = ?").get(id);
  if (!row) return { task: null, skippedReason: "missing_tag_activation_task" };
  if (row.status !== "processing") {
    return { task: null, skippedReason: row.status || "stale_tag_activation_task" };
  }
  return { task: null, skippedReason: "stale_tag_activation_task" };
}

export function listTagActivationTasks({ botId = "", agentId = "", conversationKey = "", limit = 100 } = {}) {
  if (!botId || !agentId || !conversationKey) {
    throw new Error("listTagActivationTasks requires botId, agentId, and conversationKey");
  }
  const normalizedLimit = Math.max(1, Number.parseInt(limit, 10) || 100);
  const rows = db.prepare(`
    SELECT *
    FROM tag_activation_tasks
    WHERE bot_id = ?
      AND agent_id = ?
      AND conversation_key = ?
    ORDER BY id ASC
    LIMIT ?
  `).all(botId, agentId, conversationKey, normalizedLimit);
  return rows.map(rowToTagActivationTask);
}

export function insertConversationMessage({
  botId,
  conversationKey,
  direction,
  senderName,
  content,
  rawPayload
}) {
  const result = db.prepare(`
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
  return rowToConversationMessage(
    db.prepare("SELECT * FROM conversation_messages WHERE id = ?").get(result.lastInsertRowid)
  );
}

export function insertImportedConversationMessages({
  botId,
  conversationKey,
  source,
  messages = []
}) {
  if (!["worktool_customer_history", "worktool_api_history"].includes(source)) {
    throw new Error("invalid imported conversation message source");
  }
  const insert = db.prepare(`
    INSERT OR IGNORE INTO conversation_messages (
      bot_id, conversation_key, direction, sender_name, content,
      raw_payload_json, source, source_key, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const duplicateCandidates = db.prepare(`
    SELECT *
    FROM conversation_messages
    WHERE bot_id = ?
      AND conversation_key = ?
      AND direction = ?
      AND created_at BETWEEN ? AND ?
    ORDER BY created_at ASC, id ASC
  `);
  let inserted = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const message of messages) {
      const sourceKey = String(message?.sourceKey || "").trim();
      const content = String(message?.content || "").trim();
      const createdAt = String(message?.createdAt || "").trim();
      if (!sourceKey || !content || !createdAt) continue;
      const direction = message.direction === "outbound" ? "outbound" : "inbound";
      const importedCandidate = {
        botId,
        conversationKey,
        direction,
        content,
        source,
        sourceKey,
        createdAt
      };
      const createdTime = Date.parse(createdAt);
      if (Number.isFinite(createdTime)) {
        const candidates = duplicateCandidates.all(
          botId,
          conversationKey,
          direction,
          new Date(createdTime - 10_000).toISOString(),
          new Date(createdTime + 10_000).toISOString()
        ).map(rowToConversationMessage);
        const matching = candidates.filter(
          (candidate) => areConversationMessagesDuplicates(candidate, importedCandidate)
        );
        if (
          matching.length
          && !dedupeConversationMessages([...matching, importedCandidate])
            .includes(importedCandidate)
        ) {
          continue;
        }
      }
      inserted += Number(insert.run(
        botId,
        conversationKey,
        direction,
        message.senderName || "",
        content,
        json(message.rawPayload || {}),
        source,
        sourceKey,
        createdAt
      ).changes || 0);
    }
    if (inserted > 0 && source === "worktool_customer_history") {
      db.prepare(`
        UPDATE flow_sessions
        SET history_context_sent_at = NULL, updated_at = ?
        WHERE bot_id = ? AND conversation_key = ?
      `).run(now(), botId, conversationKey);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return inserted;
}

export function listImportedConversationMessages({ botId, conversationKey }) {
  return db.prepare(`
    SELECT *
    FROM conversation_messages
    WHERE bot_id = ?
      AND conversation_key = ?
      AND source IN ('worktool_customer_history', 'worktool_api_history')
    ORDER BY created_at ASC, id ASC
  `).all(botId, conversationKey).map(rowToConversationMessage);
}

export function upsertWorktoolApiMessageCache({ botId, items = [] }) {
  const insert = db.prepare(`
    INSERT INTO worktool_api_message_cache (
      bot_id, message_id, command_index, target_name, message_type,
      content, occurred_at, raw_payload_json, cached_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bot_id, message_id, command_index, target_name) DO UPDATE SET
      message_type = excluded.message_type,
      content = excluded.content,
      occurred_at = excluded.occurred_at,
      raw_payload_json = excluded.raw_payload_json,
      cached_at = excluded.cached_at
  `);
  let changed = 0;
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const item of items) {
      changed += Number(insert.run(
        botId,
        String(item.messageId || ""),
        Number(item.commandIndex || 0),
        String(item.targetName || ""),
        Number(item.type || 0),
        String(item.content || ""),
        String(item.createdAt || ""),
        json(item.rawPayload || {}),
        timestamp
      ).changes || 0);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return changed;
}

export function hasCachedWorktoolMessageId({ botId, messageId }) {
  return Boolean(db.prepare(`
    SELECT 1 FROM worktool_api_message_cache
    WHERE bot_id = ? AND message_id = ?
    LIMIT 1
  `).get(botId, messageId));
}

export function listCachedApiMessages({ botId, targetNames = [] }) {
  const names = [...new Set(targetNames.map((name) => String(name || "").trim()).filter(Boolean))];
  if (!names.length) return [];
  const placeholders = names.map(() => "?").join(", ");
  return db.prepare(`
    SELECT * FROM worktool_api_message_cache
    WHERE bot_id = ? AND target_name IN (${placeholders})
    ORDER BY occurred_at ASC, id ASC
  `).all(botId, ...names).map((row) => ({
    id: row.id,
    botId: row.bot_id,
    messageId: row.message_id,
    commandIndex: Number(row.command_index || 0),
    targetName: row.target_name,
    type: Number(row.message_type || 0),
    direction: "outbound",
    content: row.content,
    createdAt: row.occurred_at,
    rawPayload: parseJson(row.raw_payload_json)
  }));
}

export function listLegacyFlowSessionTargets({ botId }) {
  return db.prepare(`
    SELECT fs.conversation_key, c.received_name
    FROM flow_sessions fs
    JOIN conversations c ON c.conversation_key = fs.conversation_key
    WHERE fs.bot_id = ?
      AND fs.customer_origin = 'legacy'
      AND fs.conversation_key LIKE '%:private:%'
    ORDER BY fs.id ASC
  `).all(botId).map((row) => ({
    conversationKey: row.conversation_key,
    receivedName: row.received_name || ""
  }));
}

function messageTimestamp(message) {
  const value = Date.parse(message?.createdAt || message?.created_at || "");
  return Number.isFinite(value) ? value : null;
}

function fetchConversationMessagesBefore({
  botId = "",
  conversationKey,
  cursor = null,
  limit
}) {
  const botClause = botId ? "AND bot_id = ?" : "";
  const cursorClause = cursor
    ? `AND (
        created_at < ?
        OR (created_at = ? AND id < ?)
      )`
    : "";
  const params = [conversationKey];
  if (botId) params.push(botId);
  if (cursor) params.push(cursor.created_at, cursor.created_at, cursor.id);
  params.push(limit);
  return db.prepare(`
    SELECT *
    FROM conversation_messages
    WHERE conversation_key = ?
      ${botClause}
      ${cursorClause}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(...params);
}

function fetchConversationMessagesAfter({
  botId,
  conversationKey,
  cursor,
  limit
}) {
  return db.prepare(`
    SELECT *
    FROM conversation_messages
    WHERE bot_id = ?
      AND conversation_key = ?
      AND (
        created_at > ?
        OR (created_at = ? AND id > ?)
      )
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  `).all(
    botId,
    conversationKey,
    cursor.created_at,
    cursor.created_at,
    cursor.id,
    limit
  );
}

export function listConversationMessages({ botId = "", conversationKey, limit = 200 }) {
  const visibleLimit = Math.max(1, Number.parseInt(limit, 10) || 200);
  const batchSize = Math.min(1200, Math.max(4, visibleLimit * 4));
  const rawRows = [];
  let cursor = null;
  while (true) {
    const batch = fetchConversationMessagesBefore({
      botId,
      conversationKey,
      cursor,
      limit: batchSize
    });
    rawRows.push(...batch);
    const noMoreRows = batch.length < batchSize;
    const visible = dedupeConversationMessages(rawRows.map(rowToConversationMessage))
      .slice(-visibleLimit);
    if (noMoreRows) return visible;

    cursor = batch.at(-1);
    if (visible.length < visibleLimit) continue;
    const oldestVisibleTime = messageTimestamp(visible[0]);
    const oldestFetchedTime = messageTimestamp(cursor);
    if (
      oldestVisibleTime === null
      || (
        oldestFetchedTime !== null
        && oldestFetchedTime < oldestVisibleTime - 10_000
      )
    ) {
      return visible;
    }
  }
}

function normalizedEvidenceText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function resolveConversationMessageEvidence({
  botId,
  conversationKey,
  evidenceMessageId = "",
  evidenceText = "",
  candidateMessageIds = []
}) {
  const candidateIds = [...new Set(
    (Array.isArray(candidateMessageIds) ? candidateMessageIds : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
  )];
  if (!botId || !conversationKey || !candidateIds.length) return null;
  const placeholders = candidateIds.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT *
    FROM conversation_messages
    WHERE bot_id = ?
      AND conversation_key = ?
      AND direction = 'inbound'
      AND id IN (${placeholders})
  `).all(botId, conversationKey, ...candidateIds).map(rowToConversationMessage);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const orderedCandidates = candidateIds.map((id) => byId.get(id)).filter(Boolean);
  if (!orderedCandidates.length) return null;

  const evidenceId = String(evidenceMessageId || "").trim();
  if (evidenceId) {
    const direct = orderedCandidates.find((message) => (
      String(message.id) === evidenceId
      || String(message.sourceKey || "") === evidenceId
      || String(message.rawPayload?.messageId || "") === evidenceId
    ));
    if (direct) return direct;
  }

  const normalizedText = normalizedEvidenceText(evidenceText);
  if (normalizedText) {
    const textMatch = orderedCandidates.find(
      (message) => normalizedEvidenceText(message.content) === normalizedText
    );
    if (textMatch) return textMatch;
  }
  return orderedCandidates.at(-1) || null;
}

export function listConversationMessagesAround({
  botId,
  conversationKey,
  anchorMessageId,
  before = 60,
  after = 60
}) {
  const anchor = db.prepare(`
    SELECT *
    FROM conversation_messages
    WHERE id = ?
      AND bot_id = ?
      AND conversation_key = ?
  `).get(anchorMessageId, botId, conversationKey);
  if (!anchor) return [];
  const beforeLimit = Math.max(0, Math.min(200, Number.parseInt(before, 10) || 0));
  const afterLimit = Math.max(0, Math.min(200, Number.parseInt(after, 10) || 0));
  if (beforeLimit === 0 && afterLimit === 0) {
    return [rowToConversationMessage(anchor)];
  }

  const beforeBatchSize = Math.min(800, Math.max(4, beforeLimit * 4));
  const afterBatchSize = Math.min(800, Math.max(4, afterLimit * 4));
  const rawRows = [anchor];
  let olderCursor = anchor;
  let newerCursor = anchor;
  let olderDone = false;
  let newerDone = false;

  while (true) {
    const visible = dedupeConversationMessages(
      rawRows.map(rowToConversationMessage),
      { preferredMessageId: anchor.id }
    );
    const anchorIndex = visible.findIndex((message) => message.id === anchor.id);
    if (anchorIndex < 0) return [];
    const start = Math.max(0, anchorIndex - beforeLimit);
    const end = anchorIndex + afterLimit + 1;
    const selected = visible.slice(start, end);
    const selectedTimes = selected
      .filter((message) => message.id !== anchor.id)
      .map(messageTimestamp)
      .filter((value) => value !== null);
    const lowerTarget = selectedTimes.length
      ? Math.min(...selectedTimes) - 10_000
      : null;
    const upperTarget = selectedTimes.length
      ? Math.max(...selectedTimes) + 10_000
      : null;
    const oldestFetchedTime = messageTimestamp(olderCursor);
    const newestFetchedTime = messageTimestamp(newerCursor);
    const needsOlderRows = !olderDone && (
      anchorIndex < beforeLimit
      || (
        lowerTarget !== null
        && (
          oldestFetchedTime === null
          || oldestFetchedTime >= lowerTarget
        )
      )
    );
    const needsNewerRows = !newerDone && (
      visible.length - anchorIndex - 1 < afterLimit
      || (
        upperTarget !== null
        && (
          newestFetchedTime === null
          || newestFetchedTime <= upperTarget
        )
      )
    );
    if (!needsOlderRows && !needsNewerRows) return selected;

    if (needsOlderRows) {
      const older = fetchConversationMessagesBefore({
        botId,
        conversationKey,
        cursor: olderCursor,
        limit: beforeBatchSize
      });
      rawRows.push(...older);
      olderDone = older.length < beforeBatchSize;
      if (older.length) olderCursor = older.at(-1);
    }
    if (needsNewerRows) {
      const newer = fetchConversationMessagesAfter({
        botId,
        conversationKey,
        cursor: newerCursor,
        limit: afterBatchSize
      });
      rawRows.push(...newer);
      newerDone = newer.length < afterBatchSize;
      if (newer.length) newerCursor = newer.at(-1);
    }
  }
}

export function listFlowStateEvents({ botId = "", conversationKey, limit = 100 }) {
  const where = botId ? "conversation_key = ? AND bot_id = ?" : "conversation_key = ?";
  const params = botId ? [conversationKey, botId, Number(limit)] : [conversationKey, Number(limit)];
  return db
    .prepare(`
      SELECT *
      FROM flow_state_events
      WHERE ${where}
      ORDER BY id ASC
      LIMIT ?
    `)
    .all(...params)
    .map(rowToFlowStateEvent);
}

export function clearConversationForReset({ botId, conversationKey, reason = "控制台清空会话" }) {
  const timestamp = now();
  const conversation = getConversation(conversationKey);
  if (!conversation || conversation.botId !== botId) throw new Error("flow session not found");
  let resetTaskId = null;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE conversation_reset_tasks
      SET status = 'canceled',
          canceled_at = ?,
          cancel_reason = 'superseded_by_new_reset',
          updated_at = ?
      WHERE bot_id = ?
        AND conversation_key = ?
        AND status IN ('pending', 'processing')
    `).run(timestamp, timestamp, botId, conversationKey);
    const resetTask = db.prepare(`
      INSERT INTO conversation_reset_tasks (
        bot_id, agent_id, conversation_key, conversation_epoch,
        status, attempts, max_attempts,
        due_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, 'pending', 0, 3, ?, ?, ?)
    `).run(
      botId,
      conversation.agentId,
      conversationKey,
      conversation.conversationEpoch,
      timestamp,
      timestamp,
      timestamp
    );
    resetTaskId = resetTask.lastInsertRowid;
    db.prepare("DELETE FROM conversation_messages WHERE conversation_key = ? AND bot_id = ?")
      .run(conversationKey, botId);
    db.prepare("DELETE FROM flow_state_events WHERE conversation_key = ? AND bot_id = ?")
      .run(conversationKey, botId);
    db.prepare("DELETE FROM conversation_tags WHERE conversation_key = ? AND bot_id = ?")
      .run(conversationKey, botId);
    db.prepare(`
      UPDATE flow_activation_tasks
      SET status = 'canceled',
          canceled_at = ?,
          cancel_reason = ?,
          updated_at = ?
      WHERE conversation_key = ?
        AND bot_id = ?
        AND status IN ('pending', 'processing')
    `).run(timestamp, reason, timestamp, conversationKey, botId);
    db.prepare(`
      UPDATE tag_activation_tasks
      SET status = 'canceled',
          canceled_at = ?,
          cancel_reason = ?,
          updated_at = ?
      WHERE conversation_key = ?
        AND bot_id = ?
        AND status IN ('pending', 'processing')
    `).run(timestamp, reason, timestamp, conversationKey, botId);
    db.prepare("DELETE FROM flow_sessions WHERE conversation_key = ? AND bot_id = ?")
      .run(conversationKey, botId);
    db.prepare("DELETE FROM conversations WHERE conversation_key = ? AND bot_id = ?")
      .run(conversationKey, botId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    botId,
    conversationKey,
    deleted: true,
    reason,
    resetTask: rowToConversationResetTask(
      db.prepare("SELECT * FROM conversation_reset_tasks WHERE id = ?").get(resetTaskId)
    )
  };
}

export function listConversationResetTasks({
  botId = "",
  conversationKey = "",
  limit = 100
} = {}) {
  const clauses = [];
  const params = [];
  if (botId) {
    clauses.push("bot_id = ?");
    params.push(botId);
  }
  if (conversationKey) {
    clauses.push("conversation_key = ?");
    params.push(conversationKey);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`
    SELECT *
    FROM conversation_reset_tasks
    ${where}
    ORDER BY id ASC
    LIMIT ?
  `).all(...params, Math.max(1, Number(limit) || 100)).map(rowToConversationResetTask);
}

export function claimNextConversationResetTask({
  nowIso = now(),
  staleBeforeIso = ""
} = {}) {
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (staleBeforeIso) {
      db.prepare(`
        UPDATE conversation_reset_tasks
        SET status = 'pending',
            processing_started_at = NULL,
            due_at = ?,
            updated_at = ?
        WHERE status = 'processing'
          AND processing_started_at < ?
      `).run(timestamp, timestamp, staleBeforeIso);
    }
    const row = db.prepare(`
      SELECT *
      FROM conversation_reset_tasks
      WHERE status = 'pending'
        AND due_at <= ?
      ORDER BY due_at ASC, id ASC
      LIMIT 1
    `).get(nowIso);
    if (!row) {
      db.exec("COMMIT");
      return null;
    }
    const claimed = db.prepare(`
      UPDATE conversation_reset_tasks
      SET status = 'processing',
          attempts = attempts + 1,
          processing_started_at = ?,
          updated_at = ?
      WHERE id = ?
        AND status = 'pending'
    `).run(timestamp, timestamp, row.id);
    db.exec("COMMIT");
    if (!claimed.changes) return null;
    return rowToConversationResetTask(
      db.prepare("SELECT * FROM conversation_reset_tasks WHERE id = ?").get(row.id)
    );
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function completeConversationResetTask({ id }) {
  const timestamp = now();
  const result = db.prepare(`
    UPDATE conversation_reset_tasks
    SET status = 'succeeded',
        completed_at = ?,
        processing_started_at = NULL,
        error_message = '',
        updated_at = ?
    WHERE id = ?
      AND status = 'processing'
  `).run(timestamp, timestamp, id);
  if (!result.changes) return null;
  return rowToConversationResetTask(
    db.prepare("SELECT * FROM conversation_reset_tasks WHERE id = ?").get(id)
  );
}

export function failConversationResetTask({
  id,
  error = "",
  retryDelayMs = 5000
}) {
  const row = db.prepare("SELECT * FROM conversation_reset_tasks WHERE id = ?").get(id);
  if (!row || row.status !== "processing") return null;
  const timestamp = now();
  const retry = Number(row.attempts || 0) < Number(row.max_attempts || 3);
  const dueAt = new Date(Date.now() + Math.max(0, Number(retryDelayMs) || 0)).toISOString();
  db.prepare(`
    UPDATE conversation_reset_tasks
    SET status = ?,
        due_at = ?,
        processing_started_at = NULL,
        error_message = ?,
        updated_at = ?
    WHERE id = ?
      AND status = 'processing'
  `).run(
    retry ? "pending" : "failed",
    retry ? dueAt : row.due_at,
    String(error || "").slice(0, 1000),
    timestamp,
    id
  );
  return rowToConversationResetTask(
    db.prepare("SELECT * FROM conversation_reset_tasks WHERE id = ?").get(id)
  );
}

export function prepareConversationResetForNewActivity({ botId, conversationKey }) {
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const latest = db.prepare(`
      SELECT *
      FROM conversation_reset_tasks
      WHERE bot_id = ?
        AND conversation_key = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(botId, conversationKey);
    const resetPending = Boolean(latest && latest.status !== "succeeded");
    db.prepare(`
      UPDATE conversation_reset_tasks
      SET status = 'canceled',
          canceled_at = ?,
          cancel_reason = 'new_customer_activity',
          updated_at = ?
      WHERE bot_id = ?
        AND conversation_key = ?
        AND status IN ('pending', 'processing', 'failed')
    `).run(timestamp, timestamp, botId, conversationKey);
    db.exec("COMMIT");
    return { resetPending };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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

function normalizeProactiveTagFilters(tagFilters = []) {
  const seen = new Set();
  return (Array.isArray(tagFilters) ? tagFilters : [])
    .map((tag) => ({
      tagType: tag?.tagType === "date" ? "date" : "normal",
      groupId: String(tag?.groupId || "").trim(),
      tagId: String(tag?.tagId || "").trim()
    }))
    .filter((tag) => tag.tagId)
    .filter((tag) => {
      const key = `${tag.tagType}:${tag.groupId}:${tag.tagId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function listProactiveTargetTags({ botId = "" } = {}) {
  syncProactiveTargetsFromIncoming(botId);
  const filters = [
    "pt.enabled = 1",
    "pt.target_type = 'private'",
    "bab.enabled = 1"
  ];
  const values = [];
  if (botId) {
    filters.push("pt.bot_id = ?");
    values.push(botId);
  }
  const rows = db.prepare(`
    SELECT DISTINCT
      pt.bot_id,
      ct.tag_type,
      ct.group_id,
      ct.group_name,
      ct.tag_id,
      ct.tag_name
    FROM proactive_targets pt
    JOIN bot_agent_bindings bab ON bab.bot_id = pt.bot_id
    JOIN conversation_tags ct
      ON ct.bot_id = pt.bot_id
     AND ct.agent_id = bab.agent_id
     AND ct.conversation_key = pt.bot_id || ':private:' || pt.target_name
    WHERE ${filters.join(" AND ")}
    ORDER BY CASE WHEN ct.tag_type = 'date' THEN 0 ELSE 1 END,
             ct.group_name ASC,
             ct.tag_name ASC,
             ct.tag_id ASC
  `).all(...values);
  const binding = botId ? getBotBinding(botId) : null;
  const schemaRecord = binding ? getAgentTagSchema(binding.agentId) : null;
  const schema = schemaRecord ? normalizeTagSchema(schemaRecord.config || {}) : null;
  const currentNormalTags = new Map();
  for (const group of schema?.groups || []) {
    for (const tag of group.tags || []) {
      currentNormalTags.set(`${group.id}:${tag.id}`, {
        groupName: group.name,
        tagName: tag.name
      });
    }
  }
  const filterNormalTagsBySchema = Boolean(schemaRecord);

  return rows
    .filter((row) => (
      row.tag_type === "date"
      || !filterNormalTagsBySchema
      || currentNormalTags.has(`${row.group_id || ""}:${row.tag_id}`)
    ))
    .map((row) => {
      const currentTag = currentNormalTags.get(`${row.group_id || ""}:${row.tag_id}`);
      return {
        botId: row.bot_id,
        tagType: row.tag_type,
        groupId: row.group_id || "",
        groupName: currentTag?.groupName || row.group_name || "",
        tagId: row.tag_id,
        tagName: currentTag?.tagName || row.tag_name || row.tag_id
      };
    });
}

export function listProactiveAddressBookTargets({ botId, targetType, query, limit = 200 }) {
  syncProactiveTargetsFromIncoming(botId);

  const { where, values } = proactiveAddressBookTargetsWhere({ botId, targetType, query });

  return db
    .prepare(`
      SELECT *
      FROM proactive_targets
      ${where}
      ORDER BY target_type ASC, COALESCE(last_seen_at, updated_at) DESC, target_name ASC
      LIMIT ?
    `)
    .all(...values, Number(limit))
    .map(rowToProactiveAddressBookTarget);
}

function proactiveAddressBookTargetsWhere({ botId = "", targetType = "", query = "", tagFilters = [] } = {}) {
  const filters = ["enabled = 1"];
  const values = [];
  if (botId) {
    filters.push("bot_id = ?");
    values.push(botId);
  }
  if (targetType === "private" || targetType === "group") {
    filters.push("target_type = ?");
    values.push(targetType);
  }
  if (query) {
    filters.push("(target_name LIKE ? OR display_name LIKE ?)");
    values.push(`%${query}%`, `%${query}%`);
  }
  const normalizedTagFilters = normalizeProactiveTagFilters(tagFilters);
  if (normalizedTagFilters.length) {
    const clauses = normalizedTagFilters.map(() => "(ct.tag_type = ? AND ct.group_id = ? AND ct.tag_id = ?)");
    filters.push(`
      target_type = 'private'
      AND EXISTS (
        SELECT 1
        FROM bot_agent_bindings bab
        JOIN conversation_tags ct
          ON ct.bot_id = proactive_targets.bot_id
         AND ct.agent_id = bab.agent_id
         AND ct.conversation_key = proactive_targets.bot_id || ':private:' || proactive_targets.target_name
        WHERE bab.bot_id = proactive_targets.bot_id
          AND bab.enabled = 1
          AND (${clauses.join(" OR ")})
      )
    `);
    for (const tag of normalizedTagFilters) {
      values.push(tag.tagType, tag.groupId, tag.tagId);
    }
  }
  return {
    where: `WHERE ${filters.join(" AND ")}`,
    values
  };
}

export function listProactiveAddressBookTargetsPage({
  botId = "",
  targetType = "",
  query = "",
  tagFilters = [],
  page = 1,
  pageSize = 20
} = {}) {
  syncProactiveTargetsFromIncoming(botId);

  const normalizedPageSize = normalizePageSize(pageSize, 20, 100);
  const requestedPage = normalizePage(page);
  const { where, values } = proactiveAddressBookTargetsWhere({ botId, targetType, query, tagFilters });
  const total = db.prepare(`SELECT COUNT(*) AS total FROM proactive_targets ${where}`).get(...values)?.total || 0;
  const pagination = paginationResult({
    total,
    page: requestedPage,
    pageSize: normalizedPageSize
  });
  const offset = (pagination.page - 1) * pagination.pageSize;
  const items = db
    .prepare(`
      SELECT *
      FROM proactive_targets
      ${where}
      ORDER BY target_type ASC, COALESCE(last_seen_at, updated_at) DESC, target_name ASC
      LIMIT ? OFFSET ?
    `)
    .all(...values, pagination.pageSize, offset)
    .map(rowToProactiveAddressBookTarget);
  return { items, pagination };
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
  scheduledAt = null,
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
      status, total_count, created_by, created_at, updated_at, scheduled_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    timestamp,
    scheduledAt || null
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

function proactiveTasksWhere({ botId = "", dateFrom = "", dateTo = "" } = {}) {
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
  return {
    where: filters.length ? `WHERE ${filters.join(" AND ")}` : "",
    values
  };
}

export function listProactiveTasksPage({
  page = 1,
  pageSize = 20,
  botId = "",
  dateFrom = "",
  dateTo = ""
} = {}) {
  const normalizedPageSize = normalizePageSize(pageSize, 20, 100);
  const requestedPage = normalizePage(page);
  const { where, values } = proactiveTasksWhere({ botId, dateFrom, dateTo });
  const total = db.prepare(`SELECT COUNT(*) AS total FROM proactive_tasks ${where}`).get(...values)?.total || 0;
  const pagination = paginationResult({
    total,
    page: requestedPage,
    pageSize: normalizedPageSize
  });
  const offset = (pagination.page - 1) * pagination.pageSize;
  const items = db
    .prepare(`SELECT * FROM proactive_tasks ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...values, pagination.pageSize, offset)
    .map(rowToProactiveTask);
  return { items, pagination };
}

export function listProactiveTaskTargets(taskId) {
  return db
    .prepare("SELECT * FROM proactive_task_targets WHERE task_id = ? ORDER BY id ASC")
    .all(taskId)
    .map(rowToProactiveTarget);
}

export function claimNextProactiveTarget({ nowIso = now() } = {}) {
  const target = db
    .prepare(`
      SELECT target.*
      FROM proactive_task_targets target
      JOIN proactive_tasks task ON task.id = target.task_id
      WHERE target.status = 'pending'
        AND (task.scheduled_at IS NULL OR task.scheduled_at <= ?)
      ORDER BY target.id ASC
      LIMIT 1
    `)
    .get(nowIso);
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

export function cancelProactiveTask({ id, reason = "console" }) {
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const task = db.prepare("SELECT * FROM proactive_tasks WHERE id = ?").get(id);
    if (!task) throw new Error("proactive task not found");
    if (["sent", "failed", "partial", "canceled"].includes(task.status)) {
      throw new Error("proactive task cannot be canceled");
    }

    db.prepare(`
      UPDATE proactive_task_targets
      SET status = 'canceled',
          error_message = ?,
          finished_at = ?,
          updated_at = ?
      WHERE task_id = ?
        AND status = 'pending'
    `).run(String(reason || "console"), timestamp, timestamp, id);
    db.prepare(`
      UPDATE proactive_tasks
      SET status = 'canceled',
          canceled_at = ?,
          cancel_reason = ?,
          finished_at = COALESCE(finished_at, ?),
          updated_at = ?
      WHERE id = ?
    `).run(timestamp, String(reason || "console"), timestamp, timestamp, id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getProactiveTask(id);
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

export function updateProactiveTargetFromCommandCallback({ botId, messageId, payload }) {
  if (!botId || !messageId) return false;
  const target = db
    .prepare("SELECT id, task_id FROM proactive_task_targets WHERE message_id = ? AND bot_id = ?")
    .get(messageId, botId);
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
  const currentTask = db.prepare("SELECT status FROM proactive_tasks WHERE id = ?").get(taskId);
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status IN ('pending', 'sending') THEN 1 ELSE 0 END) AS active
    FROM proactive_task_targets
    WHERE task_id = ?
  `).get(taskId);

  if (currentTask?.status === "canceled") {
    db.prepare(`
      UPDATE proactive_tasks
      SET total_count = ?,
          sent_count = ?,
          failed_count = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      counts.total || 0,
      counts.sent || 0,
      counts.failed || 0,
      now(),
      taskId
    );
    return;
  }

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
    "agent-response-validation-failures": {
      table: "agent_response_validation_failures",
      mapper: (row) => ({
        ...row,
        invocationId: row.invocation_id,
        botId: row.bot_id,
        agentId: row.agent_id,
        conversationKey: row.conversation_key,
        incomingMessageId: row.incoming_message_id,
        attemptNumber: row.attempt_number,
        errorType: row.error_type,
        errorPath: row.error_path,
        errorMessage: row.error_message,
        rawResponseText: row.raw_response_text,
        retryRequested: Boolean(row.retry_requested),
        retryOutcome: row.retry_outcome || "unknown",
        retryErrorMessage: row.retry_error_message || "",
        retryFinishedAt: row.retry_finished_at || "",
        repairActions: parseJson(row.repair_actions_json) || []
      })
    },
    "agent-tag-evaluations": {
      table: "agent_tag_evaluations",
      mapper: rowToAgentTagEvaluation,
      orderBy: "created_at"
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
    "flow-activation-tasks": {
      table: "flow_activation_tasks",
      mapper: rowToFlowActivationTask
    },
    "tag-activation-tasks": {
      table: "tag_activation_tasks",
      mapper: rowToTagActivationTask
    },
    "conversation-tags": {
      table: "conversation_tags",
      mapper: rowToConversationTag
    },
    "conversation-tag-events": {
      table: "conversation_tag_events",
      mapper: (row) => ({ ...row, payload: parseJson(row.payload_json) })
    },
    "tag-alert-events": {
      table: "tag_alert_events",
      mapper: rowToTagAlertEvent,
      orderBy: "created_at"
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

const DEFAULT_COCKPIT_CONFIG = Object.freeze({
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  defaultNoReplyHours: 24,
  nodeNoReplyHours: {},
  schedules: {
    daily: { enabled: false, sendAt: "09:00", recipients: [] },
    weekly: { enabled: false, sendAt: "09:00", recipients: [] },
    monthly: { enabled: false, sendAt: "09:00", recipients: [] }
  }
});

function normalizeCockpitConfig(config = {}) {
  const schedules = config.schedules || {};
  return {
    timezone: String(config.timezone || DEFAULT_COCKPIT_CONFIG.timezone),
    defaultNoReplyHours: Number(config.defaultNoReplyHours || 24),
    nodeNoReplyHours: { ...(config.nodeNoReplyHours || {}) },
    schedules: Object.fromEntries(["daily", "weekly", "monthly"].map((type) => [
      type,
      {
        ...DEFAULT_COCKPIT_CONFIG.schedules[type],
        ...(schedules[type] || {}),
        recipients: [...(schedules[type]?.recipients || [])]
      }
    ]))
  };
}

function rowToCockpitEvent(row) {
  return row ? {
    id: row.id,
    eventKey: row.event_key,
    botId: row.bot_id,
    conversationKey: row.conversation_key || "",
    customerKey: row.customer_key || "",
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    flowVersionId: row.flow_version_id,
    tagVersionId: row.tag_version_id,
    payload: parseJson(row.payload_json) || {},
    sourceRef: parseJson(row.source_ref_json) || {},
    createdAt: row.created_at
  } : null;
}

export function appendCockpitEvent(input) {
  const createdAt = now();
  const eventKey = String(input.eventKey || "").trim();
  const result = db.prepare(`
    INSERT OR IGNORE INTO cockpit_events (
      event_key, bot_id, conversation_key, customer_key, event_type,
      occurred_at, received_at, flow_version_id, tag_version_id,
      payload_json, source_ref_json, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventKey,
    String(input.botId || "").trim(),
    String(input.conversationKey || "").trim(),
    String(input.customerKey || "").trim(),
    String(input.eventType || "").trim(),
    String(input.occurredAt || createdAt),
    String(input.receivedAt || createdAt),
    input.flowVersionId ?? null,
    input.tagVersionId ?? null,
    json(input.payload || {}),
    json(input.sourceRef || {}),
    createdAt
  );
  const row = db.prepare("SELECT id FROM cockpit_events WHERE event_key = ?").get(eventKey);
  return { inserted: Boolean(result.changes), eventId: row?.id || null };
}

export function listCockpitEvents({ botId, afterId = 0, throughAt = "", limit = 1000 }) {
  const boundedLimit = Math.min(5000, Math.max(1, Number(limit) || 1000));
  const rows = throughAt
    ? db.prepare(`
        SELECT * FROM cockpit_events
        WHERE bot_id = ? AND id > ? AND received_at <= ?
        ORDER BY id ASC LIMIT ?
      `).all(botId, Number(afterId) || 0, throughAt, boundedLimit)
    : db.prepare(`
        SELECT * FROM cockpit_events
        WHERE bot_id = ? AND id > ?
        ORDER BY id ASC LIMIT ?
      `).all(botId, Number(afterId) || 0, boundedLimit);
  return rows.map(rowToCockpitEvent);
}

export function incrementCockpitDailyCounter({
  botId,
  localDate,
  metricKey,
  amount = 1
}) {
  const timestamp = now();
  db.prepare(`
    INSERT INTO cockpit_daily_counters (
      bot_id, local_date, metric_key, metric_value, updated_at
    )
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(bot_id, local_date, metric_key) DO UPDATE SET
      metric_value = metric_value + excluded.metric_value,
      updated_at = excluded.updated_at
  `).run(botId, localDate, metricKey, Number(amount) || 0, timestamp);
  return Number(db.prepare(`
    SELECT metric_value FROM cockpit_daily_counters
    WHERE bot_id = ? AND local_date = ? AND metric_key = ?
  `).get(botId, localDate, metricKey)?.metric_value || 0);
}

export function getCockpitDailyCounters({ botId, localDate }) {
  return Object.fromEntries(db.prepare(`
    SELECT metric_key, metric_value FROM cockpit_daily_counters
    WHERE bot_id = ? AND local_date = ?
    ORDER BY metric_key ASC
  `).all(botId, localDate).map((row) => [row.metric_key, Number(row.metric_value || 0)]));
}

export function getCockpitBaselineCharts(botId) {
  const machine = getFlowMachineForBot(botId);
  const binding = getBotBinding(botId);
  const tagSchema = binding?.agentId
    ? getAgentTagSchema(binding.agentId)?.config
    : null;
  const nodeRows = db.prepare(`
    SELECT current_node_id AS node_id, COUNT(*) AS customer_count
    FROM flow_sessions
    WHERE bot_id = ? AND status = 'active'
    GROUP BY current_node_id
  `).all(botId);
  const countsByNode = new Map(
    nodeRows.map((row) => [row.node_id, Number(row.customer_count || 0)])
  );
  const configuredNodes = (machine?.config?.nodes || [])
    .filter((node) => String(node?.id || "").trim());
  const configuredIds = new Set(configuredNodes.map((node) => node.id));
  const nodes = [
    ...configuredNodes.map((node) => ({
      nodeId: node.id,
      nodeName: node.name || node.id,
      reached: countsByNode.get(node.id) || 0
    })),
    ...nodeRows
      .filter((row) => !configuredIds.has(row.node_id))
      .map((row) => ({
        nodeId: row.node_id,
        nodeName: row.node_id === "__conversation__"
          ? "其他（未进入任务）"
          : row.node_id,
        reached: Number(row.customer_count || 0)
      }))
  ];
  const totalSessions = nodeRows.reduce(
    (sum, row) => sum + Number(row.customer_count || 0),
    0
  );
  const tagRows = db.prepare(`
    SELECT
      COALESCE(group_id, '') AS group_id,
      MAX(group_name) AS group_name,
      tag_id,
      MAX(tag_name) AS tag_name,
      COUNT(DISTINCT conversation_key) AS customer_count
    FROM conversation_tags
    WHERE bot_id = ? AND tag_type = 'normal'
    GROUP BY COALESCE(group_id, ''), tag_id
    ORDER BY group_name ASC, tag_name ASC, tag_id ASC
  `).all(botId);
  const tagRowKey = (groupId, tagId) => `${groupId || ""}\u0000${tagId || ""}`;
  const tagRowsById = new Map(
    tagRows.map((row) => [tagRowKey(row.group_id, row.tag_id), row])
  );
  const tags = [];
  for (const group of tagSchema?.groups || []) {
    for (const tag of group.tags || []) {
      const row = tagRowsById.get(tagRowKey(group.id, tag.id));
      tags.push({
        groupId: group.id,
        groupName: group.name || group.id,
        tagId: tag.id,
        tagName: tag.name || tag.id,
        current: Number(row?.customer_count || 0),
        added: 0,
        removed: 0,
        net: 0,
        basis: "current_state"
      });
      tagRowsById.delete(tagRowKey(group.id, tag.id));
    }
  }
  for (const row of tagRows) {
    if (!tagRowsById.has(tagRowKey(row.group_id, row.tag_id))) continue;
    tags.push({
      groupId: row.group_id,
      groupName: row.group_name || row.group_id || "其他标签",
      tagId: row.tag_id,
      tagName: row.tag_name || row.tag_id,
      current: Number(row.customer_count || 0),
      added: 0,
      removed: 0,
      net: 0,
      basis: "current_state"
    });
  }
  return {
    nodeDistribution: nodes.map((node) => ({
      ...node,
      share: totalSessions ? node.reached / totalSessions : 0,
      basis: "current_state"
    })),
    tags
  };
}

export function getCockpitConfig(botId) {
  const row = db.prepare("SELECT config_json FROM cockpit_configs WHERE bot_id = ?").get(botId);
  return normalizeCockpitConfig(parseJson(row?.config_json) || {});
}

export function upsertCockpitConfig({ botId, config }) {
  const timestamp = now();
  const normalized = normalizeCockpitConfig(config);
  db.prepare(`
    INSERT INTO cockpit_configs (bot_id, config_json, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(bot_id) DO UPDATE SET
      config_json = excluded.config_json,
      updated_at = excluded.updated_at
  `).run(botId, json(normalized), timestamp, timestamp);
  return getCockpitConfig(botId);
}

function rowToCockpitSnapshot(row) {
  return row ? {
    id: row.id,
    botId: row.bot_id,
    periodType: row.period_type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status,
    sourceThroughEventId: Number(row.source_through_event_id || 0),
    metrics: parseJson(row.metrics_json) || {},
    charts: parseJson(row.charts_json) || {},
    definitions: parseJson(row.definitions_json) || {},
    generatedAt: row.generated_at,
    createdAt: row.created_at
  } : null;
}

export function saveCockpitSnapshot(input) {
  const createdAt = now();
  const result = db.prepare(`
    INSERT INTO cockpit_snapshots (
      bot_id, period_type, period_start, period_end, status,
      source_through_event_id, metrics_json, charts_json, definitions_json,
      generated_at, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.botId,
    input.periodType,
    input.periodStart,
    input.periodEnd,
    input.status || "ready",
    Number(input.sourceThroughEventId || 0),
    json(input.metrics || {}),
    json(input.charts || {}),
    json(input.definitions || {}),
    input.generatedAt || createdAt,
    createdAt
  );
  return rowToCockpitSnapshot(
    db.prepare("SELECT * FROM cockpit_snapshots WHERE id = ?").get(result.lastInsertRowid)
  );
}

export function getLatestCockpitSnapshot({ botId, periodType, periodStart }) {
  return rowToCockpitSnapshot(periodStart
    ? db.prepare(`
        SELECT * FROM cockpit_snapshots
        WHERE bot_id = ? AND period_type = ? AND period_start = ? AND status = 'ready'
        ORDER BY id DESC LIMIT 1
      `).get(botId, periodType, periodStart)
    : db.prepare(`
        SELECT * FROM cockpit_snapshots
        WHERE bot_id = ? AND period_type = ? AND status = 'ready'
        ORDER BY period_start DESC, id DESC LIMIT 1
      `).get(botId, periodType));
}

function rowToCockpitReport(row) {
  return row ? {
    id: row.id,
    botId: row.bot_id,
    snapshotId: row.snapshot_id,
    reportType: row.report_type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    revision: Number(row.revision || 1),
    status: row.status,
    summary: parseJson(row.summary_json) || {},
    document: parseJson(row.document_json) || {},
    aiError: row.ai_error || "",
    generatedAt: row.generated_at,
    createdAt: row.created_at
  } : null;
}

export function createCockpitReport(input) {
  const createdAt = now();
  const result = db.prepare(`
    INSERT INTO cockpit_reports (
      bot_id, snapshot_id, report_type, period_start, period_end, revision,
      status, summary_json, document_json, ai_error, generated_at, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.botId,
    input.snapshotId,
    input.reportType,
    input.periodStart,
    input.periodEnd,
    Number(input.revision || 1),
    input.status || "ready",
    json(input.summary || {}),
    json(input.document || {}),
    input.aiError || "",
    input.generatedAt || createdAt,
    createdAt
  );
  return rowToCockpitReport(
    db.prepare("SELECT * FROM cockpit_reports WHERE id = ?").get(result.lastInsertRowid)
  );
}

export function createCockpitReportRevision({ reportId, ...changes }) {
  const source = rowToCockpitReport(
    db.prepare("SELECT * FROM cockpit_reports WHERE id = ?").get(reportId)
  );
  if (!source) throw new Error("cockpit report not found");
  const latestRevision = Number(db.prepare(`
    SELECT MAX(revision) AS revision FROM cockpit_reports
    WHERE bot_id = ? AND report_type = ? AND period_start = ? AND period_end = ?
  `).get(
    source.botId,
    source.reportType,
    source.periodStart,
    source.periodEnd
  )?.revision || source.revision);
  return createCockpitReport({ ...source, ...changes, revision: latestRevision + 1 });
}

export function listCockpitReports({ botId, page = 1, pageSize = 20 }) {
  const normalizedPageSize = normalizePageSize(pageSize);
  const total = Number(db.prepare(
    "SELECT COUNT(*) AS count FROM cockpit_reports WHERE bot_id = ?"
  ).get(botId)?.count || 0);
  const pagination = paginationResult({ total, page, pageSize: normalizedPageSize });
  const items = db.prepare(`
    SELECT * FROM cockpit_reports
    WHERE bot_id = ?
    ORDER BY period_start DESC, revision DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(
    botId,
    pagination.pageSize,
    (pagination.page - 1) * pagination.pageSize
  ).map(rowToCockpitReport);
  return { items, ...pagination };
}

export function getCockpitReport({ botId, reportId }) {
  return rowToCockpitReport(db.prepare(
    "SELECT * FROM cockpit_reports WHERE bot_id = ? AND id = ?"
  ).get(botId, reportId));
}

function rowToCockpitDefinitionVersion(row) {
  return row ? {
    id: row.id,
    botId: row.bot_id,
    definitionType: row.definition_type,
    semanticHash: row.semantic_hash,
    versionNumber: Number(row.version_number),
    revisionNumber: Number(row.revision_number),
    config: parseJson(row.config_json) || {},
    effectiveAt: row.effective_at,
    createdAt: row.created_at
  } : null;
}

export function saveCockpitDefinitionVersion(input) {
  const result = db.prepare(`
    INSERT INTO cockpit_definition_versions (
      bot_id, definition_type, semantic_hash, version_number, revision_number,
      config_json, effective_at, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.botId,
    input.definitionType,
    input.semanticHash,
    Number(input.versionNumber),
    Number(input.revisionNumber),
    json(input.config || {}),
    input.effectiveAt || now(),
    now()
  );
  return rowToCockpitDefinitionVersion(
    db.prepare("SELECT * FROM cockpit_definition_versions WHERE id = ?")
      .get(result.lastInsertRowid)
  );
}

export function ensureCockpitDefinitionVersion({
  botId,
  definitionType,
  config,
  effectiveAt
}) {
  const semanticHash = definitionSemanticHash(definitionType, config);
  const latest = rowToCockpitDefinitionVersion(db.prepare(`
    SELECT *
    FROM cockpit_definition_versions
    WHERE bot_id = ? AND definition_type = ?
    ORDER BY version_number DESC, revision_number DESC
    LIMIT 1
  `).get(botId, definitionType));
  if (latest && JSON.stringify(latest.config) === JSON.stringify(config || {})) {
    return { ...latest, semanticChanged: false };
  }
  const semanticChanged = !latest || latest.semanticHash !== semanticHash;
  const saved = saveCockpitDefinitionVersion({
    botId,
    definitionType,
    semanticHash,
    versionNumber: semanticChanged ? Number(latest?.versionNumber || 0) + 1 : latest.versionNumber,
    revisionNumber: semanticChanged ? 1 : latest.revisionNumber + 1,
    config,
    effectiveAt
  });
  return { ...saved, semanticChanged };
}

function rowToCockpitAggregationCursor(row, botId = "") {
  return row ? {
    botId: row.bot_id,
    lastEventId: Number(row.last_event_id || 0),
    lastSuccessAt: row.last_success_at || "",
    lastError: row.last_error || "",
    updatedAt: row.updated_at
  } : {
    botId,
    lastEventId: 0,
    lastSuccessAt: "",
    lastError: "",
    updatedAt: ""
  };
}

export function getCockpitAggregationCursor(botId) {
  return rowToCockpitAggregationCursor(
    db.prepare("SELECT * FROM cockpit_aggregation_cursors WHERE bot_id = ?").get(botId),
    botId
  );
}

export function saveCockpitAggregationCursor(input) {
  const timestamp = now();
  db.prepare(`
    INSERT INTO cockpit_aggregation_cursors (
      bot_id, last_event_id, last_success_at, last_error, updated_at
    )
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(bot_id) DO UPDATE SET
      last_event_id = excluded.last_event_id,
      last_success_at = excluded.last_success_at,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
  `).run(
    input.botId,
    Number(input.lastEventId || 0),
    input.lastSuccessAt || null,
    input.lastError || "",
    timestamp
  );
  return getCockpitAggregationCursor(input.botId);
}

export function getCockpitAggregationState(botId) {
  const row = db.prepare(
    "SELECT state_json FROM cockpit_aggregation_states WHERE bot_id = ?"
  ).get(botId);
  return parseJson(row?.state_json) || { events: [] };
}

export function saveCockpitAggregationState({ botId, state, lastEventId }) {
  db.prepare(`
    INSERT INTO cockpit_aggregation_states (
      bot_id, state_json, last_event_id, updated_at
    )
    VALUES (?, ?, ?, ?)
    ON CONFLICT(bot_id) DO UPDATE SET
      state_json = excluded.state_json,
      last_event_id = excluded.last_event_id,
      updated_at = excluded.updated_at
  `).run(botId, json(state || { events: [] }), Number(lastEventId || 0), now());
  return getCockpitAggregationState(botId);
}

function rowToCockpitJob(row) {
  return row ? {
    id: row.id,
    botId: row.bot_id,
    stage: row.stage,
    payload: parseJson(row.payload_json) || {},
    status: row.status,
    attemptNumber: Number(row.attempt_number || 0),
    dueAt: row.due_at,
    processingStartedAt: row.processing_started_at || "",
    finishedAt: row.finished_at || "",
    errorMessage: row.error_message || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } : null;
}

export function createCockpitJob(input) {
  const timestamp = now();
  const result = db.prepare(`
    INSERT INTO cockpit_jobs (
      bot_id, stage, payload_json, status, attempt_number, due_at,
      created_at, updated_at
    )
    VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)
  `).run(
    input.botId,
    input.stage,
    json(input.payload || {}),
    input.dueAt || timestamp,
    timestamp,
    timestamp
  );
  return rowToCockpitJob(
    db.prepare("SELECT * FROM cockpit_jobs WHERE id = ?").get(result.lastInsertRowid)
  );
}

export function claimDueCockpitJobs({ stage, now: dueThrough, limit = 10 }) {
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = db.prepare(`
      SELECT * FROM cockpit_jobs
      WHERE stage = ? AND status = 'pending' AND due_at <= ?
      ORDER BY due_at ASC, id ASC
      LIMIT ?
    `).all(stage, dueThrough, Math.max(1, Number(limit) || 10));
    for (const row of rows) {
      db.prepare(`
        UPDATE cockpit_jobs
        SET status = 'processing',
            attempt_number = attempt_number + 1,
            processing_started_at = ?,
            updated_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(timestamp, timestamp, row.id);
    }
    db.exec("COMMIT");
    return rows.map((row) => rowToCockpitJob({
      ...row,
      status: "processing",
      attempt_number: Number(row.attempt_number || 0) + 1,
      processing_started_at: timestamp,
      updated_at: timestamp
    }));
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function finishCockpitJob({ id, status, errorMessage = "" }) {
  const normalizedStatus = status === "completed" ? "completed" : "failed";
  const timestamp = now();
  db.prepare(`
    UPDATE cockpit_jobs
    SET status = ?, finished_at = ?, error_message = ?, updated_at = ?
    WHERE id = ?
  `).run(normalizedStatus, timestamp, errorMessage, timestamp, id);
  return rowToCockpitJob(db.prepare("SELECT * FROM cockpit_jobs WHERE id = ?").get(id));
}

function rowToCockpitDelivery(row) {
  return row ? {
    id: row.id,
    reportId: row.report_id,
    botId: row.bot_id,
    recipient: row.recipient,
    status: row.status,
    attemptNumber: Number(row.attempt_number || 0),
    dueAt: row.due_at,
    sentAt: row.sent_at || "",
    errorMessage: row.error_message || "",
    worktoolResponse: parseJson(row.worktool_response_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } : null;
}

export function createCockpitDelivery(input) {
  const timestamp = now();
  const result = db.prepare(`
    INSERT INTO cockpit_deliveries (
      report_id, bot_id, recipient, status, attempt_number, due_at,
      created_at, updated_at
    )
    VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)
  `).run(
    input.reportId,
    input.botId,
    input.recipient,
    input.dueAt || timestamp,
    timestamp,
    timestamp
  );
  return rowToCockpitDelivery(
    db.prepare("SELECT * FROM cockpit_deliveries WHERE id = ?").get(result.lastInsertRowid)
  );
}

export function claimDueCockpitDeliveries({ now: dueThrough, limit = 10 }) {
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = db.prepare(`
      SELECT * FROM cockpit_deliveries
      WHERE status = 'pending' AND due_at <= ?
      ORDER BY due_at ASC, id ASC
      LIMIT ?
    `).all(dueThrough, Math.max(1, Number(limit) || 10));
    for (const row of rows) {
      db.prepare(`
        UPDATE cockpit_deliveries
        SET status = 'processing',
            attempt_number = attempt_number + 1,
            updated_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(timestamp, row.id);
    }
    db.exec("COMMIT");
    return rows.map((row) => rowToCockpitDelivery({
      ...row,
      status: "processing",
      attempt_number: Number(row.attempt_number || 0) + 1,
      updated_at: timestamp
    }));
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function finishCockpitDelivery({
  id,
  status,
  response = null,
  errorMessage = ""
}) {
  const normalizedStatus = status === "sent" ? "sent" : "failed";
  const timestamp = now();
  db.prepare(`
    UPDATE cockpit_deliveries
    SET status = ?, sent_at = ?, error_message = ?,
        worktool_response_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    normalizedStatus,
    normalizedStatus === "sent" ? timestamp : null,
    errorMessage,
    response ? json(response) : null,
    timestamp,
    id
  );
  return rowToCockpitDelivery(
    db.prepare("SELECT * FROM cockpit_deliveries WHERE id = ?").get(id)
  );
}
