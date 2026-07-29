# Agent Invocation Concurrency Design

## Goal

Prevent one slow DClaw request from blocking unrelated customer conversations while preserving message order and all existing Agent response behavior.

## Scope

Only the in-process Agent invocation scheduler changes. DClaw request payloads, retries, response validation, tags, assets, flow state, WorkTool delivery, and fallback replies remain unchanged.

## Scheduling Rules

1. Allow at most three Agent queue tasks to run at once by default.
2. Tasks with the same non-empty conversation key must run serially in enqueue order.
3. Tasks from different conversation keys may run concurrently while capacity is available.
4. Realtime tasks are selected before queued background tasks.
5. A rejected or timed-out task releases its slot and conversation lock.
6. Tasks without a conversation key use a shared fallback key and therefore remain serial.
7. The concurrency limit is configurable through `DCLAW_AGENT_CONCURRENCY`, with invalid values falling back to three.

## Server Integration

Every Agent invocation call site supplies its conversation key:

- customer replies: realtime
- legacy history analysis: background
- conversation reset synchronization: background
- proactive target synchronization: background
- attachment and validation retries: inherit the original request priority and conversation key

Retries inside one queued invocation keep the same slot and conversation lock. This preserves the current retry contract and prevents later messages in the same conversation from overtaking an earlier message.

## Verification

Automated tests must prove:

- three unrelated conversations can run concurrently;
- a fourth waits until a slot is released;
- the same conversation never overlaps and preserves enqueue order;
- realtime work runs before already queued background work;
- rejection releases capacity and does not stop either priority queue;
- all server call sites pass the appropriate conversation key and priority.

