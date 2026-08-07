import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSecretUpdate } from "../src/secret-update.js";

test("missing blank and masked secret updates mean preserve the stored value", () => {
  for (const value of [undefined, null, "", "   ", "*", "*****", "  *****  "]) {
    assert.equal(normalizeSecretUpdate(value), undefined);
  }
});

test("a new non-empty secret is normalized for replacement", () => {
  assert.equal(normalizeSecretUpdate("  replacement-secret  "), "replacement-secret");
  assert.equal(normalizeSecretUpdate("secret*value"), "secret*value");
});
