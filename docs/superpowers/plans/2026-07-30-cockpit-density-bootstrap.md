# Cockpit Density And Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compress the cockpit layout and generate the first previous-day snapshot for Bots that have no cockpit data.

**Architecture:** Keep presentation changes in the dedicated cockpit client and stylesheet. Add a small dependency-injected bootstrap service that runs once at service startup and calls the existing aggregator only for missing Bot snapshots.

**Tech Stack:** Node.js, browser JavaScript, CSS, SQLite repositories, `node:test`.

## Global Constraints

- Do not aggregate when a user opens the cockpit.
- Do not await analytics work in the inbound reply path.
- Use the shared top Toast for status messages.
- Preserve per-Bot isolation.

---

### Task 1: Compact cockpit layout

**Files:**
- Modify: `tests/console-cockpit-boundary.test.js`
- Modify: `public/console/cockpit.js`
- Modify: `public/console/styles.css`

**Interfaces:**
- Consumes: overview response from `/api/cockpit/:botId/overview`.
- Produces: `cockpitFreshnessHelp`, compact metric cards, ordered dashboard regions.

- [ ] Write boundary assertions for the help icon, removed summary card, DOM ordering, and scroll CSS.
- [ ] Run `node --test tests/console-cockpit-boundary.test.js` and confirm failure.
- [ ] Update markup and CSS with the compact layout.
- [ ] Re-run the boundary test and confirm it passes.
- [ ] Commit the page changes.

### Task 2: First previous-day snapshot

**Files:**
- Create: `tests/cockpit-bootstrap.test.js`
- Create: `src/cockpit-bootstrap.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `listBots()`, `getLatestSnapshot({ botId, periodType })`, and `aggregateBot({ botId, throughAt })`.
- Produces: `createCockpitBootstrap(...).run({ throughAt })`.

- [ ] Write tests proving only missing Bots are aggregated and failures are isolated.
- [ ] Run `node --test tests/cockpit-bootstrap.test.js` and confirm failure.
- [ ] Implement the bootstrap service and start it without blocking `app.listen`.
- [ ] Re-run bootstrap and server boundary tests.
- [ ] Run `npm test`, health-check the service, and commit.
