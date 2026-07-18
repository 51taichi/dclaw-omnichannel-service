# Conversation First Seen Date Tag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assign Beijing-date customer tags from the first persisted private conversation and backfill existing conversations.

**Architecture:** Centralize automatic date tagging in the database conversation upsert path. Use immutable `conversations.created_at` as first-seen time and run an Agent-scoped private-conversation backfill whenever an enabled date-tag schema is saved.

**Tech Stack:** Node.js 22, node:sqlite, node:test.

## Global Constraints

- Private conversations only.
- Clearing conversation messages must not change the date.
- Existing historical conversations must be backfilled.
- WorkTool friend-added callbacks remain supported but are not required.

---

### Task 1: First-seen date tagging and history backfill

**Files:**
- Modify: `src/db.js`
- Test: `tests/db-tags.test.js`

**Interfaces:**
- Consumes: `upsertConversation({ botId, agentId, conversationKey, message })`
- Produces: one system date tag derived from `conversations.created_at`

- [ ] Add failing tests for automatic private tagging, group exclusion, stable dates after repeat upserts, and historical backfill on schema save.
- [ ] Run `node --test tests/db-tags.test.js` and confirm the new tests fail.
- [ ] Import Beijing date formatting and implement transaction-safe system date-tag synchronization.
- [ ] Invoke synchronization from conversation upsert and Agent tag-schema save.
- [ ] Run targeted tests and then the complete suite.
