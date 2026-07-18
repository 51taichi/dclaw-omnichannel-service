# Flow Activation Payload Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent normal inbound Agent calls from seeing node activation scripts while preserving dedicated activation delivery.

**Architecture:** Sanitize the compact flow payload at the DClaw request boundary. Apply sanitization to both the serialized message and metadata while leaving the dedicated activation request's immutable task reference message unchanged.

**Tech Stack:** Node.js 22, ES modules, node:test.

## Global Constraints

- Do not change activation scheduling, attempts, cancellation, or persistence.
- Do not modify Agent workspace files.
- Preserve node goal, completion criteria, collection fields, and conversation tips.

---

### Task 1: Isolate activation configuration from normal inbound payloads

**Files:**
- Modify: `src/dclaw.js`
- Test: `tests/dclaw-request-sanitization.test.js`
- Test: `tests/dclaw-activation.test.js`

**Interfaces:**
- Consumes: `buildDclawRequest({ binding, conversation, message, flow })`
- Produces: normal request flow payload without node `activation`

- [ ] Add a failing test asserting normal request message and metadata omit `activation` from `machine.nodes` and `currentNode` while retaining node goals.
- [ ] Run `node --test tests/dclaw-request-sanitization.test.js` and confirm the new assertion fails because activation is present.
- [ ] Add minimal flow sanitization in `src/dclaw.js` for normal inbound requests.
- [ ] Run the request sanitization and activation request tests and confirm both pass.
- [ ] Run the complete test suite.
