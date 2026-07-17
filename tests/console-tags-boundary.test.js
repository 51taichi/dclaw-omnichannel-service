import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");

test("console has customer tags workspace tab", () => {
  assert.match(html, /data-workspace-tab="tags"/);
  assert.match(html, /id="tagSchemaPanel"/);
});

test("console loads and saves tag schemas", () => {
  assert.match(js, /loadTagSchema/);
  assert.match(js, /saveTagSchema/);
  assert.match(js, /\/api\/tag-schemas\//);
});

test("console renders tag chips and tag filters", () => {
  assert.match(js, /renderConversationTags/);
  assert.match(js, /flowSessionTagFilter/);
  assert.match(css, /\.tag-chip/);
});
