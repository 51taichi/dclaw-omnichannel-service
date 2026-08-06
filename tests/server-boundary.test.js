import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("server does not alter agent replies with emoji fallbacks", () => {
  const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

  assert.equal(source.includes("ensureReplyEmoji"), false);
});
