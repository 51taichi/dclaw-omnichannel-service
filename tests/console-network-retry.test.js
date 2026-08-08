import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const helperUrl = new URL("../public/console/network-retry.js", import.meta.url);
const appSource = fs.readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const htmlSource = fs.readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");

function functionBody(name) {
  const start = appSource.indexOf(`function ${name}(`);
  const next = appSource.indexOf("\nfunction ", start + 1);
  return appSource.slice(start, next === -1 ? appSource.length : next);
}

function loadNetworkRetry() {
  assert.equal(fs.existsSync(helperUrl), true, "network retry helper must exist");
  const context = {};
  vm.runInNewContext(fs.readFileSync(helperUrl, "utf8"), context);
  return context.DClawNetworkRetry;
}

test("network retry retries one marked network failure", async () => {
  const retry = loadNetworkRetry();
  let attempts = 0;

  const result = await retry.run(async () => {
    attempts += 1;
    if (attempts === 1) {
      throw Object.assign(new TypeError("Failed to fetch"), { isNetworkError: true });
    }
    return "ok";
  });

  assert.equal(result, "ok");
  assert.equal(attempts, 2);
});

test("network retry stops after the configured retry", async () => {
  const retry = loadNetworkRetry();
  let attempts = 0;

  await assert.rejects(
    retry.run(async () => {
      attempts += 1;
      throw Object.assign(new TypeError("Failed to fetch"), { isNetworkError: true });
    }),
    /Failed to fetch/
  );

  assert.equal(attempts, 2);
});

test("network retry never retries an HTTP or business error", async () => {
  const retry = loadNetworkRetry();
  let attempts = 0;

  await assert.rejects(
    retry.run(async () => {
      attempts += 1;
      throw new Error("HTTP 500");
    }),
    /HTTP 500/
  );

  assert.equal(attempts, 1);
});

test("only conversation detail loading uses the network retry helper", () => {
  assert.ok(htmlSource.indexOf("./network-retry.js") < htmlSource.indexOf("./app.js"));
  assert.match(functionBody("request"), /isNetworkError\s*=\s*true/);
  assert.match(functionBody("openFlowSession"), /DClawNetworkRetry\.run/);
  assert.doesNotMatch(functionBody("sendManualReply"), /DClawNetworkRetry\.run/);
  assert.doesNotMatch(functionBody("toggleSelectedConversationHandoff"), /DClawNetworkRetry\.run/);
  assert.doesNotMatch(functionBody("resetSelectedConversation"), /DClawNetworkRetry\.run/);
});
