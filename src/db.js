import fs from "node:fs";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolveRuntimePaths } from "./runtime-paths.js";
import { mergeInlineActions } from "./action-chips.js";
import { activationDelayMs } from "./activation-timing.js";
import { hashAccessKey } from "./auth.js";
import { COCKPIT_TIME_ZONE, definitionSemanticHash } from "./cockpit-domain.js";
import {
  areConversationMessagesDuplicates,
  dedupeConversationMessages
} from "./conversation-message-dedupe.js";
import { dateTagIdFor, normalizeTagActivation, normalizeTagSchema } from "./tags.js";
import {
  groupAutomationCycleWindow,
  nextGroupAutomationRunAt,
  normalizeGroupAutomationSchedule
} from "./group-automation-schedule.js";

const { dataDir, databasePath: dbPath } = resolveRuntimePaths();
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA busy_timeout = 5000;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_key TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

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

  CREATE TABLE IF NOT EXISTS channel_accounts (
    bot_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    public_id TEXT NOT NULL UNIQUE,
    token_ciphertext TEXT NOT NULL,
    token_iv TEXT NOT NULL,
    token_auth_tag TEXT NOT NULL,
    token_suffix TEXT NOT NULL,
    webhook_secret_hash TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    provider_status TEXT NOT NULL DEFAULT '',
    health_status TEXT NOT NULL DEFAULT 'disconnected',
    last_health_check_at TEXT,
    last_webhook_at TEXT,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(provider, channel_id)
  );

  CREATE TABLE IF NOT EXISTS channel_webhook_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    channel_account_id TEXT NOT NULL,
    event_kind TEXT NOT NULL,
    request_method TEXT NOT NULL,
    external_id TEXT NOT NULL DEFAULT '',
    idempotency_key TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    lease_owner TEXT,
    lease_expires_at TEXT,
    next_retry_at TEXT,
    error_message TEXT NOT NULL DEFAULT '',
    received_at TEXT NOT NULL,
    processed_at TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(bot_id, idempotency_key)
  );

  CREATE INDEX IF NOT EXISTS idx_channel_webhook_events_pending
  ON channel_webhook_events (state, next_retry_at, id);

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
    provider TEXT NOT NULL DEFAULT '',
    channel_account_id TEXT NOT NULL DEFAULT '',
    delivery_status TEXT NOT NULL DEFAULT '',
    delivery_error TEXT NOT NULL DEFAULT '',
    delivery_updated_at TEXT,
    channel_response_json TEXT,
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
    channel_response_json TEXT,
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

  CREATE TABLE IF NOT EXISTS legacy_api_message_cache (
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

  CREATE INDEX IF NOT EXISTS idx_legacy_api_cache_target
  ON legacy_api_message_cache (bot_id, target_name, occurred_at);

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
    channel_message_ids_json TEXT,
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
    channel_message_id TEXT,
    channel_response_json TEXT,
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
    channel_message_ids_json TEXT,
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

  CREATE TABLE IF NOT EXISTS managed_group_members (
    group_id TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    external_id TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    member_role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (group_id, external_id)
  );

  CREATE INDEX IF NOT EXISTS idx_managed_group_members_bot
  ON managed_group_members (bot_id, group_id);

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

  CREATE TABLE IF NOT EXISTS managed_group_automation_tasks (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    name TEXT NOT NULL,
    task_type TEXT NOT NULL CHECK (task_type IN ('conditional_push','periodic_summary')),
    cadence TEXT NOT NULL CHECK (cadence IN ('daily','weekly','monthly')),
    schedule_days_json TEXT NOT NULL DEFAULT '[]',
    time_of_day TEXT NOT NULL,
    condition_text TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    summary_template TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    validation_reason TEXT NOT NULL DEFAULT '',
    next_run_at TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_group_automation_tasks_due
  ON managed_group_automation_tasks (enabled, deleted_at, next_run_at);

  CREATE INDEX IF NOT EXISTS idx_group_automation_tasks_scope
  ON managed_group_automation_tasks (bot_id, group_id, deleted_at, created_at);

  CREATE TABLE IF NOT EXISTS managed_group_automation_mentions (
    task_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    PRIMARY KEY (task_id, role_id)
  );

  CREATE TABLE IF NOT EXISTS managed_group_automation_occurrences (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    scheduled_for TEXT NOT NULL,
    cycle_key TEXT NOT NULL,
    cycle_start_at TEXT NOT NULL,
    cycle_end_at TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    lease_expires_at TEXT,
    execution_token TEXT,
    next_retry_at TEXT,
    condition_achieved INTEGER,
    reason TEXT NOT NULL DEFAULT '',
    evidence_message_ids_json TEXT NOT NULL DEFAULT '[]',
    mention_role_ids_json TEXT NOT NULL DEFAULT '[]',
    mention_names_json TEXT NOT NULL DEFAULT '[]',
    warnings_json TEXT NOT NULL DEFAULT '[]',
    rendered_content TEXT NOT NULL DEFAULT '',
    channel_message_id TEXT NOT NULL DEFAULT '',
    channel_response_json TEXT,
    error_message TEXT NOT NULL DEFAULT '',
    started_at TEXT,
    finished_at TEXT,
    task_snapshot_json TEXT NOT NULL DEFAULT '{}',
    history_start_at TEXT,
    history_end_at TEXT,
    preanalysis_cutoff_at TEXT,
    stage TEXT NOT NULL DEFAULT 'legacy',
    stage_attempts INTEGER NOT NULL DEFAULT 0,
    stage_attempts_json TEXT NOT NULL DEFAULT '{}',
    lease_owner TEXT NOT NULL DEFAULT '',
    heartbeat_at TEXT,
    decision_note TEXT NOT NULL DEFAULT '',
    frozen_payload_json TEXT NOT NULL DEFAULT '{}',
    delivery_state TEXT NOT NULL DEFAULT '',
    actual_started_at TEXT,
    actual_completed_at TEXT,
    target_delay_ms INTEGER,
    retry_metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (task_id, scheduled_for)
  );

  CREATE INDEX IF NOT EXISTS idx_group_automation_occurrences_task
  ON managed_group_automation_occurrences (bot_id, task_id, scheduled_for DESC);

  CREATE INDEX IF NOT EXISTS idx_group_automation_occurrences_lease
  ON managed_group_automation_occurrences (status, lease_expires_at);

  CREATE TABLE IF NOT EXISTS managed_group_automation_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    occurrence_id TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    status TEXT NOT NULL,
    error_message TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,
    finished_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_group_automation_attempts_occurrence
  ON managed_group_automation_attempts (bot_id, group_id, occurrence_id, id);

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
    channel_response_json TEXT,
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

  CREATE TABLE IF NOT EXISTS cockpit_stage_runs (
    local_date TEXT NOT NULL,
    stage TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (local_date, stage)
  );

  CREATE INDEX IF NOT EXISTS idx_incoming_messages_cockpit_backfill
  ON incoming_messages (bot_id, created_at, id);

  CREATE INDEX IF NOT EXISTS idx_outgoing_messages_cockpit_backfill
  ON outgoing_messages (bot_id, created_at, id);

  CREATE INDEX IF NOT EXISTS idx_flow_sessions_cockpit_backfill
  ON flow_sessions (bot_id, last_message_at, id);

  CREATE INDEX IF NOT EXISTS idx_conversation_tag_events_cockpit_backfill
  ON conversation_tag_events (bot_id, accepted, created_at, id);

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
ensureColumn("outgoing_messages", "provider", "TEXT NOT NULL DEFAULT ''");
ensureColumn("outgoing_messages", "channel_account_id", "TEXT NOT NULL DEFAULT ''");
ensureColumn("outgoing_messages", "delivery_status", "TEXT NOT NULL DEFAULT ''");
ensureColumn("outgoing_messages", "delivery_error", "TEXT NOT NULL DEFAULT ''");
ensureColumn("outgoing_messages", "delivery_updated_at", "TEXT");
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_outgoing_messages_manual_delivery_lookup
  ON outgoing_messages (
    bot_id, conversation_key, provider, channel_account_id, message_id, id DESC
  );

  CREATE INDEX IF NOT EXISTS idx_outgoing_messages_callback_lookup
  ON outgoing_messages (bot_id, provider, channel_account_id, message_id, id DESC);
`);
ensureColumn("managed_groups", "provider", "TEXT NOT NULL DEFAULT ''");
ensureColumn("managed_groups", "channel_account_id", "TEXT NOT NULL DEFAULT ''");
ensureColumn("managed_groups", "external_group_id", "TEXT NOT NULL DEFAULT ''");
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_managed_groups_external_identity
  ON managed_groups (provider, channel_account_id, external_group_id)
  WHERE external_group_id <> ''
`);
ensureColumn("proactive_tasks", "message_type", "TEXT NOT NULL DEFAULT 'text'");
ensureColumn("proactive_tasks", "message_payload_json", "TEXT");
ensureColumn("proactive_task_targets", "message_type", "TEXT NOT NULL DEFAULT 'text'");
ensureColumn("proactive_task_targets", "message_payload_json", "TEXT");
ensureColumn("proactive_task_targets", "agent_sync_status", "TEXT NOT NULL DEFAULT 'pending'");
ensureColumn("proactive_task_targets", "agent_sync_error", "TEXT");
ensureColumn("proactive_task_targets", "agent_sync_response_json", "TEXT");
ensureColumn("proactive_task_targets", "agent_sync_at", "TEXT");
ensureColumn("proactive_task_targets", "conversation_key", "TEXT NOT NULL DEFAULT ''");
ensureColumn("proactive_targets", "conversation_key", "TEXT NOT NULL DEFAULT ''");
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
ensureColumn("managed_group_automation_tasks", "validation_reason", "TEXT NOT NULL DEFAULT ''");
ensureColumn("managed_group_automation_occurrences", "next_retry_at", "TEXT");
ensureColumn("managed_group_automation_occurrences", "execution_token", "TEXT");
ensureColumn(
  "managed_group_automation_occurrences",
  "warnings_json",
  "TEXT NOT NULL DEFAULT '[]'"
);
ensureColumn("managed_group_automation_occurrences", "task_snapshot_json", "TEXT NOT NULL DEFAULT '{}'");
ensureColumn("managed_group_automation_occurrences", "history_start_at", "TEXT");
ensureColumn("managed_group_automation_occurrences", "history_end_at", "TEXT");
ensureColumn("managed_group_automation_occurrences", "preanalysis_cutoff_at", "TEXT");
ensureColumn("managed_group_automation_occurrences", "stage", "TEXT NOT NULL DEFAULT 'legacy'");
ensureColumn("managed_group_automation_occurrences", "stage_attempts", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("managed_group_automation_occurrences", "stage_attempts_json", "TEXT NOT NULL DEFAULT '{}'");
ensureColumn("managed_group_automation_occurrences", "lease_owner", "TEXT NOT NULL DEFAULT ''");
ensureColumn("managed_group_automation_occurrences", "heartbeat_at", "TEXT");
ensureColumn("managed_group_automation_occurrences", "decision_note", "TEXT NOT NULL DEFAULT ''");
ensureColumn("managed_group_automation_occurrences", "frozen_payload_json", "TEXT NOT NULL DEFAULT '{}'");
ensureColumn("managed_group_automation_occurrences", "delivery_state", "TEXT NOT NULL DEFAULT ''");
ensureColumn("managed_group_automation_occurrences", "actual_started_at", "TEXT");
ensureColumn("managed_group_automation_occurrences", "actual_completed_at", "TEXT");
ensureColumn("managed_group_automation_occurrences", "target_delay_ms", "INTEGER");
ensureColumn("managed_group_automation_occurrences", "retry_metadata_json", "TEXT NOT NULL DEFAULT '{}'");
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
  const legacyBeijingMatch = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/
  );
  const legacyBeijingTimestamp = legacyBeijingMatch
    ? new Date(Date.UTC(
      Number(legacyBeijingMatch[1]),
      Number(legacyBeijingMatch[2]) - 1,
      Number(legacyBeijingMatch[3]),
      Number(legacyBeijingMatch[4]) - 8,
      Number(legacyBeijingMatch[5]),
      Number(legacyBeijingMatch[6])
    )).toISOString()
    : "";
  const parsed = new Date(legacyBeijingTimestamp || raw);
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
    provider: row.provider || "",
    channelAccountId: row.channel_account_id || "",
    externalGroupId: row.external_group_id || "",
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

export function getGroupByExternalId({ botId, provider, channelAccountId, externalGroupId }) {
  return rowToManagedGroup(
    db.prepare(`
      SELECT *
      FROM managed_groups
      WHERE bot_id = ? AND provider = ? AND channel_account_id = ? AND external_group_id = ?
    `).get(botId, provider, channelAccountId, externalGroupId)
  );
}

export function listManagedGroupMembers({ botId, groupId }) {
  return db.prepare(`
    SELECT * FROM managed_group_members
    WHERE bot_id = ? AND group_id = ?
    ORDER BY display_name ASC, external_id ASC
  `).all(botId, groupId).map((row) => ({
    groupId: row.group_id,
    botId: row.bot_id,
    externalId: row.external_id,
    displayName: row.display_name || "",
    role: row.member_role || "member",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export function replaceManagedGroupMembers({ botId, groupId, members = [] }) {
  if (!getGroupById({ botId, groupId })) throw new Error("managed group not found");
  const normalized = new Map();
  for (const member of members) {
    const externalId = String(member?.externalId || member?.id || "").trim();
    if (!externalId) continue;
    normalized.set(externalId, {
      externalId,
      displayName: String(member?.displayName || member?.name || "").trim(),
      role: String(member?.role || member?.rank || "member").trim() || "member"
    });
  }
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM managed_group_members WHERE bot_id = ? AND group_id = ?")
      .run(botId, groupId);
    const insert = db.prepare(`
      INSERT INTO managed_group_members (
        group_id, bot_id, external_id, display_name, member_role, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const member of normalized.values()) {
      insert.run(groupId, botId, member.externalId, member.displayName, member.role, timestamp, timestamp);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return listManagedGroupMembers({ botId, groupId });
}

export function resolveManagedGroupMentionIds({ botId, externalGroupId, names = [] }) {
  const group = rowToManagedGroup(db.prepare(`
    SELECT * FROM managed_groups
    WHERE bot_id = ? AND external_group_id = ?
    ORDER BY updated_at DESC LIMIT 1
  `).get(botId, externalGroupId));
  if (!group) return [];
  const members = listManagedGroupMembers({ botId, groupId: group.id });
  const requested = new Set(names
    .map((name) => String(name || "").replace(/^@/u, "").trim())
    .filter(Boolean));
  if (requested.has("所有人") || requested.has("all")) {
    return members.map((member) => member.externalId);
  }
  return members
    .filter((member) => requested.has(member.displayName) || requested.has(member.externalId))
    .map((member) => member.externalId);
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
  provider = "",
  channelAccountId = "",
  externalGroupId = "",
  currentName,
  currentRemark = "",
  source,
  discoveredAt = now(),
  createdAt = "",
  dateSource = ""
}) {
  const name = String(currentName || "").trim();
  if (!botId || !name) throw new Error("botId and currentName are required");
  const normalizedProvider = String(provider || "").trim();
  const normalizedChannelAccountId = String(channelAccountId || "").trim();
  const normalizedExternalGroupId = String(externalGroupId || "").trim();
  const externalGroup = normalizedExternalGroupId
    ? getGroupByExternalId({
        botId,
        provider: normalizedProvider,
        channelAccountId: normalizedChannelAccountId,
        externalGroupId: normalizedExternalGroupId
      })
    : null;
  if (externalGroup) {
    if (externalGroup.currentName !== name || externalGroup.currentRemark !== String(currentRemark || "").trim()) {
      updateGroupExternalSnapshot({
        botId,
        groupId: externalGroup.id,
        expectedVersion: externalGroup.version,
        currentName: name,
        currentRemark
      });
    }
    return getGroupById({ botId, groupId: externalGroup.id });
  }
  const resolved = resolveGroupByAddress({ botId, groupName: name, groupRemark: currentRemark });
  const authoritativeCreatedAt = normalizeManagedGroupCreatedAt(createdAt);
  if (resolved?.status === "resolved") {
    if (!authoritativeCreatedAt) return resolved.group;
    const normalizedDateSource = String(dateSource || "channel");
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
  const conversationKey = normalizedExternalGroupId
    ? `${normalizedProvider}:${normalizedChannelAccountId}:group:${normalizedExternalGroupId}`
    : canonicalGroupConversationKey({ botId, groupId });
  const groupCreatedAt = authoritativeCreatedAt
    || normalizeManagedGroupCreatedAt(timestamp)
    || timestamp;
  const normalizedDateSource = String(
    dateSource
      || (authoritativeCreatedAt
        ? "channel"
        : source === "created"
          ? "system_created"
          : "first_discovered")
  );
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO managed_groups (
        id, bot_id, provider, channel_account_id, external_group_id,
        conversation_key, current_name, current_remark,
        reply_policy, background, source, lifecycle_status,
        group_created_at, date_source, config_version, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'mention_only', '', ?, ?, ?, ?, 1, ?, ?)
    `).run(
      groupId,
      botId,
      normalizedProvider,
      normalizedChannelAccountId,
      normalizedExternalGroupId,
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
        "",
        "",
        0,
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

const groupAutomationTaskTypes = new Set(["conditional_push", "periodic_summary"]);

function listGroupAutomationMentionRoleIds(taskId) {
  return db.prepare(`
    SELECT role_id
    FROM managed_group_automation_mentions
    WHERE task_id = ?
    ORDER BY ordinal ASC, role_id ASC
  `).all(taskId).map((row) => row.role_id);
}

function rowToGroupAutomationTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    botId: row.bot_id,
    groupId: row.group_id,
    name: row.name,
    taskType: row.task_type,
    cadence: row.cadence,
    scheduleDays: parseJson(row.schedule_days_json) || [],
    timeOfDay: row.time_of_day,
    conditionText: row.condition_text || "",
    content: row.content || "",
    summaryTemplate: row.summary_template || "",
    mentionRoleIds: listGroupAutomationMentionRoleIds(row.id),
    enabled: Boolean(row.enabled),
    validationReason: row.validation_reason || "",
    nextRunAt: row.next_run_at || "",
    version: Number(row.version || 1),
    deletedAt: row.deleted_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToGroupAutomationOccurrence(row) {
  if (!row) return null;
  return {
    id: row.id,
    taskId: row.task_id,
    botId: row.bot_id,
    groupId: row.group_id,
    scheduledFor: row.scheduled_for,
    cycleKey: row.cycle_key,
    cycleStartAt: row.cycle_start_at,
    cycleEndAt: row.cycle_end_at,
    status: row.status,
    attempts: Number(row.attempts || 0),
    leaseExpiresAt: row.lease_expires_at || "",
    executionToken: row.execution_token || "",
    nextRetryAt: row.next_retry_at || "",
    conditionAchieved: row.condition_achieved == null
      ? null
      : Boolean(row.condition_achieved),
    reason: row.reason || "",
    evidenceMessageIds: parseJson(row.evidence_message_ids_json) || [],
    mentionRoleIds: parseJson(row.mention_role_ids_json) || [],
    mentionNames: parseJson(row.mention_names_json) || [],
    warnings: parseJson(row.warnings_json) || [],
    renderedContent: row.rendered_content || "",
    channelMessageId: row.channel_message_id || "",
    channelResponse: parseJson(row.channel_response_json),
    errorMessage: row.error_message || "",
    startedAt: row.started_at || "",
    finishedAt: row.finished_at || "",
    taskSnapshot: parseJson(row.task_snapshot_json) || {},
    historyStartAt: row.history_start_at || "",
    historyEndAt: row.history_end_at || "",
    preanalysisCutoffAt: row.preanalysis_cutoff_at || "",
    stage: row.stage || "legacy",
    stageAttempts: Number(row.stage_attempts || 0),
    stageAttemptsByStage: parseJson(row.stage_attempts_json) || {},
    leaseOwner: row.lease_owner || "",
    heartbeatAt: row.heartbeat_at || "",
    decisionNote: row.decision_note || "",
    frozenPayload: parseJson(row.frozen_payload_json) || {},
    deliveryState: row.delivery_state || "",
    actualStartedAt: row.actual_started_at || "",
    actualCompletedAt: row.actual_completed_at || "",
    targetDelayMs: row.target_delay_ms == null ? null : Number(row.target_delay_ms),
    retryMetadata: parseJson(row.retry_metadata_json) || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeGroupAutomationTaskValues(input, current = null) {
  const name = input.name === undefined
    ? current?.name || ""
    : String(input.name || "").trim();
  if (!name) throw new Error("group automation task name is required");

  const taskType = input.taskType === undefined
    ? current?.taskType || ""
    : String(input.taskType || "").trim();
  if (!groupAutomationTaskTypes.has(taskType)) {
    throw new Error("invalid group automation task type");
  }

  const schedule = normalizeGroupAutomationSchedule({
    cadence: input.cadence === undefined ? current?.cadence : input.cadence,
    scheduleDays: input.scheduleDays === undefined ? current?.scheduleDays : input.scheduleDays,
    timeOfDay: input.timeOfDay === undefined ? current?.timeOfDay : input.timeOfDay
  });
  const enabled = input.enabled === undefined ? current?.enabled ?? true : Boolean(input.enabled);
  let nextRunAt = input.nextRunAt === undefined ? current?.nextRunAt || "" : String(input.nextRunAt || "");
  if (nextRunAt && Number.isNaN(new Date(nextRunAt).getTime())) {
    throw new Error("invalid group automation nextRunAt");
  }
  if (enabled && input.nextRunAt === undefined) {
    nextRunAt = nextGroupAutomationRunAt(schedule, now(), { minimumLeadMs: 600_000 });
  } else if (!current && !enabled && input.nextRunAt === undefined) {
    nextRunAt = "";
  }

  const mentionRoleIds = input.mentionRoleIds === undefined
    ? current?.mentionRoleIds || []
    : [...new Set((Array.isArray(input.mentionRoleIds) ? input.mentionRoleIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean))];

  const conditionText = input.conditionText === undefined
    ? current?.conditionText || ""
    : String(input.conditionText || "").trim();
  if (taskType === "conditional_push" && !conditionText) {
    throw new Error("conditional push condition is required");
  }
  if (taskType === "periodic_summary" && conditionText) {
    throw new Error("periodic summary condition must be empty");
  }

  return {
    name,
    taskType,
    ...schedule,
    conditionText,
    content: input.content === undefined ? current?.content || "" : String(input.content || ""),
    summaryTemplate: input.summaryTemplate === undefined
      ? current?.summaryTemplate || ""
      : String(input.summaryTemplate || ""),
    mentionRoleIds,
    enabled,
    nextRunAt
  };
}

function assertGroupAutomationScope({ botId, groupId }) {
  const group = getGroupById({ botId, groupId });
  if (!group) throw new Error("managed group not found");
  return group;
}

function assertGroupAutomationMentionRoles({ botId, groupId, roleIds }) {
  if (!roleIds.length) return;
  const placeholders = roleIds.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT id
    FROM managed_group_roles
    WHERE bot_id = ? AND group_id = ? AND id IN (${placeholders})
  `).all(botId, groupId, ...roleIds);
  if (rows.length !== roleIds.length) throw new Error("group automation mention role not found");
}

function replaceGroupAutomationMentions(taskId, roleIds) {
  db.prepare(`
    DELETE FROM managed_group_automation_mentions
    WHERE task_id = ?
  `).run(taskId);
  const insert = db.prepare(`
    INSERT INTO managed_group_automation_mentions (task_id, role_id, ordinal)
    VALUES (?, ?, ?)
  `);
  roleIds.forEach((roleId, ordinal) => insert.run(taskId, roleId, ordinal));
}

export function getGroupAutomationTask({ botId, taskId }) {
  return rowToGroupAutomationTask(db.prepare(`
    SELECT *
    FROM managed_group_automation_tasks
    WHERE bot_id = ? AND id = ?
  `).get(botId, taskId));
}

export function listGroupAutomationTasks({ botId, groupId, includeDeleted = false }) {
  const deletedClause = includeDeleted ? "" : "AND deleted_at IS NULL";
  return db.prepare(`
    SELECT *
    FROM managed_group_automation_tasks
    WHERE bot_id = ? AND group_id = ? ${deletedClause}
    ORDER BY created_at ASC, id ASC
  `).all(botId, groupId).map(rowToGroupAutomationTask);
}

export function disableLegacyConditionalTasksWithoutCondition() {
  const timestamp = now();
  const result = db.prepare(`
    UPDATE managed_group_automation_tasks
    SET enabled = 0,
        validation_reason = 'needs_condition',
        next_run_at = NULL,
        version = version + 1,
        updated_at = ?
    WHERE task_type = 'conditional_push'
      AND TRIM(condition_text) = ''
      AND deleted_at IS NULL
      AND (
        enabled != 0
        OR next_run_at IS NOT NULL
        OR validation_reason != 'needs_condition'
      )
  `).run(timestamp);
  return Number(result.changes || 0);
}

export function createGroupAutomationTask(input) {
  const botId = String(input?.botId || "").trim();
  const groupId = String(input?.groupId || "").trim();
  assertGroupAutomationScope({ botId, groupId });
  const values = normalizeGroupAutomationTaskValues(input);
  assertGroupAutomationMentionRoles({ botId, groupId, roleIds: values.mentionRoleIds });
  const taskId = crypto.randomUUID();
  const timestamp = now();

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO managed_group_automation_tasks (
        id, bot_id, group_id, name, task_type, cadence, schedule_days_json,
        time_of_day, condition_text, content, summary_template, enabled, validation_reason,
        next_run_at, version, deleted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, 1, NULL, ?, ?)
    `).run(
      taskId,
      botId,
      groupId,
      values.name,
      values.taskType,
      values.cadence,
      json(values.scheduleDays),
      values.timeOfDay,
      values.conditionText,
      values.content,
      values.summaryTemplate,
      values.enabled ? 1 : 0,
      values.nextRunAt || null,
      timestamp,
      timestamp
    );
    replaceGroupAutomationMentions(taskId, values.mentionRoleIds);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getGroupAutomationTask({ botId, taskId });
}

export function updateGroupAutomationTask(input) {
  const botId = String(input?.botId || "").trim();
  const taskId = String(input?.taskId || "").trim();
  const current = getGroupAutomationTask({ botId, taskId });
  if (!current || current.deletedAt) throw new Error("group automation task not found");
  if (Number(current.version) !== Number(input.expectedVersion)) {
    const error = new Error("group automation task version conflict");
    error.code = "GROUP_AUTOMATION_VERSION_CONFLICT";
    throw error;
  }
  const values = normalizeGroupAutomationTaskValues(input, current);
  assertGroupAutomationMentionRoles({
    botId,
    groupId: current.groupId,
    roleIds: values.mentionRoleIds
  });
  const timestamp = now();

  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db.prepare(`
      UPDATE managed_group_automation_tasks
      SET name = ?, task_type = ?, cadence = ?, schedule_days_json = ?,
          time_of_day = ?, condition_text = ?, content = ?, summary_template = ?,
          enabled = ?, validation_reason = '', next_run_at = ?,
          version = version + 1, updated_at = ?
      WHERE bot_id = ? AND id = ? AND version = ? AND deleted_at IS NULL
    `).run(
      values.name,
      values.taskType,
      values.cadence,
      json(values.scheduleDays),
      values.timeOfDay,
      values.conditionText,
      values.content,
      values.summaryTemplate,
      values.enabled ? 1 : 0,
      values.nextRunAt || null,
      timestamp,
      botId,
      taskId,
      Number(input.expectedVersion)
    );
    if (Number(result.changes) !== 1) throw new Error("group automation task version conflict");
    replaceGroupAutomationMentions(taskId, values.mentionRoleIds);
    const taskActivationChanged = current.enabled !== values.enabled;
    if (taskActivationChanged) {
      db.prepare(`
        UPDATE managed_group_automation_occurrences
        SET status = 'canceled',
            stage = CASE WHEN stage = 'legacy' THEN stage ELSE 'canceled' END,
            lease_owner = '', lease_expires_at = NULL, heartbeat_at = NULL,
            execution_token = NULL,
            next_retry_at = NULL,
            reason = CASE WHEN reason = '' THEN ? ELSE reason END,
            actual_completed_at = CASE
              WHEN stage = 'legacy' THEN actual_completed_at
              ELSE COALESCE(actual_completed_at, ?)
            END,
            finished_at = COALESCE(finished_at, ?), updated_at = ?
        WHERE bot_id = ? AND task_id = ?
          AND status IN ('pending', 'retry_wait', 'evaluating')
      `).run(
        values.enabled ? '任务重新启用，旧执行已取消' : '任务已停用，旧执行已取消',
        timestamp,
        timestamp,
        timestamp,
        botId,
        taskId
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getGroupAutomationTask({ botId, taskId });
}

export function duplicateGroupAutomationTask({ botId, taskId, name = "" }) {
  const current = getGroupAutomationTask({ botId, taskId });
  if (!current || current.deletedAt) throw new Error("group automation task not found");
  return createGroupAutomationTask({
    ...current,
    id: undefined,
    name: String(name || "").trim() || `${current.name} 副本`,
    nextRunAt: undefined,
    version: undefined,
    deletedAt: undefined
  });
}

export function softDeleteGroupAutomationTask({ botId, taskId, expectedVersion }) {
  const current = getGroupAutomationTask({ botId, taskId });
  if (!current || current.deletedAt) throw new Error("group automation task not found");
  if (Number(current.version) !== Number(expectedVersion)) {
    const error = new Error("group automation task version conflict");
    error.code = "GROUP_AUTOMATION_VERSION_CONFLICT";
    throw error;
  }
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db.prepare(`
      UPDATE managed_group_automation_tasks
      SET enabled = 0, deleted_at = ?, version = version + 1, updated_at = ?
      WHERE bot_id = ? AND id = ? AND version = ? AND deleted_at IS NULL
    `).run(timestamp, timestamp, botId, taskId, Number(expectedVersion));
    if (Number(result.changes) !== 1) throw new Error("group automation task version conflict");
    db.prepare(`
      UPDATE managed_group_automation_occurrences
      SET status = 'canceled',
          stage = CASE WHEN stage = 'legacy' THEN stage ELSE 'canceled' END,
          lease_owner = '', lease_expires_at = NULL, heartbeat_at = NULL,
          execution_token = NULL,
          next_retry_at = NULL,
          reason = CASE WHEN reason = '' THEN '任务已删除，旧执行已取消' ELSE reason END,
          actual_completed_at = CASE
            WHEN stage = 'legacy' THEN actual_completed_at
            ELSE COALESCE(actual_completed_at, ?)
          END,
          finished_at = COALESCE(finished_at, ?), updated_at = ?
      WHERE bot_id = ? AND task_id = ?
        AND status IN ('pending', 'retry_wait', 'evaluating')
    `).run(timestamp, timestamp, timestamp, botId, taskId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getGroupAutomationTask({ botId, taskId });
}

export function resolveGroupAutomationMentionNames({ botId, groupId, roleIds = [] }) {
  const normalizedRoleIds = [...new Set((Array.isArray(roleIds) ? roleIds : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
  if (!normalizedRoleIds.length) return { names: [], warnings: [] };
  const placeholders = normalizedRoleIds.map(() => "?").join(", ");
  const roles = db.prepare(`
    SELECT id, current_name
    FROM managed_group_roles
    WHERE bot_id = ? AND group_id = ? AND id IN (${placeholders})
  `).all(botId, groupId, ...normalizedRoleIds);
  const namesById = new Map(roles.map((role) => [role.id, role.current_name]));
  const names = [];
  const warnings = [];
  for (const roleId of normalizedRoleIds) {
    const roleName = namesById.get(roleId);
    if (roleName) names.push(roleName);
    else warnings.push(`Mention role ${roleId} was removed`);
  }
  return { names, warnings };
}

function buildGroupAutomationTaskSnapshot(taskRow) {
  const group = getGroupById({ botId: taskRow.bot_id, groupId: taskRow.group_id });
  const roles = listGroupRoles({ botId: taskRow.bot_id, groupId: taskRow.group_id });
  return {
    id: taskRow.id,
    botId: taskRow.bot_id,
    groupId: taskRow.group_id,
    name: taskRow.name,
    taskType: taskRow.task_type,
    cadence: taskRow.cadence,
    scheduleDays: parseJson(taskRow.schedule_days_json) || [],
    timeOfDay: taskRow.time_of_day,
    conditionText: taskRow.condition_text || "",
    content: taskRow.content || "",
    summaryTemplate: taskRow.summary_template || "",
    mentionRoleIds: listGroupAutomationMentionRoleIds(taskRow.id),
    version: Number(taskRow.version || 1),
    group: group ? {
      id: group.id,
      currentName: group.currentName,
      currentRemark: group.currentRemark,
      background: group.background,
      replyPolicy: group.replyPolicy,
      createdAt: group.createdAt
    } : null,
    roles: roles.map((role) => ({
      id: role.id,
      currentName: role.currentName,
      identityType: role.identityType,
      description: role.description,
      replyPolicy: role.replyPolicy,
      aliases: role.aliases
    }))
  };
}

export function getGroupAutomationOccurrence({ botId = "", occurrenceId }) {
  const normalizedBotId = String(botId || "").trim();
  const row = normalizedBotId
    ? db.prepare(`
        SELECT * FROM managed_group_automation_occurrences
        WHERE bot_id = ? AND id = ?
      `).get(normalizedBotId, occurrenceId)
    : db.prepare(`
        SELECT * FROM managed_group_automation_occurrences WHERE id = ?
      `).get(occurrenceId);
  return rowToGroupAutomationOccurrence(row);
}

const terminalGroupAutomationStages = new Set([
  "sent",
  "skipped",
  "failed",
  "delivery_unknown",
  "canceled"
]);

const allowedGroupAutomationStageTransitions = new Map([
  ["waiting_target", new Set(["evaluating", "failed", "canceled"])],
  ["evaluating", new Set(["retry_wait", "send_pending", "skipped", "failed", "canceled"])],
  ["send_pending", new Set(["sending", "skipped", "failed", "canceled"])],
  ["sending", new Set(["awaiting_confirmation", "sent", "delivery_unknown", "failed"])],
  ["awaiting_confirmation", new Set(["sent", "failed", "delivery_unknown"])],
  ["retry_wait", new Set(["evaluating", "send_pending", "failed", "canceled"])]
]);

function isUnfinishedGroupAutomationOccurrenceSql(alias = "occurrence") {
  return `(
    (${alias}.stage != 'legacy' AND ${alias}.stage NOT IN ('sent','skipped','failed','delivery_unknown','canceled'))
    OR (${alias}.stage = 'legacy' AND ${alias}.status IN ('pending','evaluating','sending','retry_wait'))
  )`;
}

export function prepareGroupAutomationOccurrences({
  now: nowIso = now(),
  horizonMs = 600_000,
  limit = 10
} = {}) {
  const clock = new Date(nowIso);
  if (Number.isNaN(clock.getTime())) throw new Error("invalid group automation preparation time");
  const timestamp = clock.toISOString();
  const prepareThrough = new Date(
    clock.getTime() + Math.max(0, Number(horizonMs) || 0)
  ).toISOString();
  const prepareLimit = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 10));
  const prepared = [];

  db.exec("BEGIN IMMEDIATE");
  try {
    const dueTasks = db.prepare(`
      SELECT task.*
      FROM managed_group_automation_tasks task
      WHERE task.enabled = 1 AND task.deleted_at IS NULL
        AND task.next_run_at IS NOT NULL AND task.next_run_at <= ?
        AND NOT EXISTS (
          SELECT 1 FROM managed_group_automation_occurrences occurrence
          WHERE occurrence.task_id = task.id
            AND ${isUnfinishedGroupAutomationOccurrenceSql("occurrence")}
        )
      ORDER BY task.next_run_at ASC, task.created_at ASC, task.id ASC
      LIMIT ?
    `).all(prepareThrough, prepareLimit);
    for (const taskRow of dueTasks) {
      const scheduledFor = taskRow.next_run_at;
      const cycle = groupAutomationCycleWindow(taskRow.cadence, scheduledFor);
      const occurrenceId = crypto.randomUUID();
      const snapshot = buildGroupAutomationTaskSnapshot(taskRow);
      const inserted = db.prepare(`
        INSERT OR IGNORE INTO managed_group_automation_occurrences (
          id, task_id, bot_id, group_id, scheduled_for, cycle_key,
          cycle_start_at, cycle_end_at, status, attempts, lease_expires_at,
          mention_role_ids_json, task_snapshot_json, history_start_at,
          history_end_at, preanalysis_cutoff_at, stage, stage_attempts,
          stage_attempts_json, lease_owner, heartbeat_at,
          frozen_payload_json, retry_metadata_json, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?, ?, ?, NULL,
          'waiting_target', 0, '{}', '', NULL, '{}', '{}', ?, ?
        )
      `).run(
        occurrenceId,
        taskRow.id,
        taskRow.bot_id,
        taskRow.group_id,
        scheduledFor,
        cycle.cycleKey,
        cycle.startAt,
        cycle.endAt,
        json(snapshot.mentionRoleIds),
        json(snapshot),
        cycle.startAt,
        scheduledFor,
        timestamp,
        timestamp
      );
      const schedule = {
        cadence: taskRow.cadence,
        scheduleDays: parseJson(taskRow.schedule_days_json) || [],
        timeOfDay: taskRow.time_of_day
      };
      db.prepare(`
        UPDATE managed_group_automation_tasks
        SET next_run_at = ?, updated_at = ?
        WHERE id = ? AND next_run_at = ?
      `).run(
        nextGroupAutomationRunAt(schedule, scheduledFor),
        timestamp,
        taskRow.id,
        scheduledFor
      );
      if (inserted.changes) {
        prepared.push(getGroupAutomationOccurrence({ occurrenceId }));
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return prepared;
}

export function recoverLegacyGroupAutomationOccurrences({ now: nowIso = now() } = {}) {
  const timestamp = new Date(nowIso);
  if (Number.isNaN(timestamp.getTime())) throw new Error("invalid group automation recovery time");
  const result = db.prepare(`
    UPDATE managed_group_automation_occurrences
    SET stage = 'waiting_target', status = 'pending', lease_owner = '',
        lease_expires_at = NULL, heartbeat_at = NULL, execution_token = NULL,
        next_retry_at = NULL, updated_at = ?
    WHERE stage IN ('preanalysis_pending','preanalysis','delta_analysis','finalizing')
  `).run(timestamp.toISOString());
  return Number(result.changes || 0);
}

export function claimDueGroupAutomationOccurrences({
  owner,
  now: nowIso = now(),
  leaseMs = 300_000,
  limit = 10
} = {}) {
  const normalizedOwner = String(owner || "").trim();
  if (!normalizedOwner) throw new Error("group automation occurrence owner is required");
  const clock = new Date(nowIso);
  if (Number.isNaN(clock.getTime())) throw new Error("invalid group automation claim time");
  const timestamp = clock.toISOString();
  const leaseExpiresAt = new Date(
    clock.getTime() + Math.max(1000, Number(leaseMs) || 0)
  ).toISOString();
  const claimLimit = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 10));
  const claimed = [];

  db.exec("BEGIN IMMEDIATE");
  try {
    const candidates = db.prepare(`
      SELECT occurrence.*
      FROM managed_group_automation_occurrences occurrence
      JOIN managed_group_automation_tasks task ON task.id = occurrence.task_id
      WHERE task.enabled = 1 AND task.deleted_at IS NULL
        AND (
          (occurrence.stage = 'waiting_target' AND occurrence.scheduled_for <= ?)
          OR (occurrence.stage = 'evaluating' AND occurrence.lease_expires_at <= ?)
          OR (occurrence.stage = 'retry_wait' AND occurrence.next_retry_at <= ?)
          OR (occurrence.stage = 'send_pending' AND (
            (occurrence.lease_owner != '' AND occurrence.lease_expires_at <= ?)
            OR (occurrence.lease_owner = '' AND (
              occurrence.next_retry_at IS NULL OR occurrence.next_retry_at <= ?
            ))
          ))
        )
        AND NOT EXISTS (
          SELECT 1 FROM managed_group_automation_occurrences active
          WHERE active.task_id = occurrence.task_id AND active.id != occurrence.id
            AND active.scheduled_for < occurrence.scheduled_for
            AND ${isUnfinishedGroupAutomationOccurrenceSql("active")}
        )
      ORDER BY occurrence.scheduled_for ASC, occurrence.id ASC
      LIMIT ?
    `).all(timestamp, timestamp, timestamp, timestamp, timestamp, claimLimit);
    for (const candidate of candidates) {
      const retryMetadata = parseJson(candidate.retry_metadata_json) || {};
      const targetStage = candidate.stage === "send_pending"
        || (candidate.stage === "retry_wait" && retryMetadata.retryStage === "send_pending")
        ? "send_pending"
        : "evaluating";
      const attemptsByStage = parseJson(candidate.stage_attempts_json) || {};
      const nextAttempts = Number(attemptsByStage[targetStage] || 0) + 1;
      attemptsByStage[targetStage] = nextAttempts;
      const updated = db.prepare(`
        UPDATE managed_group_automation_occurrences
        SET stage = ?, status = ?,
            stage_attempts = stage_attempts + 1, stage_attempts_json = ?,
            lease_owner = ?, lease_expires_at = ?, heartbeat_at = ?,
            execution_token = ?, attempts = attempts + 1, next_retry_at = NULL,
            actual_started_at = COALESCE(actual_started_at, ?),
            started_at = COALESCE(started_at, ?), updated_at = ?
        WHERE id = ? AND (
          (stage = 'waiting_target' AND scheduled_for <= ?)
          OR (stage = 'evaluating' AND lease_expires_at <= ?)
          OR (stage = 'retry_wait' AND next_retry_at <= ?)
          OR (stage = 'send_pending' AND (
            (lease_owner != '' AND lease_expires_at <= ?)
            OR (lease_owner = '' AND (next_retry_at IS NULL OR next_retry_at <= ?))
          ))
        )
      `).run(
        targetStage,
        targetStage === "send_pending" ? "pending" : "evaluating",
        json(attemptsByStage),
        normalizedOwner,
        leaseExpiresAt,
        timestamp,
        normalizedOwner,
        timestamp,
        timestamp,
        timestamp,
        candidate.id,
        timestamp,
        timestamp,
        timestamp,
        timestamp,
        timestamp
      );
      if (!updated.changes) continue;
      db.prepare(`
        INSERT INTO managed_group_automation_attempts (
          occurrence_id, bot_id, group_id, stage, attempt_number,
          status, error_message, started_at, finished_at, created_at
        ) VALUES (?, ?, ?, ?, ?, 'processing', '', ?, NULL, ?)
      `).run(
        candidate.id,
        candidate.bot_id,
        candidate.group_id,
        targetStage,
        nextAttempts,
        timestamp,
        timestamp
      );
      claimed.push(getGroupAutomationOccurrence({ occurrenceId: candidate.id }));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return claimed;
}

export function validateGroupAutomationEvidenceMessageIds({
  botId,
  groupId,
  messageIds = []
}) {
  const requested = [...new Set((Array.isArray(messageIds) ? messageIds : [])
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!requested.length) return { validIds: [], invalidIds: [] };
  const group = getGroupById({ botId, groupId });
  if (!group) return { validIds: [], invalidIds: requested };
  const placeholders = requested.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT id
    FROM conversation_messages
    WHERE bot_id = ? AND conversation_key = ?
      AND id IN (${placeholders})
  `).all(botId, group.conversationKey, ...requested);
  const validSet = new Set(rows.map((row) => Number(row.id)));
  return {
    validIds: requested.filter((id) => validSet.has(id)),
    invalidIds: requested.filter((id) => !validSet.has(id))
  };
}

export function finalizeObsoleteGroupHistoryRemoval() {
  const prefix = `${["managed", "group"].join("_")}_`;
  const obsoleteTables = [
    "managed_group_history_sync_states",
    "managed_group_automation_chunks",
    `${prefix}fact_${"evidence"}`,
    `${prefix}fact_${"revisions"}`,
    `${prefix}${"facts"}`,
    `${prefix}fact_${"aggregates"}`,
    `${prefix}ledger_${"states"}`,
    `${prefix}ledger_${"jobs"}`,
    `${prefix}automation_cycle_${"states"}`
  ];
  const placeholders = obsoleteTables.map(() => "?").join(", ");
  const existing = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN (${placeholders})
  `).all(...obsoleteTables);
  if (!existing.length) return { removed: false };
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const table of obsoleteTables) db.exec(`DROP TABLE IF EXISTS ${table}`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { removed: true };
}

const groupAutomationOccurrencePatchColumns = new Map([
  ["historyStartAt", ["history_start_at", (value) => String(value || "")]],
  ["historyEndAt", ["history_end_at", (value) => String(value || "")]],
  ["preanalysisCutoffAt", ["preanalysis_cutoff_at", (value) => String(value || "")]],
  ["taskSnapshot", ["task_snapshot_json", (value) => json(value || {})]],
  ["decisionNote", ["decision_note", (value) => String(value || "")]],
  ["evidenceMessageIds", ["evidence_message_ids_json", (value) => json(Array.isArray(value) ? value : [])]],
  ["frozenPayload", ["frozen_payload_json", (value) => json(value || {})]],
  ["deliveryState", ["delivery_state", (value) => String(value || "")]],
  ["actualStartedAt", ["actual_started_at", (value) => value ? String(value) : null]],
  ["actualCompletedAt", ["actual_completed_at", (value) => value ? String(value) : null]],
  ["targetDelayMs", ["target_delay_ms", (value) => value == null ? null : Number(value)]],
  ["retryMetadata", ["retry_metadata_json", (value) => json(value || {})]],
  ["nextRetryAt", ["next_retry_at", (value) => value ? String(value) : null]],
  ["errorMessage", ["error_message", (value) => String(value || "")]],
  ["conditionAchieved", ["condition_achieved", (value) => value == null ? null : value ? 1 : 0]],
  ["renderedContent", ["rendered_content", (value) => String(value || "")]],
  ["mentionRoleIds", ["mention_role_ids_json", (value) => json(Array.isArray(value) ? value : [])]],
  ["mentionNames", ["mention_names_json", (value) => json(Array.isArray(value) ? value : [])]],
  ["warnings", ["warnings_json", (value) => json(Array.isArray(value) ? value : [])]]
  , ["channelMessageId", ["channel_message_id", (value) => String(value || "")]]
  , ["channelResponse", ["channel_response_json", (value) => value == null ? null : json(value)]]
]);

export function transitionGroupAutomationOccurrence({
  occurrenceId,
  owner,
  fromStages,
  toStage,
  patch = {},
  now: nowIso = now()
}) {
  const occurrence = getGroupAutomationOccurrence({ occurrenceId });
  if (!occurrence) throw new Error("group automation occurrence not found");
  const allowedFrom = [...new Set((Array.isArray(fromStages) ? fromStages : [fromStages])
    .map((value) => String(value || "").trim()).filter(Boolean))];
  const targetStage = String(toStage || "").trim();
  if (!allowedFrom.includes(occurrence.stage)) {
    throw new Error("group automation occurrence stage no longer matches transition");
  }
  if (!allowedGroupAutomationStageTransitions.get(occurrence.stage)?.has(targetStage)) {
    throw new Error(`invalid group automation stage transition: ${occurrence.stage} -> ${targetStage}`);
  }
  const normalizedOwner = String(owner || "").trim();
  if (!normalizedOwner || occurrence.leaseOwner !== normalizedOwner) {
    throw new Error("group automation occurrence lease owner no longer owns this stage");
  }
  const timestamp = new Date(nowIso).toISOString();
  const assignments = ["stage = ?", "updated_at = ?"];
  const values = [targetStage, timestamp];
  for (const [key, value] of Object.entries(patch || {})) {
    const mapping = groupAutomationOccurrencePatchColumns.get(key);
    if (!mapping) throw new Error(`unsupported group automation occurrence patch: ${key}`);
    assignments.push(`${mapping[0]} = ?`);
    values.push(mapping[1](value));
  }
  const releasesLease = targetStage === "waiting_target"
    || targetStage === "awaiting_confirmation"
    || terminalGroupAutomationStages.has(targetStage);
  if (releasesLease) {
    assignments.push("lease_owner = ''", "lease_expires_at = NULL", "heartbeat_at = NULL", "execution_token = NULL");
  }
  if (terminalGroupAutomationStages.has(targetStage)) {
    assignments.push("status = ?");
    values.push(targetStage);
    assignments.push("actual_completed_at = COALESCE(actual_completed_at, ?)", "finished_at = COALESCE(finished_at, ?)");
    values.push(timestamp, timestamp);
  }
  const placeholders = allowedFrom.map(() => "?").join(", ");
  const result = db.prepare(`
    UPDATE managed_group_automation_occurrences
    SET ${assignments.join(", ")}
    WHERE id = ? AND lease_owner = ? AND stage IN (${placeholders})
  `).run(...values, occurrence.id, normalizedOwner, ...allowedFrom);
  if (!result.changes) throw new Error("group automation occurrence lease owner no longer owns this stage");
  return getGroupAutomationOccurrence({ occurrenceId });
}

export function heartbeatGroupAutomationOccurrence({
  occurrenceId,
  owner,
  now: nowIso = now(),
  leaseMs = 300_000
}) {
  const normalizedOwner = String(owner || "").trim();
  const clock = new Date(nowIso);
  if (!normalizedOwner || Number.isNaN(clock.getTime())) {
    throw new Error("valid group automation occurrence heartbeat owner and time are required");
  }
  const timestamp = clock.toISOString();
  const leaseExpiresAt = new Date(clock.getTime() + Math.max(1000, Number(leaseMs) || 0))
    .toISOString();
  const result = db.prepare(`
    UPDATE managed_group_automation_occurrences
    SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ?
    WHERE id = ? AND lease_owner = ?
      AND stage NOT IN ('waiting_target','sent','skipped','failed','delivery_unknown','canceled')
  `).run(timestamp, leaseExpiresAt, timestamp, occurrenceId, normalizedOwner);
  if (!result.changes) throw new Error("group automation occurrence lease owner no longer owns this stage");
  return getGroupAutomationOccurrence({ occurrenceId });
}

export function listGroupAutomationOccurrences({
  botId,
  taskId,
  page = 1,
  pageSize = 20
}) {
  const normalizedPage = normalizePage(page);
  const normalizedPageSize = normalizePageSize(pageSize, 20, 100);
  const total = Number(db.prepare(`
    SELECT COUNT(*) AS total
    FROM managed_group_automation_occurrences
    WHERE bot_id = ? AND task_id = ?
  `).get(botId, taskId)?.total || 0);
  const items = db.prepare(`
    SELECT *
    FROM managed_group_automation_occurrences
    WHERE bot_id = ? AND task_id = ?
    ORDER BY scheduled_for DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(
    botId,
    taskId,
    normalizedPageSize,
    (normalizedPage - 1) * normalizedPageSize
  ).map(rowToGroupAutomationOccurrence);
  return {
    items,
    pagination: paginationResult({ total, page: normalizedPage, pageSize: normalizedPageSize })
  };
}

function insertConfirmedGroupAutomationOutbound(occurrence, confirmedAt = now()) {
  const frozenPayload = occurrence?.frozenPayload || {};
  const content = String(frozenPayload.content || occurrence?.renderedContent || "").trim();
  if (!content) throw new Error("confirmed group automation content is unavailable");
  const group = getGroupById({ botId: occurrence.botId, groupId: occurrence.groupId });
  if (!group) throw new Error("confirmed group automation group is unavailable");
  const existing = db.prepare(`
    SELECT id FROM conversation_messages
    WHERE bot_id = ? AND conversation_key = ?
      AND json_extract(raw_payload_json, '$.source') = 'group_automation'
      AND json_extract(raw_payload_json, '$.occurrenceId') = ?
    LIMIT 1
  `).get(occurrence.botId, group.conversationKey, occurrence.id);
  if (existing) return existing.id;
  const result = db.prepare(`
    INSERT INTO conversation_messages (
      bot_id, conversation_key, direction, sender_name, content, raw_payload_json, created_at
    ) VALUES (?, ?, 'outbound', '机器人', ?, ?, ?)
  `).run(
    occurrence.botId,
    group.conversationKey,
    content,
    json({
      source: "group_automation",
      occurrenceId: occurrence.id,
      taskId: occurrence.taskId,
      atList: frozenPayload.atList || occurrence.mentionNames || [],
      messageId: occurrence.channelMessageId
    }),
    new Date(confirmedAt).toISOString()
  );
  return Number(result.lastInsertRowid);
}

export function markGroupAutomationSendUnknown({
  occurrenceId,
  owner,
  transportReference = "",
  error = "",
  now: nowIso = now()
}) {
  const occurrence = getGroupAutomationOccurrence({ occurrenceId });
  if (!occurrence) throw new Error("group automation occurrence not found");
  return transitionGroupAutomationOccurrence({
    occurrenceId,
    owner,
    fromStages: ["sending"],
    toStage: "delivery_unknown",
    patch: {
      deliveryState: "unknown",
      errorMessage: String(error || "group automation delivery result is unknown"),
      retryMetadata: {
        ...(occurrence.retryMetadata || {}),
        transportReference: String(transportReference || ""),
        unknownAt: new Date(nowIso).toISOString()
      }
    },
    now: nowIso
  });
}

export function confirmGroupAutomationDelivery({
  botId,
  occurrenceId,
  delivered = true,
  operatorId,
  now: nowIso = now()
}) {
  const occurrence = getGroupAutomationOccurrence({ botId, occurrenceId });
  if (!occurrence) throw new Error("group automation occurrence not found");
  const normalizedOperatorId = String(operatorId || "").trim();
  if (!normalizedOperatorId) throw new Error("group automation delivery operator is required");
  if (delivered && occurrence.stage === "sent") return occurrence;
  if (!delivered && occurrence.stage === "send_pending") return occurrence;
  if (!delivered) throw new Error("use prepareManualGroupAutomationRetry to confirm non-delivery");
  if (!["delivery_unknown", "awaiting_confirmation"].includes(occurrence.stage)) {
    throw new Error("group automation occurrence is not awaiting delivery resolution");
  }
  const timestamp = new Date(nowIso).toISOString();
  const retryMetadata = {
    ...(occurrence.retryMetadata || {}),
    deliveryResolution: {
      delivered: true,
      operatorId: normalizedOperatorId,
      resolvedAt: timestamp
    }
  };
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db.prepare(`
      UPDATE managed_group_automation_occurrences
      SET stage = 'sent', status = 'sent', delivery_state = 'confirmed',
          retry_metadata_json = ?, actual_completed_at = COALESCE(actual_completed_at, ?),
          finished_at = COALESCE(finished_at, ?), error_message = '', updated_at = ?
      WHERE bot_id = ? AND id = ? AND stage IN ('delivery_unknown','awaiting_confirmation')
    `).run(json(retryMetadata), timestamp, timestamp, timestamp, botId, occurrenceId);
    if (!result.changes) throw new Error("group automation delivery resolution changed concurrently");
    const updated = getGroupAutomationOccurrence({ botId, occurrenceId });
    insertConfirmedGroupAutomationOutbound(updated, timestamp);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getGroupAutomationOccurrence({ botId, occurrenceId });
}

export function prepareManualGroupAutomationRetry({
  botId,
  occurrenceId,
  operatorId,
  now: nowIso = now()
}) {
  const occurrence = getGroupAutomationOccurrence({ botId, occurrenceId });
  if (!occurrence) throw new Error("group automation occurrence not found");
  const normalizedOperatorId = String(operatorId || "").trim();
  if (!normalizedOperatorId) throw new Error("group automation delivery operator is required");
  if (
    occurrence.stage === "send_pending"
    && occurrence.retryMetadata?.manualRetry?.operatorId === normalizedOperatorId
  ) return occurrence;
  if (occurrence.stage !== "delivery_unknown") {
    throw new Error("only an unknown delivery can be confirmed not delivered and retried");
  }
  const timestamp = new Date(nowIso).toISOString();
  const retryMetadata = {
    ...(occurrence.retryMetadata || {}),
    retryStage: "send_pending",
    manualRetry: {
      confirmedNotDelivered: true,
      operatorId: normalizedOperatorId,
      requestedAt: timestamp
    }
  };
  const result = db.prepare(`
    UPDATE managed_group_automation_occurrences
    SET stage = 'send_pending', status = 'pending', delivery_state = 'manual_retry_pending',
        retry_metadata_json = ?, lease_owner = '', lease_expires_at = NULL,
        heartbeat_at = NULL, execution_token = NULL, next_retry_at = ?,
        error_message = '', actual_completed_at = NULL, finished_at = NULL, updated_at = ?
    WHERE bot_id = ? AND id = ? AND stage = 'delivery_unknown'
  `).run(json(retryMetadata), timestamp, timestamp, botId, occurrenceId);
  if (!result.changes) throw new Error("group automation manual retry changed concurrently");
  return getGroupAutomationOccurrence({ botId, occurrenceId });
}

export function updateGroupAutomationOccurrenceFromCommandCallback({
  botId,
  messageId,
  payload = {}
}) {
  const normalizedBotId = String(botId || "").trim();
  const normalizedMessageId = String(messageId || "").trim();
  if (!normalizedBotId || !normalizedMessageId) return null;
  const occurrence = rowToGroupAutomationOccurrence(db.prepare(`
    SELECT *
    FROM managed_group_automation_occurrences
    WHERE bot_id = ? AND channel_message_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(normalizedBotId, normalizedMessageId));
  if (!occurrence) return null;
  const errorCode = Number(payload.errorCode ?? 0);
  if (occurrence.stage === "awaiting_confirmation" && errorCode === 0) {
    return confirmGroupAutomationDelivery({
      botId: normalizedBotId,
      occurrenceId: occurrence.id,
      delivered: true,
      operatorId: "channel_webhook",
      now: now()
    });
  }
  if (errorCode === 0) return occurrence;
  const timestamp = now();
  db.prepare(`
    UPDATE managed_group_automation_occurrences
    SET status = 'failed', stage = CASE
          WHEN stage = 'awaiting_confirmation' THEN 'failed'
          ELSE stage
        END,
        channel_response_json = ?,
        error_message = ?,
        finished_at = COALESCE(finished_at, ?),
        updated_at = ?
    WHERE bot_id = ? AND id = ?
  `).run(
    json(payload),
    String(payload.errorReason || `Channel command failed (${errorCode})`),
    timestamp,
    timestamp,
    normalizedBotId,
    occurrence.id
  );
  return rowToGroupAutomationOccurrence(db.prepare(`
    SELECT * FROM managed_group_automation_occurrences WHERE bot_id = ? AND id = ?
  `).get(normalizedBotId, occurrence.id));
}

export function updateGroupAutomationOccurrenceFromChannelStatus({ botId, messageId, status }) {
  const occurrence = rowToGroupAutomationOccurrence(db.prepare(`
    SELECT * FROM managed_group_automation_occurrences
    WHERE bot_id = ? AND channel_message_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(String(botId || ""), String(messageId || "")));
  if (!occurrence) return null;
  const normalizedStatus = String(status || "").toLowerCase();
  if (["delivered", "read", "played"].includes(normalizedStatus)) {
    return confirmGroupAutomationDelivery({
      botId,
      occurrenceId: occurrence.id,
      delivered: true,
      operatorId: `whapi_status:${normalizedStatus}`
    });
  }
  return occurrence;
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
      INSERT OR IGNORE INTO managed_group_tag_groups (
        group_id, bot_id, tag_group_id, is_system, created_at
      )
      SELECT ?, bot_id, tag_group_id, is_system, created_at
      FROM managed_group_tag_groups
      WHERE bot_id = ? AND group_id = ?
    `).run(targetGroupId, botId, sourceGroupId);

    const sourceRoles = db.prepare(`
      SELECT * FROM managed_group_roles
      WHERE bot_id = ? AND group_id = ?
    `).all(botId, sourceGroupId);
    for (const sourceRole of sourceRoles) {
      const targetRole = db.prepare(`
        SELECT id FROM managed_group_roles
        WHERE bot_id = ? AND group_id = ? AND current_name = ?
      `).get(botId, targetGroupId, sourceRole.current_name);
      if (!targetRole) {
        db.prepare(`
          UPDATE managed_group_roles SET group_id = ?, updated_at = ? WHERE id = ?
        `).run(targetGroupId, timestamp, sourceRole.id);
        db.prepare(`
          UPDATE managed_group_role_aliases SET group_id = ? WHERE role_id = ?
        `).run(targetGroupId, sourceRole.id);
        continue;
      }
      db.prepare(`
        INSERT OR IGNORE INTO managed_group_automation_mentions (task_id, role_id, ordinal)
        SELECT task_id, ?, ordinal
        FROM managed_group_automation_mentions
        WHERE role_id = ?
      `).run(targetRole.id, sourceRole.id);
      db.prepare(`DELETE FROM managed_group_automation_mentions WHERE role_id = ?`)
        .run(sourceRole.id);
      db.prepare(`
        INSERT OR IGNORE INTO managed_group_role_aliases (
          role_id, group_id, bot_id, alias_value, created_at
        )
        SELECT ?, ?, bot_id, alias_value, created_at
        FROM managed_group_role_aliases
        WHERE role_id = ?
      `).run(targetRole.id, targetGroupId, sourceRole.id);
      db.prepare(`DELETE FROM managed_group_role_aliases WHERE role_id = ?`).run(sourceRole.id);
      db.prepare(`DELETE FROM managed_group_roles WHERE id = ?`).run(sourceRole.id);
    }

    db.prepare(`
      UPDATE managed_group_automation_tasks
      SET group_id = ?, updated_at = ?
      WHERE bot_id = ? AND group_id = ?
    `).run(targetGroupId, timestamp, botId, sourceGroupId);
    db.prepare(`
      UPDATE managed_group_automation_occurrences
      SET group_id = ?, updated_at = ?
      WHERE bot_id = ? AND group_id = ?
    `).run(targetGroupId, timestamp, botId, sourceGroupId);
    db.prepare(`
      UPDATE managed_group_automation_attempts
      SET group_id = ?
      WHERE bot_id = ? AND group_id = ?
    `).run(targetGroupId, botId, sourceGroupId);
    db.prepare(`
      UPDATE conversation_messages
      SET conversation_key = ?
      WHERE bot_id = ? AND conversation_key = ?
    `).run(target.conversationKey, botId, source.conversationKey);

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
  if (messageId) {
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
      messageId: "",
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

function rowToChannelAccount(row) {
  if (!row) return null;
  return {
    botId: row.bot_id,
    provider: row.provider,
    channelId: row.channel_id,
    publicId: row.public_id,
    tokenConfigured: Boolean(row.token_ciphertext),
    tokenSuffix: row.token_suffix || "",
    enabled: Boolean(row.enabled),
    providerStatus: row.provider_status || "",
    healthStatus: row.health_status || "disconnected",
    lastHealthCheckAt: row.last_health_check_at || "",
    lastWebhookAt: row.last_webhook_at || "",
    lastError: row.last_error || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createChannelAccount({
  botId,
  provider,
  channelId,
  encryptedToken,
  webhookSecretHash,
  enabled = true,
  publicId = crypto.randomUUID()
}) {
  const normalizedBotId = requiredString(botId, "botId");
  const normalizedProvider = requiredString(provider, "provider");
  const normalizedChannelId = requiredString(channelId, "channelId");
  const normalizedPublicId = requiredString(publicId, "publicId");
  const credentials = normalizeEncryptedToken(encryptedToken);
  const secretHash = requiredString(webhookSecretHash, "webhookSecretHash");
  const timestamp = now();
  db.prepare(`
    INSERT INTO channel_accounts (
      bot_id, provider, channel_id, public_id,
      token_ciphertext, token_iv, token_auth_tag, token_suffix,
      webhook_secret_hash, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    normalizedBotId,
    normalizedProvider,
    normalizedChannelId,
    normalizedPublicId,
    credentials.ciphertext,
    credentials.iv,
    credentials.authTag,
    credentials.suffix,
    secretHash,
    enabled === false ? 0 : 1,
    timestamp,
    timestamp
  );
  return getChannelAccount(normalizedBotId);
}

export function updateChannelAccountToken({ botId, encryptedToken }) {
  const normalizedBotId = requiredString(botId, "botId");
  const credentials = normalizeEncryptedToken(encryptedToken);
  const result = db.prepare(`
    UPDATE channel_accounts
    SET token_ciphertext = ?, token_iv = ?, token_auth_tag = ?, token_suffix = ?, updated_at = ?
    WHERE bot_id = ?
  `).run(
    credentials.ciphertext,
    credentials.iv,
    credentials.authTag,
    credentials.suffix,
    now(),
    normalizedBotId
  );
  if (result.changes === 0) throw new Error("channel account not found");
  return getChannelAccount(normalizedBotId);
}

export function updateChannelAccount({ botId, enabled, webhookSecretHash }) {
  const account = getChannelAccount(requiredString(botId, "botId"));
  if (!account) throw new Error("channel account not found");
  const credentials = getChannelAccountCredentials(botId);
  db.prepare(`
    UPDATE channel_accounts
    SET enabled = ?, webhook_secret_hash = ?, updated_at = ?
    WHERE bot_id = ?
  `).run(
    enabled === undefined ? (account.enabled ? 1 : 0) : (enabled === false ? 0 : 1),
    webhookSecretHash === undefined
      ? credentials.webhookSecretHash
      : requiredString(webhookSecretHash, "webhookSecretHash"),
    now(),
    botId
  );
  return getChannelAccount(botId);
}

export function getChannelAccount(botId) {
  return rowToChannelAccount(
    db.prepare("SELECT * FROM channel_accounts WHERE bot_id = ?").get(botId)
  );
}

export function getChannelAccountByPublicId(publicId) {
  return rowToChannelAccount(
    db.prepare("SELECT * FROM channel_accounts WHERE public_id = ?").get(publicId)
  );
}

export function getChannelAccountByChannelId(provider, channelId) {
  return rowToChannelAccount(
    db.prepare("SELECT * FROM channel_accounts WHERE provider = ? AND channel_id = ?")
      .get(provider, channelId)
  );
}

export function getChannelAccountCredentials(botId) {
  const row = db.prepare("SELECT * FROM channel_accounts WHERE bot_id = ?").get(botId);
  if (!row) return null;
  return {
    botId: row.bot_id,
    provider: row.provider,
    channelId: row.channel_id,
    encryptedToken: {
      ciphertext: row.token_ciphertext,
      iv: row.token_iv,
      authTag: row.token_auth_tag,
      suffix: row.token_suffix
    },
    webhookSecretHash: row.webhook_secret_hash
  };
}

export function listChannelAccounts() {
  return db.prepare("SELECT * FROM channel_accounts ORDER BY updated_at DESC").all().map(rowToChannelAccount);
}

export function updateChannelAccountHealth({
  botId,
  healthStatus,
  providerStatus = "",
  checkedAt = now(),
  lastError = ""
}) {
  const result = db.prepare(`
    UPDATE channel_accounts
    SET health_status = ?, provider_status = ?, last_health_check_at = ?, last_error = ?, updated_at = ?
    WHERE bot_id = ?
  `).run(
    requiredString(healthStatus, "healthStatus"),
    String(providerStatus || ""),
    checkedAt,
    String(lastError || ""),
    now(),
    requiredString(botId, "botId")
  );
  if (result.changes === 0) throw new Error("channel account not found");
  return getChannelAccount(botId);
}

export function markChannelAccountWebhookSuccess({ botId, receivedAt = now() }) {
  const result = db.prepare(`
    UPDATE channel_accounts SET last_webhook_at = ?, updated_at = ? WHERE bot_id = ?
  `).run(receivedAt, now(), requiredString(botId, "botId"));
  if (result.changes === 0) throw new Error("channel account not found");
  return getChannelAccount(botId);
}

export function recordChannelWebhookEvent({
  provider,
  botId,
  channelAccountId,
  eventKind,
  method,
  externalId = "",
  idempotencyKey,
  payload,
  receivedAt = now()
}) {
  const normalizedBotId = requiredString(botId, "botId");
  const normalizedKey = requiredString(idempotencyKey, "idempotencyKey");
  const result = db.prepare(`
    INSERT INTO channel_webhook_events (
      provider, bot_id, channel_account_id, event_kind, request_method,
      external_id, idempotency_key, payload_json, received_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bot_id, idempotency_key) DO NOTHING
  `).run(
    requiredString(provider, "provider"),
    normalizedBotId,
    requiredString(channelAccountId, "channelAccountId"),
    requiredString(eventKind, "eventKind"),
    requiredString(method, "method").toUpperCase(),
    String(externalId || ""),
    normalizedKey,
    json(payload),
    receivedAt,
    receivedAt
  );
  const row = db.prepare(`
    SELECT id FROM channel_webhook_events WHERE bot_id = ? AND idempotency_key = ?
  `).get(normalizedBotId, normalizedKey);
  return Object.freeze({ inserted: result.changes === 1, eventId: row.id });
}

export function listChannelWebhookEvents(botId) {
  return db.prepare(`
    SELECT * FROM channel_webhook_events WHERE bot_id = ? ORDER BY id ASC
  `).all(requiredString(botId, "botId")).map(rowToChannelWebhookEvent);
}

function rowToChannelWebhookEvent(row) {
  return {
    id: row.id,
    provider: row.provider,
    botId: row.bot_id,
    channelAccountId: row.channel_account_id,
    eventKind: row.event_kind,
    method: row.request_method,
    externalId: row.external_id,
    idempotencyKey: row.idempotency_key,
    payload: parseJson(row.payload_json),
    state: row.state,
    attempts: Number(row.attempts || 0),
    errorMessage: row.error_message || "",
    receivedAt: row.received_at,
    processedAt: row.processed_at || "",
    updatedAt: row.updated_at
  };
}

export function claimChannelWebhookEvents({ owner, limit = 10, leaseMs = 60_000, nowIso = now() }) {
  const normalizedOwner = requiredString(owner, "owner");
  const count = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 10));
  const leaseExpiresAt = new Date(new Date(nowIso).getTime() + Math.max(1000, Number(leaseMs) || 60_000)).toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const candidates = db.prepare(`
      SELECT id FROM channel_webhook_events
      WHERE state = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= ?)
      ORDER BY id ASC LIMIT ?
    `).all(nowIso, count);
    const claimed = [];
    const update = db.prepare(`
      UPDATE channel_webhook_events
      SET state = 'processing', attempts = attempts + 1, lease_owner = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND state = 'pending'
    `);
    const select = db.prepare("SELECT * FROM channel_webhook_events WHERE id = ?");
    for (const candidate of candidates) {
      if (update.run(normalizedOwner, leaseExpiresAt, nowIso, candidate.id).changes === 1) {
        claimed.push(rowToChannelWebhookEvent(select.get(candidate.id)));
      }
    }
    db.exec("COMMIT");
    return claimed;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function completeChannelWebhookEvent({ id, owner, processedAt = now() }) {
  const result = db.prepare(`
    UPDATE channel_webhook_events
    SET state = 'completed', lease_owner = NULL, lease_expires_at = NULL,
        next_retry_at = NULL, error_message = '', processed_at = ?, updated_at = ?
    WHERE id = ? AND state = 'processing' AND lease_owner = ?
  `).run(processedAt, processedAt, id, requiredString(owner, "owner"));
  if (result.changes !== 1) throw new Error("channel webhook lease is not owned");
}

export function failChannelWebhookEvent({ id, owner, retryable, nextRetryAt = null, errorMessage = "" }) {
  const timestamp = now();
  const result = db.prepare(`
    UPDATE channel_webhook_events
    SET state = ?, lease_owner = NULL, lease_expires_at = NULL,
        next_retry_at = ?, error_message = ?, processed_at = ?, updated_at = ?
    WHERE id = ? AND state = 'processing' AND lease_owner = ?
  `).run(
    retryable ? "pending" : "failed",
    retryable ? nextRetryAt : null,
    String(errorMessage || "").slice(0, 160),
    retryable ? null : timestamp,
    timestamp,
    id,
    requiredString(owner, "owner")
  );
  if (result.changes !== 1) throw new Error("channel webhook lease is not owned");
}

export function recoverExpiredChannelWebhookLeases({ nowIso = now() } = {}) {
  return db.prepare(`
    UPDATE channel_webhook_events
    SET state = 'pending', lease_owner = NULL, lease_expires_at = NULL,
        next_retry_at = ?, updated_at = ?
    WHERE state = 'processing' AND lease_expires_at <= ?
  `).run(nowIso, nowIso, nowIso).changes;
}

function normalizeEncryptedToken(value) {
  if (!value || typeof value !== "object") throw new Error("encryptedToken is required");
  return {
    ciphertext: requiredString(value.ciphertext, "encryptedToken.ciphertext"),
    iv: requiredString(value.iv, "encryptedToken.iv"),
    authTag: requiredString(value.authTag, "encryptedToken.authTag"),
    suffix: String(value.suffix || "")
  };
}

function requiredString(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export function upsertAgent(agent) {
  const timestamp = now();
  const agentId = String(agent.agentId || "").trim();
  if (!agentId) throw new Error("agentId is required");
  const existing = getAgent(agentId);
  const dclawBaseUrl = (agent.dclawBaseUrl || "").replace(/\/$/, "");
  const dclawPublicId = agent.dclawPublicId || agentId;
  const agentApiUrl = buildAgentApiUrl(dclawBaseUrl, dclawPublicId, agent.agentApiUrl);
  const candidateApiKey = String(agent.agentApiKey ?? "").trim();
  const agentApiKey = !candidateApiKey || /^\*+$/.test(candidateApiKey)
    ? existing?.agentApiKey || ""
    : candidateApiKey;
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
    agentApiKey,
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
    "channel_webhook_events",
    "channel_accounts",
    "managed_group_automation_attempts",
    "managed_group_automation_occurrences",
    "managed_group_automation_tasks",
    "managed_group_role_aliases",
    "managed_group_roles",
    "managed_group_tag_groups",
    "managed_group_aliases",
    "managed_groups",
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
    deleted.managed_group_automation_mentions = db.prepare(`
      DELETE FROM managed_group_automation_mentions
      WHERE task_id IN (
        SELECT id FROM managed_group_automation_tasks WHERE bot_id = ?
      )
    `).run(normalizedBotId).changes;
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
        AND messages.source IN ('legacy_customer_history', 'legacy_api_history')
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
  const explicitKey = message?.metadata?.conversationKey;
  if (typeof explicitKey === "string" && explicitKey.length > 0) {
    return explicitKey;
  }
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
  provider = "",
  channelAccountId = "",
  deliveryStatus = "",
  channelResponse
}) {
  const channelResult = channelResponse?.channelResult;
  const channelIdentity = String(conversationKey || "").match(/^([^:]+):([^:]+):(private|group):/);
  const resolvedProvider = provider || (channelResult ? channelIdentity?.[1] || "" : "");
  const resolvedChannelAccountId = channelAccountId || (channelResult ? channelIdentity?.[2] || "" : "");
  const resolvedDeliveryStatus = deliveryStatus || (
    typeof channelResult?.status === "string" ? channelResult.status.toLowerCase() : ""
  );
  if (channelResult && resolvedProvider && resolvedChannelAccountId && messageId) {
    const existing = db.prepare(`
      SELECT * FROM outgoing_messages
      WHERE bot_id = ? AND conversation_key = ?
        AND provider = ? AND channel_account_id = ? AND message_id = ?
      ORDER BY id DESC LIMIT 1
    `).get(
      botId,
      conversationKey || "",
      resolvedProvider,
      resolvedChannelAccountId,
      messageId
    );
    if (existing) {
      const existingResponse = parseJson(existing.channel_response_json) || {};
      if (existingResponse.source === "channel_outbound_webhook") {
        const currentStatus = String(existing.delivery_status || "").toLowerCase();
        const canonicalStatus = String(resolvedDeliveryStatus || "").toLowerCase();
        const keepCanonicalStatus = (
          Object.hasOwn(CHANNEL_DELIVERY_STATUS_RANK, canonicalStatus)
          && CHANNEL_DELIVERY_STATUS_RANK[canonicalStatus] > (CHANNEL_DELIVERY_STATUS_RANK[currentStatus] || 0)
        );
        db.prepare(`
          UPDATE outgoing_messages
          SET agent_id = ?, target_name = ?, content = ?,
              delivery_status = ?, delivery_error = ?, delivery_updated_at = ?,
              channel_response_json = ?
          WHERE id = ?
        `).run(
          agentId || existing.agent_id || "",
          targetName || existing.target_name || "",
          content,
          keepCanonicalStatus ? canonicalStatus : currentStatus,
          keepCanonicalStatus ? "" : existing.delivery_error || "",
          keepCanonicalStatus ? now() : existing.delivery_updated_at,
          json(channelResponse),
          existing.id
        );
      }
      return;
    }
  }
  db.prepare(`
    INSERT INTO outgoing_messages (
      bot_id, agent_id, conversation_key, message_id, target_name, content,
      provider, channel_account_id, delivery_status, delivery_updated_at,
      channel_response_json, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    botId,
    agentId || "",
    conversationKey || "",
    messageId || "",
    targetName || "",
    content,
    resolvedProvider,
    resolvedChannelAccountId,
    resolvedDeliveryStatus,
    resolvedDeliveryStatus ? now() : null,
    json(channelResponse),
    now()
  );
}

export function persistReconciledOutboundMessage({
  botId,
  provider,
  channelAccountId,
  conversationKey,
  messageId,
  content,
  occurredAt,
  deliveryStatus,
  rawPayload,
  senderName = "机器人"
}) {
  const normalizedBotId = requiredString(botId, "botId");
  const normalizedProvider = requiredString(provider, "provider");
  const normalizedChannelAccountId = requiredString(channelAccountId, "channelAccountId");
  const normalizedConversationKey = requiredString(conversationKey, "conversationKey");
  const normalizedMessageId = requiredString(messageId, "messageId");
  const normalizedContent = requiredString(content, "content");
  const normalizedStatus = String(deliveryStatus || "sent").trim().toLowerCase();
  if (!Object.hasOwn(CHANNEL_DELIVERY_STATUS_RANK, normalizedStatus) || !normalizedStatus) {
    throw new Error("channel delivery status is invalid");
  }
  const timestamp = new Date(occurredAt).toISOString();
  const result = {
    outcome: "",
    conversationMessageId: null,
    outgoingInserted: false
  };

  db.exec("BEGIN IMMEDIATE");
  try {
    const conversation = db.prepare(`
      SELECT conversation_key
      FROM conversations
      WHERE conversation_key = ? AND bot_id = ?
    `).get(normalizedConversationKey, normalizedBotId);
    if (!conversation) {
      db.exec("COMMIT");
      return { ...result, outcome: "missing_conversation" };
    }

    const existingOutgoing = db.prepare(`
      SELECT id
      FROM outgoing_messages
      WHERE bot_id = ? AND conversation_key = ?
        AND provider = ? AND channel_account_id = ? AND message_id = ?
      ORDER BY id DESC LIMIT 1
    `).get(
      normalizedBotId,
      normalizedConversationKey,
      normalizedProvider,
      normalizedChannelAccountId,
      normalizedMessageId
    );
    if (existingOutgoing) {
      db.exec("COMMIT");
      return { ...result, outcome: "existing_outgoing" };
    }

    const existingConversationMessage = db.prepare(`
      SELECT id
      FROM conversation_messages
      WHERE bot_id = ? AND conversation_key = ?
        AND (
          json_extract(raw_payload_json, '$.messageId') = ?
          OR json_extract(raw_payload_json, '$.channelMessageId') = ?
          OR EXISTS (
            SELECT 1
            FROM json_each(json_extract(raw_payload_json, '$.channelMessageIds'))
            WHERE value = ?
          )
          OR EXISTS (
            SELECT 1
            FROM json_each(json_extract(raw_payload_json, '$.messageIds'))
            WHERE value = ?
          )
        )
      ORDER BY id DESC LIMIT 1
    `).get(
      normalizedBotId,
      normalizedConversationKey,
      normalizedMessageId,
      normalizedMessageId,
      normalizedMessageId,
      normalizedMessageId
    );

    let conversationMessageId = Number(existingConversationMessage?.id || 0) || null;
    if (!conversationMessageId) {
      const insertedConversation = db.prepare(`
        INSERT INTO conversation_messages (
          bot_id, conversation_key, direction, sender_name, content,
          raw_payload_json, created_at
        ) VALUES (?, ?, 'outbound', ?, ?, ?, ?)
      `).run(
        normalizedBotId,
        normalizedConversationKey,
        String(senderName || "机器人"),
        normalizedContent,
        json({
          source: "channel_outbound_webhook",
          messageId: normalizedMessageId,
          channelMessageId: normalizedMessageId,
          channelMessageIds: [normalizedMessageId],
          provider: normalizedProvider,
          channelAccountId: normalizedChannelAccountId,
          channelPayload: rawPayload || {}
        }),
        timestamp
      );
      conversationMessageId = Number(insertedConversation.lastInsertRowid);
    }

    db.prepare(`
      INSERT INTO outgoing_messages (
        bot_id, agent_id, conversation_key, message_id, target_name, content,
        provider, channel_account_id, delivery_status, delivery_updated_at,
        channel_response_json, created_at
      ) VALUES (?, '', ?, ?, '', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      normalizedBotId,
      normalizedConversationKey,
      normalizedMessageId,
      normalizedContent,
      normalizedProvider,
      normalizedChannelAccountId,
      normalizedStatus,
      timestamp,
      json({
        source: "channel_outbound_webhook",
        channelResult: {
          accepted: true,
          data: normalizedMessageId,
          status: normalizedStatus
        },
        channelPayload: rawPayload || {}
      }),
      timestamp
    );
    db.exec("COMMIT");
    return {
      outcome: existingConversationMessage ? "existing_conversation" : "inserted",
      conversationMessageId,
      outgoingInserted: true
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const CHANNEL_DELIVERY_STATUS_RANK = Object.freeze({
  "": 0,
  pending: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  played: 5,
  failed: 100
});

export function updateOutgoingMessageChannelStatus({
  botId,
  provider,
  channelAccountId,
  messageId,
  status,
  errorMessage = ""
}) {
  const normalizedStatus = String(status || "").toLowerCase();
  if (!Object.hasOwn(CHANNEL_DELIVERY_STATUS_RANK, normalizedStatus) || !normalizedStatus) {
    throw new Error("channel delivery status is invalid");
  }
  const row = db.prepare(`
    SELECT * FROM outgoing_messages
    WHERE bot_id = ? AND provider = ? AND channel_account_id = ? AND message_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(botId, provider, channelAccountId, messageId);
  if (!row) return null;
  const current = row.delivery_status || "";
  if (CHANNEL_DELIVERY_STATUS_RANK[normalizedStatus] > CHANNEL_DELIVERY_STATUS_RANK[current]) {
    db.prepare(`
      UPDATE outgoing_messages
      SET delivery_status = ?, delivery_error = ?, delivery_updated_at = ?
      WHERE id = ?
    `).run(
      normalizedStatus,
      normalizedStatus === "failed" ? String(errorMessage || "").slice(0, 160) : "",
      now(),
      row.id
    );
  }
  const updated = db.prepare("SELECT * FROM outgoing_messages WHERE id = ?").get(row.id);
  return {
    id: updated.id,
    botId: updated.bot_id,
    messageId: updated.message_id,
    provider: updated.provider,
    channelAccountId: updated.channel_account_id,
    deliveryStatus: updated.delivery_status,
    deliveryError: updated.delivery_error || "",
    deliveryUpdatedAt: updated.delivery_updated_at || ""
  };
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
    conversationKey: row.conversation_key || "",
    content: row.content,
    messageType: row.message_type || "text",
    messagePayload: parseJson(row.message_payload_json),
    status: row.status,
    attempts: row.attempts,
    messageId: row.message_id,
    errorMessage: row.error_message,
    channelResponse: parseJson(row.channel_response_json),
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
    conversationKey: row.conversation_key || "",
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
    intervalMinutes: Number(row.interval_minutes ?? 30),
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
    channelMessageIds: parseJson(row.channel_message_ids_json) || [],
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
    channelMessageId: row.channel_message_id || "",
    channelResponse: parseJson(row.channel_response_json),
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
    channelMessageIds: parseJson(row.channel_message_ids_json) || [],
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
  return new Date(baseMs + activationDelayMs(intervalMinutes, attemptNumber)).toISOString();
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
  if (row?.bot_id !== botId) throw new Error("flow session not found");
  if (row.current_node_id === "__conversation__") {
    const entryNodeId = String(machine?.entryNodeId || "").trim();
    if (!entryNodeId) throw new Error("flow entry node is required");
    db.prepare(`
      UPDATE flow_sessions
      SET current_node_id = ?,
          updated_at = ?
      WHERE conversation_key = ?
        AND bot_id = ?
        AND current_node_id = '__conversation__'
    `).run(entryNodeId, now(), conversationKey, botId);
    row = db.prepare("SELECT * FROM flow_sessions WHERE conversation_key = ?").get(conversationKey);
  }
  return rowToFlowSession(row);
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

export function beginFirstContactFlowEntry({
  botId,
  conversationKey,
  machine,
  occurredAt = now(),
  activationTask = null
}) {
  const normalizedBotId = String(botId || "").trim();
  const normalizedConversationKey = String(conversationKey || "").trim();
  const entryNodeId = String(machine?.entryNodeId || "").trim();
  if (!normalizedBotId || !normalizedConversationKey || !entryNodeId) {
    throw new Error("botId, conversationKey, and entryNodeId are required");
  }

  const occurredAtMs = Date.parse(occurredAt);
  const timestamp = Number.isFinite(occurredAtMs) ? new Date(occurredAtMs).toISOString() : now();

  db.exec("BEGIN IMMEDIATE");
  try {
    let row = db.prepare("SELECT * FROM flow_sessions WHERE conversation_key = ?")
      .get(normalizedConversationKey);
    if (!row) {
      db.prepare(`
        INSERT INTO flow_sessions (
          bot_id, conversation_key, current_node_id, collected_data_json, status,
          handoff_status, activation_generation, activation_state_json,
          last_message_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, 'active', 'ai', 1, NULL, ?, ?, ?)
      `).run(
        normalizedBotId,
        normalizedConversationKey,
        entryNodeId,
        json({}),
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

    db.exec("COMMIT");
    return { status: "existing", session: rowToFlowSession(row), task: null };
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

function nonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
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
    intervalMinutes: nonNegativeInteger(source.intervalMinutes, defaults.intervalMinutes),
    maxTimes: Math.max(1, Number.parseInt(source.maxTimes ?? defaults.maxTimes, 10) || defaults.maxTimes),
    ...(actionsAfterSend.length ? { actionsAfterSend } : {})
  };
}

export function normalizeActivationConfig(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const intervalMinutes = nonNegativeInteger(source.intervalMinutes, 30);
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
    message?.intervalMinutes ?? 30,
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

export function markFlowActivationTaskSent({ id, channelMessageIds = [] }) {
  const timestamp = now();
  const task = db.prepare("SELECT status FROM flow_activation_tasks WHERE id = ?").get(id);
  if (!task || !["processing", "canceled"].includes(task.status)) return null;
  const result = db.prepare(`
    UPDATE flow_activation_tasks
    SET status = 'sent',
        sent_at = ?,
        error_message = '',
        channel_message_ids_json = ?,
        updated_at = ?
    WHERE id = ?
      AND status IN ('processing', 'canceled')
  `).run(timestamp, json(channelMessageIds), timestamp, id);
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

export function markFlowActionExecutionSucceeded({ id, channelMessageId = "", channelResponse = null }) {
  const timestamp = now();
  const result = db.prepare(`
    UPDATE flow_action_executions
    SET status = 'success',
        channel_message_id = ?,
        channel_response_json = ?,
        error_message = '',
        finished_at = ?,
        updated_at = ?
    WHERE id = ?
      AND status = 'processing'
  `).run(String(channelMessageId || ""), json(channelResponse), timestamp, timestamp, id);
  if (result.changes === 0) return rowToFlowActionExecution(
    db.prepare("SELECT * FROM flow_action_executions WHERE id = ?").get(id)
  );
  return rowToFlowActionExecution(
    db.prepare("SELECT * FROM flow_action_executions WHERE id = ?").get(id)
  );
}

export function markFlowActionExecutionFailed({ id, errorMessage = "", channelResponse = null }) {
  const timestamp = now();
  const result = db.prepare(`
    UPDATE flow_action_executions
    SET status = 'failed',
        channel_response_json = ?,
        error_message = ?,
        finished_at = ?,
        updated_at = ?
    WHERE id = ?
      AND status = 'processing'
  `).run(json(channelResponse), String(errorMessage || ""), timestamp, timestamp, id);
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

export function finalizeFlowActivationTaskDelivery({ id, channelMessageIds = [] }) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const task = markFlowActivationTaskSent({ id, channelMessageIds });
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
  source = "first_contact",
  reason = "首次联系日期"
}) {
  const existing = listConversationTags({ botId, agentId, conversationKey })
    .find((tag) => tag.tagType === "date");
  if (existing) {
    return listConversationTags({ botId, agentId, conversationKey });
  }
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
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
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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

export function markTagActivationTaskSent({ id, channelMessageIds = [] }) {
  const timestamp = now();
  const result = db.prepare(`
    UPDATE tag_activation_tasks
    SET status = 'sent',
        sent_at = ?,
        error_message = '',
        channel_message_ids_json = ?,
        updated_at = ?
    WHERE id = ?
      AND status IN ('processing', 'sending')
  `).run(timestamp, json(channelMessageIds), timestamp, id);
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
  if (direction === "outbound") {
    const declaredIds = [
      ...(Array.isArray(rawPayload?.channelMessageIds) ? rawPayload.channelMessageIds : []),
      ...(Array.isArray(rawPayload?.messageIds) ? rawPayload.messageIds : []),
      rawPayload?.channelMessageId,
      rawPayload?.messageId
    ].map((value) => String(value || "").trim()).filter(Boolean);
    const matchingRows = new Map();
    for (const messageId of new Set(declaredIds)) {
      const existingRows = db.prepare(`
        SELECT * FROM conversation_messages
        WHERE bot_id = ? AND conversation_key = ? AND direction = 'outbound'
          AND (
            json_extract(raw_payload_json, '$.messageId') = ?
            OR json_extract(raw_payload_json, '$.channelMessageId') = ?
            OR EXISTS (
              SELECT 1 FROM json_each(json_extract(raw_payload_json, '$.channelMessageIds'))
              WHERE value = ?
            )
            OR EXISTS (
              SELECT 1 FROM json_each(json_extract(raw_payload_json, '$.messageIds'))
              WHERE value = ?
            )
          )
        ORDER BY id ASC
      `).all(botId, conversationKey, messageId, messageId, messageId, messageId);
      for (const row of existingRows) matchingRows.set(Number(row.id), row);
    }
    if (matchingRows.size) {
      const matches = [...matchingRows.values()].sort((left, right) => Number(left.id) - Number(right.id));
      const canonicalExisting = matches.find((row) => (
        parseJson(row.raw_payload_json)?.source !== "channel_outbound_webhook"
      ));
      if (canonicalExisting) return rowToConversationMessage(canonicalExisting);

      const retained = matches[0];
      db.prepare(`
        UPDATE conversation_messages
        SET sender_name = ?, content = ?, raw_payload_json = ?
        WHERE id = ?
      `).run(senderName || retained.sender_name || "", content || "", json(rawPayload), retained.id);
      for (const duplicate of matches.slice(1)) {
        db.prepare("DELETE FROM conversation_messages WHERE id = ?").run(duplicate.id);
      }
      return rowToConversationMessage(
        db.prepare("SELECT * FROM conversation_messages WHERE id = ?").get(retained.id)
      );
    }
  }
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
  if (!["legacy_customer_history", "legacy_api_history"].includes(source)) {
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
    if (inserted > 0 && source === "legacy_customer_history") {
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
      AND source IN ('legacy_customer_history', 'legacy_api_history')
    ORDER BY created_at ASC, id ASC
  `).all(botId, conversationKey).map(rowToConversationMessage);
}

export function upsertLegacyApiMessageCache({ botId, items = [] }) {
  const insert = db.prepare(`
    INSERT INTO legacy_api_message_cache (
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

export function hasCachedChannelMessageId({ botId, messageId }) {
  return Boolean(db.prepare(`
    SELECT 1 FROM legacy_api_message_cache
    WHERE bot_id = ? AND message_id = ?
    LIMIT 1
  `).get(botId, messageId));
}

export function listCachedApiMessages({ botId, targetNames = [] }) {
  const names = [...new Set(targetNames.map((name) => String(name || "").trim()).filter(Boolean))];
  if (!names.length) return [];
  const placeholders = names.map(() => "?").join(", ");
  return db.prepare(`
    SELECT * FROM legacy_api_message_cache
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

const OUTGOING_MESSAGE_DELIVERY_STATUSES = new Set([
  "pending",
  "sent",
  "delivered",
  "read",
  "played",
  "failed"
]);

function deliveryIdentityForConversationMessage(message, channelIdentity) {
  if (message.direction !== "outbound") return null;
  if (message.rawPayload?.source === "manual_reply") {
    const provider = String(message.rawPayload?.provider || channelIdentity?.[1] || "").trim();
    const channelAccountId = String(
      message.rawPayload?.channelAccountId || channelIdentity?.[2] || ""
    ).trim();
    const declaredIds = Array.isArray(message.rawPayload?.messageIds)
      ? message.rawPayload.messageIds
        .map((value) => String(value || "").trim())
        .filter(Boolean)
      : [];
    const messageIds = [...new Set(
      (declaredIds.length ? declaredIds : [message.rawPayload?.messageId])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )];
    return messageIds.length && provider && channelAccountId
      ? { kind: "manual", messageIds, provider, channelAccountId }
      : null;
  }
  const provider = String(channelIdentity?.[1] || "").trim();
  const channelAccountId = String(channelIdentity?.[2] || "").trim();
  if (!provider || !channelAccountId) return null;
  const declaredIds = Array.isArray(message.rawPayload?.channelMessageIds)
    ? message.rawPayload.channelMessageIds
      .map((value) => String(value || "").trim())
      .filter(Boolean)
    : [];
  const messageIds = [...new Set(
    (declaredIds.length ? declaredIds : [message.rawPayload?.channelMessageId])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
  return messageIds.length
    ? { kind: "ai", messageIds, provider, channelAccountId }
    : null;
}

function aggregateAiDeliveryStatus(identity, outgoingRows) {
  const rows = identity.messageIds
    .map((messageId) => outgoingRows.get(JSON.stringify([
      identity.provider,
      identity.channelAccountId,
      messageId
    ])))
    .filter((row) => OUTGOING_MESSAGE_DELIVERY_STATUSES.has(row?.delivery_status));
  if (!rows.length) return null;
  let deliveryStatus = "";
  if (rows.some((row) => row.delivery_status === "failed")) deliveryStatus = "failed";
  else if (rows.length < identity.messageIds.length) deliveryStatus = "sent";
  else if (rows.some((row) => ["pending", "sent"].includes(row.delivery_status))) deliveryStatus = "sent";
  else if (rows.some((row) => row.delivery_status === "delivered")) deliveryStatus = "delivered";
  else if (rows.every((row) => ["read", "played"].includes(row.delivery_status))) deliveryStatus = "read";
  if (!deliveryStatus) return null;
  const failedRow = rows.find(
    (row) => row.delivery_status === "failed" && String(row.delivery_error || "").trim()
  );
  return {
    deliveryStatus,
    deliveryError: failedRow?.delivery_error || "",
    deliveryUpdatedAt: rows
      .map((row) => row.delivery_updated_at || "")
      .sort()
      .at(-1) || ""
  };
}

function attachOutgoingMessageDeliveryStatuses(messages, { botId, conversationKey }) {
  if (!botId || !conversationKey || !messages.length) return messages;
  const channelIdentity = String(conversationKey).match(/^([^:]+):([^:]+):(private|group):/);
  const identityFor = (message) => deliveryIdentityForConversationMessage(message, channelIdentity);
  const identities = messages.map(identityFor).filter(Boolean);
  if (!identities.length) return messages;

  const providers = [...new Set(identities.map((identity) => identity.provider))];
  const channelAccountIds = [...new Set(identities.map((identity) => identity.channelAccountId))];
  const messageIds = [...new Set(identities.flatMap((identity) => identity.messageIds))];
  const placeholders = (values) => values.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT provider, channel_account_id, message_id,
           delivery_status, delivery_error, delivery_updated_at
    FROM outgoing_messages
    WHERE bot_id = ?
      AND conversation_key = ?
      AND provider IN (${placeholders(providers)})
      AND channel_account_id IN (${placeholders(channelAccountIds)})
      AND message_id IN (${placeholders(messageIds)})
    ORDER BY provider ASC, channel_account_id ASC, message_id ASC, id DESC
  `).all(botId, conversationKey, ...providers, ...channelAccountIds, ...messageIds);
  const identityKey = ({ provider, channelAccountId, messageId }) => (
    JSON.stringify([provider, channelAccountId, messageId])
  );
  const latestByIdentity = new Map();
  for (const row of rows) {
    const key = identityKey({
      provider: row.provider,
      channelAccountId: row.channel_account_id,
      messageId: row.message_id
    });
    if (!latestByIdentity.has(key)) {
      latestByIdentity.set(key, row);
    }
  }

  for (const message of messages) {
    const identity = identityFor(message);
    if (!identity) continue;
    if (identity.kind === "manual" && identity.messageIds.length === 1) {
      const outgoing = latestByIdentity.get(identityKey({ ...identity, messageId: identity.messageIds[0] }));
      if (!outgoing || !OUTGOING_MESSAGE_DELIVERY_STATUSES.has(outgoing.delivery_status)) continue;
      message.deliveryStatus = outgoing.delivery_status;
      message.deliveryError = outgoing.delivery_error || "";
      message.deliveryUpdatedAt = outgoing.delivery_updated_at || "";
      continue;
    }
    const aggregate = aggregateAiDeliveryStatus(identity, latestByIdentity);
    if (aggregate) Object.assign(message, aggregate);
  }
  return messages;
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
    if (noMoreRows) {
      return attachOutgoingMessageDeliveryStatuses(visible, { botId, conversationKey });
    }

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
      return attachOutgoingMessageDeliveryStatuses(visible, { botId, conversationKey });
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
    return attachOutgoingMessageDeliveryStatuses(
      [rowToConversationMessage(anchor)],
      { botId, conversationKey }
    );
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
    if (!needsOlderRows && !needsNewerRows) {
      return attachOutgoingMessageDeliveryStatuses(selected, { botId, conversationKey });
    }

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
  conversationKey = "",
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
      bot_id, target_type, target_name, display_name, conversation_key, source, enabled,
      last_seen_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bot_id, target_type, target_name) DO UPDATE SET
      display_name = COALESCE(NULLIF(excluded.display_name, ''), proactive_targets.display_name),
      conversation_key = COALESCE(NULLIF(excluded.conversation_key, ''), proactive_targets.conversation_key),
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
    String(conversationKey || ""),
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
        COALESCE(
          NULLIF(json_extract(payload_json, '$.metadata.externalChatId'), ''),
          CASE WHEN room_type IN (1, 3) THEN group_name ELSE received_name END
        ) AS target_name,
        CASE WHEN room_type IN (1, 3) THEN group_name ELSE received_name END AS display_name,
        COALESCE(NULLIF(json_extract(payload_json, '$.metadata.conversationKey'), ''), '') AS conversation_key,
        MAX(created_at) AS last_seen_at
      FROM incoming_messages
      ${botFilter}
      GROUP BY bot_id, target_type, target_name, display_name, conversation_key
    `)
    .all(...params);

  for (const row of rows) {
    if (!row.target_name) continue;
    upsertProactiveAddressBookTarget({
      botId: row.bot_id,
      targetType: row.target_type,
      targetName: row.target_name,
      displayName: row.display_name || row.target_name,
      conversationKey: row.conversation_key,
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
     AND ct.conversation_key = COALESCE(NULLIF(pt.conversation_key, ''), pt.bot_id || ':private:' || pt.target_name)
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
         AND ct.conversation_key = COALESCE(NULLIF(proactive_targets.conversation_key, ''), proactive_targets.bot_id || ':private:' || proactive_targets.target_name)
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
    targetName: String(target.targetName || "").trim(),
    conversationKey: String(target.conversationKey || "").trim()
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
      task_id, bot_id, target_type, target_name, conversation_key, content, message_type,
      message_payload_json, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const target of normalizedTargets) {
    insertTarget.run(
      taskId,
      botId,
      target.targetType,
      target.targetName,
      target.conversationKey,
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

export function markProactiveTargetSent({ id, messageId, channelResponse }) {
  const timestamp = now();
  const target = db.prepare("SELECT task_id FROM proactive_task_targets WHERE id = ?").get(id);
  db.prepare(`
    UPDATE proactive_task_targets
    SET status = 'sent',
        message_id = ?,
        error_message = '',
        channel_response_json = ?,
        finished_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(messageId || "", json(channelResponse), timestamp, timestamp, id);
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
        channel_response_json = ?,
        finished_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    failed ? "failed" : "sent",
    failed ? payload.errorReason || payload.errorMsg || "Channel command failed" : "",
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
        channelResponse: parseJson(row.channel_response_json),
        callbackPayload: parseJson(row.callback_payload_json)
      })
    },
    "outgoing-commands": {
      table: "outgoing_messages",
      mapper: (row) => ({
        ...row,
        channelResponse: parseJson(row.channel_response_json),
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
  timezone: COCKPIT_TIME_ZONE,
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
    timezone: COCKPIT_TIME_ZONE,
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
  if (!row) return null;
  const payload = parseJson(row.payload_json) || {};
  return {
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
    nodeId: payload.nodeId || "",
    groupId: payload.groupId || "",
    tagId: payload.tagId || "",
    payload,
    sourceRef: parseJson(row.source_ref_json) || {},
    createdAt: row.created_at
  };
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

export function backfillCockpitEventsFromBusiness({ botId, throughAt }) {
  let inserted = 0;
  const firstCockpitOccurrence = (eventType) => db.prepare(`
    SELECT MIN(occurred_at) AS occurred_at
    FROM cockpit_events
    WHERE bot_id = ? AND event_type = ?
  `).get(botId, eventType)?.occurred_at || throughAt;

  const firstContactEventAt = firstCockpitOccurrence("first_contact");
  const conversations = db.prepare(`
    SELECT conversation.*, conversation.rowid AS source_id
    FROM conversations conversation
    WHERE conversation.bot_id = ?
      AND COALESCE(conversation.room_type, 2) != 1
      AND conversation.created_at < ?
      AND conversation.created_at <= ?
      AND NOT EXISTS (
        SELECT 1 FROM cockpit_events event
        WHERE event.event_key = 'business:conversation:' || conversation.rowid
      )
    ORDER BY conversation.created_at ASC, conversation.rowid ASC
    LIMIT 1000
  `).all(botId, firstContactEventAt, throughAt);
  for (const row of conversations) {
    inserted += appendCockpitEvent({
      eventKey: `business:conversation:${row.source_id}`,
      botId,
      conversationKey: row.conversation_key,
      customerKey: row.received_name || row.conversation_key,
      eventType: "first_contact",
      occurredAt: row.created_at,
      receivedAt: row.created_at,
      sourceRef: { type: "conversation", id: row.conversation_key }
    }).inserted ? 1 : 0;
  }

  const firstCustomerMessageAt = firstCockpitOccurrence("customer_message");
  const customerMessages = db.prepare(`
    SELECT
      incoming.*,
      conversations.received_name AS conversation_received_name
    FROM incoming_messages incoming
    LEFT JOIN conversations
      ON conversations.bot_id = incoming.bot_id
     AND conversations.conversation_key = incoming.conversation_key
    WHERE incoming.bot_id = ?
      AND COALESCE(incoming.room_type, 2) != 1
      AND incoming.created_at < ?
      AND incoming.created_at <= ?
      AND NOT EXISTS (
        SELECT 1 FROM cockpit_events event
        WHERE event.event_key = 'business:incoming_message:' || incoming.id
      )
    ORDER BY incoming.id ASC
    LIMIT 1000
  `).all(botId, firstCustomerMessageAt, throughAt);
  for (const row of customerMessages) {
    inserted += appendCockpitEvent({
      eventKey: `business:incoming_message:${row.id}`,
      botId,
      conversationKey: row.conversation_key || "",
      customerKey: row.conversation_received_name
        || row.received_name
        || row.conversation_key
        || "",
      eventType: "customer_message",
      occurredAt: row.created_at,
      receivedAt: row.created_at,
      sourceRef: { type: "incoming_message_row", id: row.id }
    }).inserted ? 1 : 0;
  }

  const replies = db.prepare(`
    SELECT
      outgoing.id,
      outgoing.conversation_key,
      outgoing.target_name,
      outgoing.created_at,
      conversations.received_name
    FROM outgoing_messages outgoing
    LEFT JOIN conversations
      ON conversations.bot_id = outgoing.bot_id
     AND conversations.conversation_key = outgoing.conversation_key
    WHERE outgoing.bot_id = ?
      AND outgoing.conversation_key LIKE '%:private:%'
      AND outgoing.created_at <= ?
      AND NOT EXISTS (
        SELECT 1 FROM cockpit_events event
        WHERE event.event_key = 'business:outgoing_message:' || outgoing.id
      )
    ORDER BY outgoing.id ASC
    LIMIT 1000
  `).all(botId, throughAt);
  for (const row of replies) {
    inserted += appendCockpitEvent({
      eventKey: `business:outgoing_message:${row.id}`,
      botId,
      conversationKey: row.conversation_key || "",
      customerKey: row.received_name || row.target_name || row.conversation_key || "",
      eventType: "bot_message",
      occurredAt: row.created_at,
      receivedAt: row.created_at,
      sourceRef: { type: "outgoing_message", id: row.id }
    }).inserted ? 1 : 0;
  }

  const nodeEvents = db.prepare(`
    SELECT
      flow_session.id,
      flow_session.conversation_key,
      flow_session.current_node_id,
      flow_session.last_message_at,
      conversations.received_name
    FROM flow_sessions flow_session
    LEFT JOIN conversations
      ON conversations.bot_id = flow_session.bot_id
     AND conversations.conversation_key = flow_session.conversation_key
    WHERE flow_session.bot_id = ?
      AND flow_session.conversation_key LIKE '%:private:%'
      AND flow_session.last_message_at <= ?
    ORDER BY flow_session.id ASC
  `).all(botId, throughAt);
  for (const row of nodeEvents) {
    inserted += appendCockpitEvent({
      eventKey: [
        "business:flow_session",
        row.id,
        encodeURIComponent(row.current_node_id || ""),
        encodeURIComponent(row.last_message_at || "")
      ].join(":"),
      botId,
      conversationKey: row.conversation_key,
      customerKey: row.received_name || row.conversation_key,
      eventType: "node_reached",
      occurredAt: row.last_message_at,
      receivedAt: row.last_message_at,
      flowVersionId: 1,
      payload: { nodeId: row.current_node_id },
      sourceRef: { type: "flow_session", id: row.id }
    }).inserted ? 1 : 0;
  }

  const tagEvents = db.prepare(`
    SELECT
      tag_event.*,
      conversations.received_name
    FROM conversation_tag_events tag_event
    LEFT JOIN conversations
      ON conversations.bot_id = tag_event.bot_id
     AND conversations.conversation_key = tag_event.conversation_key
    WHERE tag_event.bot_id = ?
      AND tag_event.conversation_key LIKE '%:private:%'
      AND tag_event.accepted = 1
      AND tag_event.created_at <= ?
      AND NOT EXISTS (
        SELECT 1 FROM cockpit_events event
        WHERE event.event_key LIKE
          'business:conversation_tag_event:' || tag_event.id || ':%'
      )
    ORDER BY tag_event.id ASC
    LIMIT 1000
  `).all(botId, throughAt);
  for (const row of tagEvents) {
    const payload = parseJson(row.payload_json) || {};
    const customerKey = row.received_name || row.conversation_key;
    const appendTagEvent = ({ eventType, tagId, suffix }) => {
      inserted += appendCockpitEvent({
        eventKey: `business:conversation_tag_event:${row.id}:${suffix}`,
        botId,
        conversationKey: row.conversation_key,
        customerKey,
        eventType,
        occurredAt: row.created_at,
        receivedAt: row.created_at,
        payload: { groupId: row.group_id || "", tagId: tagId || "" },
        sourceRef: { type: "conversation_tag_event", id: row.id }
      }).inserted ? 1 : 0;
    };
    if (["add", "replace"].includes(row.event_type) && row.tag_id) {
      appendTagEvent({ eventType: "tag_added", tagId: row.tag_id, suffix: "add" });
    }
    if (row.event_type === "remove" && row.tag_id) {
      appendTagEvent({ eventType: "tag_removed", tagId: row.tag_id, suffix: "remove" });
    }
    for (const oldTagId of payload.oldTagIds || []) {
      appendTagEvent({
        eventType: "tag_removed",
        tagId: oldTagId,
        suffix: `remove:${oldTagId}`
      });
    }
  }
  return { inserted };
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

export function isCockpitStageCompleted({ localDate, stage }) {
  return Boolean(db.prepare(`
    SELECT 1
    FROM cockpit_stage_runs
    WHERE local_date = ? AND stage = ?
  `).get(localDate, stage));
}

export function markCockpitStageCompleted({ localDate, stage, completedAt }) {
  const timestamp = now();
  db.prepare(`
    INSERT INTO cockpit_stage_runs (
      local_date, stage, completed_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(local_date, stage) DO UPDATE SET
      completed_at = excluded.completed_at,
      updated_at = excluded.updated_at
  `).run(localDate, stage, completedAt || timestamp, timestamp, timestamp);
  return {
    localDate,
    stage,
    completedAt: completedAt || timestamp
  };
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
    channelResponse: parseJson(row.channel_response_json),
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
        channel_response_json = ?, updated_at = ?
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
