# Node Activation Follow-up Design

## Goal

Add a node-level customer activation mechanism for private flow sessions: after the bot replies in a flow node, if the customer does not reply within the configured interval, the service sends follow-up activation messages for that node, up to the configured count.

## Scope

This feature applies only to private conversations managed by the task state machine. Group conversations are out of scope for the first version. Human handoff conversations must not receive activation messages while handoff is active.

The activation feature belongs to the callback server and console. It does not require changing the DClaw agent source, although the server may call the configured DClaw OpenAPI to polish activation copy when node settings request it.

## Node Configuration

Each flow node can optionally define an activation configuration:

```json
{
  "activation": {
    "enabled": true,
    "intervalMinutes": 30,
    "maxTimes": 2,
    "polishByAgent": true,
    "messages": [
      "再提醒您一下：可以把聊天置顶，群邀请和开课消息就不容易漏掉。",
      "看到后回我一句，我这边也好确认您能收到提醒。"
    ]
  }
}
```

Field rules:

- `enabled`: Boolean. Default `false`.
- `intervalMinutes`: Positive integer. Default `30` when enabled and omitted.
- `maxTimes`: Positive integer. Default `1` when enabled and omitted.
- `polishByAgent`: Boolean. Default `true`.
- `messages`: Array of non-empty strings. The console should present this as one input per message and support newline paste-to-split. Do not split by spaces.

## Console Experience

In the task node editor, add a collapsible or grouped “客户激活” section per node.

Controls:

- Enable activation toggle.
- Interval minutes number input.
- Max activation count number input.
- “交给 Agent 美化话术” checkbox, checked by default.
- Activation messages list with add/remove controls.
- Paste multiline text into a message field should be supported by splitting into multiple configured messages if feasible; otherwise the first version can provide an explicit “按换行导入” action.

The generated JSON remains an implementation detail. Users should not need to hand-write activation JSON.

## Scheduling Semantics

Activation timing starts after the server successfully sends the bot/AI reply for the current node. It does not start when the customer enters the node or when the agent request begins.

When the server successfully sends a node reply:

1. Identify the active private flow session and current node.
2. If node activation is disabled, cancel pending activation tasks for that session/node generation.
3. If enabled, create the first activation task with `dueAt = replySentAt + intervalMinutes`.
4. Record enough metadata to invalidate stale tasks later: `botId`, `conversationKey`, `nodeId`, `nodeVersion/generation`, `attemptNumber`, `dueAt`, and activation config snapshot.

After an activation message is sent successfully:

- If `attemptNumber < maxTimes`, create the next activation task with `dueAt = now + intervalMinutes`.
- If `attemptNumber >= maxTimes`, mark activation as complete for that node reply cycle.

## Cancellation and Staleness

Pending or processing activation tasks must not send if any of these become true:

- Customer sends a new inbound private message in the conversation.
- Session changes to a different node.
- Conversation is cleared/reset.
- Conversation enters human handoff.
- Bot binding is disabled or missing.
- The task’s stored node generation no longer matches the session’s current activation generation.

Inbound customer messages should cancel pending activation tasks for that conversation before normal agent processing continues.

Manual human handoff should cancel or stale pending activation tasks immediately. Restoring AI does not resurrect old activation tasks; new tasks are scheduled only after the next bot/AI node reply.

## Worker Design

Use SQLite-backed task rows rather than in-memory timers.

A single activation worker runs inside the Node service:

- `ACTIVATION_WORKER_ENABLED=true` by default.
- `ACTIVATION_WORKER_INTERVAL_MS=10000` by default.
- `ACTIVATION_WORKER_BATCH_SIZE=20` by default.
- `ACTIVATION_WORKER_STALE_PROCESSING_MS=300000` by default.
- `ACTIVATION_SEND_DELAY_MS=500` by default.
- `ACTIVATION_MAX_CONCURRENT_AGENT_CALLS=2` by default.

