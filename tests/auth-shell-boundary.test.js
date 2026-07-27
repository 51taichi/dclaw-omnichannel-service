import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const scriptUrl = new URL("../public/shared/auth-shell.js", import.meta.url);
const styleUrl = new URL("../public/shared/auth-shell.css", import.meta.url);

test("shared auth shell exposes stable three-state login behavior", () => {
  const source = fs.readFileSync(scriptUrl, "utf8");

  assert.equal(source.includes("/console/assets/deepmega-dclaw-logo-cropped.png"), true);
  assert.equal(source.includes("/shared/assets/auth-question.png"), true);
  assert.equal(source.includes("/shared/assets/auth-failure.png"), true);
  assert.equal(source.includes("/shared/assets/auth-success.png"), true);
  assert.match(source, /showSuccess\(\{ message, seconds = 3, onComplete \}\)/);
  assert.equal(source.includes('state = "idle"'), true);
  assert.equal(source.includes('state = "failure"'), true);
  assert.equal(source.includes('state = "success"'), true);
});

test("shared auth shell sizes brand and mascots without layout jumps", () => {
  const css = fs.readFileSync(styleUrl, "utf8");

  assert.match(css, /\.auth-shell-logo\s*\{[^}]*width:\s*clamp\(240px,\s*28vw,\s*300px\)/);
  assert.match(css, /\.auth-shell-account\[hidden\]\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.auth-shell-mascot-slot\s*\{[^}]*width:\s*min\(34%,\s*220px\)/);
  assert.match(css, /\.auth-shell\.is-failure \.auth-shell-mascot-slot\s*\{[^}]*width:\s*min\(38%,\s*250px\)/);
  assert.match(css, /\.auth-shell\.is-failure \.auth-shell-mascot\s*\{[^}]*transform:\s*scale\(1\.55\)/);
  assert.match(css, /@media \(max-width:\s*640px\)[\s\S]*width:\s*clamp\(112px,\s*34vw,\s*140px\)/);
});

test("all auth state assets are nonempty PNG files", () => {
  for (const name of ["auth-question.png", "auth-failure.png", "auth-success.png"]) {
    const file = new URL(`../public/shared/assets/${name}`, import.meta.url);
    const buffer = fs.readFileSync(file);
    assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG");
    assert.ok(buffer.length > 10_000);
  }
});
