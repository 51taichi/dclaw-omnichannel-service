import assert from "node:assert/strict";
import test from "node:test";

import { createGroupAutomationWorker } from "../src/group-automation-worker.js";

test("new phased worker exposes explicit occurrence recovery and processing methods", () => {
  const worker = createGroupAutomationWorker({
    db: {},
    historySyncWorker: { ensureSyncedThrough() {} },
    listDclawHistory() {},
    analyzeChunk() {},
    mergeAnalyses() {},
    finalizeConditional() {},
    finalizeSummary() {},
    sendGroupMessage() {}
  });
  assert.equal(typeof worker.recoverExpiredLeases, "function");
  assert.equal(typeof worker.runOccurrenceTick, "function");
  assert.equal(typeof worker.processOccurrence, "function");
});
