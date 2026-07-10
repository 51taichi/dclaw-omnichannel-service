import assert from "node:assert/strict";
import test from "node:test";
import { invokeDclawAgentWithRetry } from "../src/dclaw.js";

const binding = {
  agentApiUrl: "https://dclaw.example.test/api/open/v1/targets/demo/messages",
  agentApiKey: "test-key"
};

test("retries a timed out DClaw invocation once", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }
    return new Response(JSON.stringify({ reply: "ok" }), {
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const result = await invokeDclawAgentWithRetry({
      binding,
      request: { message: "hello" },
      maxAttempts: 2,
      timeoutMs: 25
    });

    assert.equal(attempts, 2);
    assert.deepEqual(result.response, { reply: "ok" });
    assert.equal(result.attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not retry non-timeout DClaw failures", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    throw new Error("DClaw OpenAPI failed: 500");
  };

  try {
    await assert.rejects(
      invokeDclawAgentWithRetry({
        binding,
        request: { message: "hello" },
        maxAttempts: 2,
        timeoutMs: 25
      }),
      /DClaw OpenAPI failed/
    );
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
