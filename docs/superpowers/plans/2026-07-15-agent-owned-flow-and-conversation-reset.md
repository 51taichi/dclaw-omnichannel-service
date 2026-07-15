# Agent-Owned Flow and Conversation Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make flow-machine configuration Agent-owned while preserving Bot-owned customer records, and synchronize console conversation resets to the current DClaw Agent's short-term record file.

**Architecture:** Add an Agent-keyed flow-machine table and one-time non-destructive migration from legacy Bot-keyed machines. Resolve the selected Bot's machine via its current binding, reset only derived flow state on an interactive rebind, and use a dedicated internal DClaw event with explicit acknowledgement for Agent workspace cleanup.

**Tech Stack:** Node.js 22, Express, `node:sqlite`, DClaw OpenAPI SSE, Node test runner, Markdown Agent skills.

## Global Constraints

- Customer messages, callbacks, proactive records, and general logs remain keyed by `botId + conversationKey`.
- Flow-machine definitions are keyed by exactly one `agentId`.
- Rebinding never deletes chat records, outgoing records, command callbacks, proactive tasks, or invocation logs.
- Agent cleanup can only remove a derived file under `会话记录/conversations/`; it never removes `客户档案/`.
- Missing flow configuration must not stop normal conversation creation, listing, or reset.
- An Agent cleanup failure leaves `reset_pending = 1` and does not fail the local console reset.
- Customer-visible Agent replies retain the strict one-JSON-object protocol.

## File Map

- `src/db.js`: schema migration, Agent flow accessors, Bot rebind cleanup, flow-optional reset.
- `src/dclaw.js`: reset event request and strict acknowledgement parser.
- `src/server.js`: interactive rebind handling and local-first Agent reset sync.
- `tests/db-reset.test.js`: flow-less reset and Agent-owned assets.
- `tests/db-bot-isolation.test.js`: migration and Bot rebind isolation.
- `tests/dclaw-handoff.test.js`: reset request and acknowledgement contract.
- `tests/server-conversation-reset-sync.test.js`: reset success/failure behavior.
- `/Users/moxi/Desktop/codex space/agent create/agents/*-customer-service-agent/skills/worktool_message_handler/SKILL.md`: Agent reset event branch.
- The three Agent `README.md` files: manual upload version marker.

## Task 1: Move Flow Machines to Agent Storage

**Files:** `src/db.js:187-294, 1030-1100, 1170-1205, 1536-1575`; `tests/db-reset.test.js`; `tests/db-bot-isolation.test.js`.

**Interfaces produced:**

```js
upsertFlowMachine({ agentId, config, enabled })
getFlowMachine(agentId)
getFlowMachineForBot(botId)
listFlowMachines({ agentId })
```

- [ ] Write failing tests proving two Bots bound to `agent_shared` resolve one machine, and that an old `flow_machines.bot_id` row is copied once into the matching Agent configuration.

```js
db.upsertFlowMachine({ agentId: "agent_shared", config: testFlowConfig("node_1") });
assert.equal(db.getFlowMachineForBot("bot_a").agentId, "agent_shared");
assert.equal(db.getFlowMachineForBot("bot_b").config.entryNodeId, "node_1");
```

- [ ] Run `node --test tests/db-reset.test.js tests/db-bot-isolation.test.js` and verify it fails because Bot resolution does not exist.
- [ ] Add `agent_flow_machines`:

```sql
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
```

- [ ] After existing Agent backfill, copy one deterministic legacy machine per current binding into this table using `ON CONFLICT(agent_id) DO NOTHING`. Keep `flow_machines` unchanged as a recovery source.
- [ ] Replace machine CRUD to use `agent_id`; add:

```js
export function getFlowMachineForBot(botId) {
  const binding = getBotBinding(botId);
  return binding?.agentId ? getFlowMachine(binding.agentId) : null;
}
```

- [ ] Use this Bot resolver from `getConversationAssets`, `listFlowSessions`, `buildFlowContext`, and proactive-session setup.
- [ ] Change `clearConversationForReset` to reset ordinary conversations even when no machine exists. Always clear messages, state events, and DClaw session metadata. Reset an existing flow session to the current entry node when a machine exists, otherwise `__conversation__` with no collected data.
- [ ] Run the focused tests, then `npm test`; both must pass.
- [ ] Commit:

