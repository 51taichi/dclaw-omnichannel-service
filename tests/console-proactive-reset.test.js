import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");

test("clearing Bot-scoped content does not reference a removed proactive URL default", () => {
  assert.doesNotMatch(app, /DEFAULT_FILE_URL/);
  assert.match(app, /els\.proactiveForm\.fileUrl\.value = "";/);
});
