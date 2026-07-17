# Contact Cleanup Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a safe verification path for the deleted-friend cleanup feature before any production delete behavior exists.

**Architecture:** Add a focused WeCom API client with dependency-injected fetch for tests, a read-only verification CLI, and a design note that records the product safety rules. The CLI obtains a token, lists external contacts for one employee userid, then inspects one external contact detail to prove the `follow_user` mapping.

**Tech Stack:** Node.js ESM, built-in `fetch`, `node:test`, dotenv.

## Global Constraints

- Do not store or print the WeCom Secret in source code, docs, tests, or final output.
- Do not call WorkTool delete APIs in this phase.
- Treat existing unrelated dirty files as user work and leave them out of this commit.

---

### Task 1: WeCom Client

**Files:**
- Create: `src/wecom.js`
- Test: `tests/wecom-client.test.js`

**Interfaces:**
- Produces: `getWecomAccessToken({ corpId, secret, fetchImpl })`, `listWecomExternalContacts({ accessToken, userId, fetchImpl })`, `getWecomExternalContact({ accessToken, externalUserId, fetchImpl })`, `summarizeExternalContactDetail(data, expectedUserId)`, `maskSensitiveValue(value)`

- [x] **Step 1: Write failing tests**
- [x] **Step 2: Run tests and verify missing module failure**
- [x] **Step 3: Implement WeCom client**
- [x] **Step 4: Run tests and verify pass**

### Task 2: Verification CLI And Design

**Files:**
- Create: `scripts/verify-wecom-contact-mapping.js`
- Create: `docs/superpowers/specs/2026-07-17-contact-cleanup-design.md`

**Interfaces:**
- Consumes: WeCom client functions from Task 1.
- Produces: a read-only command `node scripts/verify-wecom-contact-mapping.js`.

- [x] **Step 1: Add read-only verification script**
- [x] **Step 2: Add design document**
- [x] **Step 3: Run targeted tests**
- [x] **Step 4: Run full test suite**
- [x] **Step 5: Commit and push only related files**