```bash
git add src/db.js tests/db-reset.test.js tests/db-bot-isolation.test.js
git commit -m "feat: store flow machines by agent"
```

## Task 2: Reset Only Derived Flow State on Interactive Rebind

**Files:** `src/db.js:483-532, 1360-1485`; `src/server.js:2310-2353`; `tests/db-bot-isolation.test.js`.

**Interface produced:**

```js
resetBotFlowStateForAgentRebind({ botId, oldAgentId, newAgentId })
// => { canceledActivationTasks, deletedFlowSessions, deletedFlowStateEvents }
```

- [ ] Write a failing test that seeds two Bots, a flow session, messages, and a pending activation task for each. Rebinding one Bot must preserve its messages, cancel only its active task using `agent_rebound`, remove only its `flow_sessions` and `flow_state_events`, and leave the other Bot untouched.
- [ ] Run `node --test tests/db-bot-isolation.test.js` and verify it fails because the helper does not exist.
- [ ] Implement the helper in a `BEGIN IMMEDIATE` transaction. It must only cancel pending/processing tasks and delete flow state tables for `botId`.
- [ ] In `PUT /api/bots/:botId`, get the prior binding before `upsertBotBinding`. Only when the agent changes, call the helper and write `bot.agent_rebound` with Bot, old Agent, new Agent, and returned counts.
- [ ] Do not call the helper from `src/config.js`; restarting the service must never reset flow progress.
- [ ] Run `node --test tests/db-bot-isolation.test.js` and `npm test`.
- [ ] Commit:

```bash
git add src/db.js src/server.js tests/db-bot-isolation.test.js
git commit -m "feat: reset bot flow state on agent rebind"
```

## Task 3: Define the Internal Agent Reset Protocol

**Files:** `src/dclaw.js:1-180, 336-585`; `tests/dclaw-handoff.test.js`.

**Interfaces produced:**

```js
buildDclawConversationResetRequest({ binding, conversationKey, reason })
parseConversationResetAcknowledgement(rawReply)
```

- [ ] Write failing tests for the exact bounded reset event and acknowledgement:

```js
const request = buildDclawConversationResetRequest({
  binding: { botId: "bot_1", agentId: "agent_1" },
  conversationKey: "bot_1:private:张三",
  reason: "console_reset"
});
assert.equal(request.metadata.eventType, "conversation_reset");
assert.equal(request.external_session_id, "bot_1:private:张三");
assert.deepEqual(
  parseConversationResetAcknowledgement('{"ok":true,"eventType":"conversation_reset"}'),
  { ok: true }
);
assert.equal(parseConversationResetAcknowledgement('{"reply":"好的"}').ok, false);
```

- [ ] Run `node --test tests/dclaw-handoff.test.js` and verify it fails.
- [ ] Build the normal OpenAPI SSE request with `eventType: "conversation_reset"`, the current Bot/Agent/conversation identifiers, and `external_session_id = conversationKey`.
- [ ] Its instructions require the Agent to derive its own hash or safe slug from `conversationId`, delete only `会话记录/conversations/<derived>.md`, preserve `客户档案/`, and return only `{"ok":true,"eventType":"conversation_reset"}`.
- [ ] Implement the parser so Markdown, prose, non-JSON output, `ok: false`, and incorrect event names are rejected.
- [ ] Run `node --test tests/dclaw-handoff.test.js` and commit:

```bash
git add src/dclaw.js tests/dclaw-handoff.test.js
git commit -m "feat: add agent conversation reset event"
```

## Task 4: Make Console Reset Local-First and Synced

**Files:** `src/server.js:610-680, 2690-2707`; create `tests/server-conversation-reset-sync.test.js`.

**Interface produced:**

```js
syncConversationResetToAgent({ binding, conversationKey, reason })
// => { status: "synced" | "pending" | "skipped" }
```

- [ ] Write failing tests for these cases:

