import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAttentionAlert } from "../src/attention-alert.js";

test("attention alerts normalize one required internal escalation", () => {
  assert.deepEqual(normalizeAttentionAlert({
    required: true,
    reason: "需要人工确认当地法规",
    evidenceMessageId: "41",
    evidenceText: "这个产品可以寄到德国吗？"
  }), {
    required: true,
    reason: "需要人工确认当地法规",
    evidenceMessageId: "41",
    evidenceText: "这个产品可以寄到德国吗？"
  });
});

test("attention alerts default to disabled", () => {
  assert.deepEqual(normalizeAttentionAlert(undefined), {
    required: false,
    reason: "",
    evidenceMessageId: "",
    evidenceText: ""
  });
});
