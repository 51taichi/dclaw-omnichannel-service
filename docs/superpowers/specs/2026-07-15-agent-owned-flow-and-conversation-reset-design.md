# Agent-Owned Flow Configuration and Conversation Reset Design

## Goal

Keep customer communication history owned by a WorkTool Bot, move flow-machine configuration to the bound Agent, and make a console conversation reset synchronously clear the matching Agent short-term conversation file.

## Scope

This change has two connected responsibilities:

1. A flow-machine definition belongs to one `agentId`, not to a `botId`.
2. Clearing one Bot conversation also requests the currently bound DClaw Agent to delete only that conversation's short-term record.

Customer chat history, proactive tasks, command logs, and general Bot records remain Bot-owned. They are deliberately not made globally shared by Agent because an Agent may be bound to more than one Bot.

## Ownership Model

| Data | Owner | Key |
| --- | --- | --- |
| Bot to Agent binding | Bot | `botId` |
| Flow-machine configuration | Agent | `agentId` |
| Customer conversation messages and callbacks | Bot | `botId + conversationKey` |
| Flow progress, collected assets, and handoff status | Bot conversation | `botId + conversationKey` |
| Activation tasks | Bot conversation | `botId + conversationKey` |
| DClaw short-term conversation record | Current Agent workspace | `agentId + conversationId` |
| Customer profile | Agent workspace | Agent-defined profile key; never deleted by a conversation reset |

The WorkTool Bot is treated as the stable identity of one WeCom endpoint. Rebinding a Bot changes which Agent handles subsequent messages; it does not merge or expose another Bot's customer history.

## Flow-Machine Storage and Migration

A new `agent_flow_machines` table stores one flow configuration per `agent_id`:

- `agent_id` is unique.
- It stores the existing normalized machine fields: name, version, entry node, JSON config, enabled state, and timestamps.
- The current `flow_machines` table is retained as a read-only legacy source during migration. It is not deleted by this feature.

At startup, legacy rows are copied once from `flow_machines` to `agent_flow_machines` using the Bot's current binding. If several legacy Bot rows point to the same Agent, the first existing Agent machine is retained and later legacy rows are left untouched. This avoids silent overwrite and preserves all old rows as a recovery source.

The console continues to open state-machine configuration from the selected Bot, but the server resolves that Bot's current binding and reads or saves the machine by `agentId`. A Bot without a flow machine continues to receive and record normal conversations. It simply has no flow context, assets, activation tasks, or state progress.

## Bot Rebinding

When an explicit console binding save changes a Bot from Agent A to Agent B:

1. Save the new Bot-to-Agent binding.
2. Cancel outstanding activation tasks for that Bot with `cancel_reason = 'agent_rebound'` so no old-agent reminder can be sent by the new Agent.
3. Remove the Bot's flow-session rows and flow-state events. This clears previous node position, collected assets, handoff state, and state-specific history because node identifiers belong to Agent A's machine.
4. Preserve customer conversation messages, incoming/outgoing message records, command callbacks, proactive tasks, and general invocation logs.
5. Write a structured server log describing the Bot, old Agent, new Agent, and reset counts.

The reset is performed only by the interactive Bot binding update route. Loading startup configuration does not repeatedly reset state merely because the service restarts.

## Conversation Reset and Agent Sync

The existing console reset remains a local transaction:

- Clear visible conversation messages and flow-state events.
- Reset the local flow session if a flow machine exists.
- Clear DClaw session metadata and set `reset_pending = 1`.
- Cancel outstanding activation tasks for that conversation.

After the local transaction, the service sends a DClaw OpenAPI sync-only event to the Bot's currently bound Agent:

```json
{
  "eventType": "conversation_reset",
  "botId": "...",
  "agentId": "...",
  "conversationId": "botId:private:customer",
  "reason": "console_reset"
}
```

The Agent must derive its own record filename from `conversationId`, delete only the matching file below `会话记录/conversations/`, and never use a caller-provided path. It must not delete or modify `客户档案/`.

For this internal event, the Agent returns exactly:

```json
{"ok":true,"eventType":"conversation_reset"}
```

The server validates that acknowledgement and then clears `reset_pending`. If the sync request fails, local reset still succeeds. The service logs the error and leaves `reset_pending = 1`; the next inbound request retains the existing `conversationReset=true` fallback, allowing the Agent to reset before handling that message.

## Error Handling

- A missing Bot binding does not prevent local clearing; Agent sync is skipped and logged.
- A Bot without a flow machine can still clear its conversation and synchronize the Agent file reset.
- A malformed or non-acknowledging Agent response is treated as a failed sync, is never customer-visible, and leaves the fallback pending flag intact.
- A pending activation task from a previous Agent is never executed after a Bot rebind.

## Tests

Automated coverage will prove:

1. State machines are stored and retrieved by Agent while accessed through a selected Bot.
2. A Bot without a state machine still creates, lists, and clears ordinary conversations.
3. Rebinding one Bot clears only that Bot's flow state and cancels only that Bot's pending activation tasks; messages and unrelated Bots remain intact.
4. Clearing a conversation sends the bounded `conversation_reset` request, accepts only the explicit acknowledgement, and keeps `reset_pending` after a failure.
5. Existing handoff and normal customer reply requests remain unchanged.

## Non-Goals

- Customer chat history is not made globally Agent-owned.
- Existing customer profile files are not deleted by conversation reset.
- Rebinding does not copy Agent A flow progress into Agent B.
- This feature does not change WorkTool callbacks, message routing, or the public console layout beyond showing the current Agent-owned machine.