```js
test("reset sync failure preserves the next-inbound fallback", async () => {
  const result = await syncConversationResetToAgent({
    binding: testBinding(),
    conversationKey: "bot_1:private:张三",
    reason: "console_reset",
    invoke: async () => { throw new Error("DClaw unavailable"); }
  });
  assert.equal(result.status, "pending");
  assert.equal(db.getConversationResetPending("bot_1:private:张三"), true);
});

test("reset sync clears pending only after exact acknowledgement", async () => {
  const result = await syncConversationResetToAgent({
    binding: testBinding(),
    conversationKey: "bot_1:private:张三",
    reason: "console_reset",
    invoke: async () => ({ reply: '{"ok":true,"eventType":"conversation_reset"}', response: {} })
  });
  assert.equal(result.status, "synced");
  assert.equal(db.getConversationResetPending("bot_1:private:张三"), false);
});
```

- [ ] Run `node --test tests/server-conversation-reset-sync.test.js` and verify it fails.
- [ ] Implement the helper beside proactive and handoff sync helpers. It skips only when no enabled binding exists, creates an `agent_invocations` record, uses `enqueueAgentInvocation(() => invokeDclawAgentWithRetry(...))`, and validates the acknowledgement. Export a test-only invocation override parameter named `invoke`; production omits it and therefore uses the queue-backed OpenAPI call.
- [ ] Update `POST /api/flow-sessions/:conversationKey/reset`: execute database reset and activation cancellation first, then await the sync helper. Return HTTP 200 for every successful local reset with `agentSync.status`. Only a valid acknowledgement calls `markConversationResetHandled`; failure remains pending and logs `agent.conversation_reset.failed`.
- [ ] Run `node --test tests/server-conversation-reset-sync.test.js tests/server-activation-boundary.test.js tests/dclaw-handoff.test.js`, then `npm test`.
- [ ] Commit:

```bash
git add src/server.js tests/server-conversation-reset-sync.test.js
git commit -m "feat: sync conversation reset to agent"
```

## Task 5: Update the Three Manual Agent Templates

**Files:**

- `/Users/moxi/Desktop/codex space/agent create/agents/xzj-business-manager-agent/skills/worktool_message_handler/SKILL.md`
- `/Users/moxi/Desktop/codex space/agent create/agents/gujing-customer-service-agent/skills/worktool_message_handler/SKILL.md`
- `/Users/moxi/Desktop/codex space/agent create/agents/gjyy-customer-service-agent/skills/worktool_message_handler/SKILL.md`
- The three corresponding `README.md` files.

- [ ] Before ordinary `inbound_message` handling, document an `eventType = conversation_reset` branch:

```text
1. Read conversationId only; ignore every caller file path or filename.
2. Derive sha256(conversationId).md, or the documented safe slug fallback.
3. Verify the target resolves below 会话记录/conversations/.
4. Delete the derived file if present; a missing file is still success.
5. Never read or modify 客户档案/ and never run knowledge, flow, or reply skills.
6. Output exactly {"ok":true,"eventType":"conversation_reset"}.
```

- [ ] Keep `conversationReset=true` on normal inbound/handoff events as the fallback path. Preserve strict customer JSON and proactive/handoff empty-string behavior.
- [ ] Bump each Agent README version from `2026.07.15.1` to `2026.07.15.2`, noting that console reset clears only short-term conversation records.
- [ ] Verify all templates:

```bash
for d in /Users/moxi/Desktop/codex\ space/agent\ create/agents/*-customer-service-agent; do
  rg -n 'conversation_reset|客户档案|2026\.07\.15\.2' "$d/skills/worktool_message_handler/SKILL.md" "$d/README.md"
done
```

- [ ] The Agent templates stay outside this service Git repository. Report their version for manual DClaw upload.

## Final Verification

- [ ] Run `git diff --check`.
- [ ] Run `npm test` and record the passing count.
- [ ] Run `git status --short` and verify the service repository contains only intended files.
- [ ] Commit and push the service changes with `git add src tests docs`, `git commit -m "feat: scope flow machines to agents"`, and `git push origin main`.
- [ ] On the server, run `git pull origin main`, `docker compose up -d --build`, and `docker logs --tail=100 worktool-bot-service`.
- [ ] Console acceptance test: configure Agent A's flow through Bot A, rebind Bot A to Agent B, confirm chat history remains while progress/assets/activation reset, then clear a conversation and confirm `agentSync.status` is `synced` or safely `pending` on a DClaw failure.