The worker must have a process-level busy flag. If a scan tick fires while a previous batch is still running, skip that tick.

Task claiming should be database-backed:

- Select due `pending` tasks ordered by `due_at ASC`, limited by batch size.
- Mark claimed rows as `processing` with `processing_started_at` before executing.
- Recover rows stuck in `processing` longer than stale timeout by marking them `pending` or `failed` based on attempt policy.

This service currently runs as a single Docker instance, so an in-process busy flag plus SQLite task state is sufficient for the first version. If the deployment becomes multi-replica, add a real distributed lock or move this queue to Redis/BullMQ.

## Sending Behavior

When `polishByAgent=true`:

1. Build a DClaw request with an activation event type such as `flow_activation_due`.
2. Include full WorkTool-style context, conversation id, node id, attempt number, max times, and configured activation messages as reference material.
3. Ask the agent to output only the final customer-visible activation text.
4. Send the returned text through WorkTool.
5. Store outbound conversation message and outgoing command logs.
6. Sync the outbound activation event to DClaw history if the normal DClaw call did not already create that history.

When `polishByAgent=false`:

1. Do not call DClaw for text generation.
2. Send configured `messages` exactly as separate messages, preserving order.
3. Add a short delay between messages using `ACTIVATION_SEND_DELAY_MS`.
4. Store each sent message in conversation history and outgoing command logs.
5. Sync an outbound proactive/activation event to DClaw history so the agent has the complete transcript later.

If WorkTool send fails, record the task as `failed` with error details. Do not retry indefinitely in the first version.

## Priority and Load

Activation is a background task and must not block inbound customer message processing. The worker must be batch-limited and non-overlapping. Batch size defaults to `20`, not `1-3`, because current reply flow already spreads activation due times by using successful reply time as the scheduling anchor.

Even with 500 new customers per day, SQLite-backed activation rows are acceptable for the first version. The key protections are:

- No in-memory per-customer timers.
- Batch limit.
- Worker busy flag.
- Agent concurrency limit.
- WorkTool send delay.
- Stale task invalidation.

## Data Model

Add a table such as `flow_activation_tasks`:

```sql
CREATE TABLE IF NOT EXISTS flow_activation_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  conversation_key TEXT NOT NULL,
  node_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  attempt_number INTEGER NOT NULL,
  max_times INTEGER NOT NULL,
  interval_minutes INTEGER NOT NULL,
  polish_by_agent INTEGER NOT NULL DEFAULT 1,
  messages_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
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
```

Important indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_flow_activation_due
ON flow_activation_tasks (status, due_at);

CREATE INDEX IF NOT EXISTS idx_flow_activation_conversation
ON flow_activation_tasks (conversation_key, status);
```

Add a generation field to flow sessions or derive generation from updated node state. Prefer explicit `activation_generation` on `flow_sessions`, incremented whenever inbound customer message, node transition, reset, or handoff invalidates existing activation tasks.

## Observability

Log structured events:

- `activation.scheduled`
- `activation.canceled`
- `activation.worker.claimed`
- `activation.agent.start`
- `activation.agent.success`
- `activation.agent.failed`
- `activation.send.success`
- `activation.send.failed`
- `activation.stale_skipped`

Expose activation tasks in logs/API only if useful for debugging. The first version can add a log type for activation tasks if it fits existing console log patterns.

## Testing Strategy

Use TDD with `node:test`.

Test areas:

- DB helpers create, claim, cancel, and complete activation tasks.
- Flow node editor serializes/deserializes activation config.
- Server schedules activation after successful private node replies.
- Customer inbound message cancels pending activation.
- Human handoff cancels or prevents activation sends.
- Worker skips when already busy.
- Worker sends raw messages when `polishByAgent=false`.
- Worker calls DClaw when `polishByAgent=true`.

## Non-goals for First Version

- Redis/BullMQ queue.
- Multi-replica locking.
- Group chat activation.
- Per-customer quiet hours.
- Full analytics dashboard for activation conversion.
