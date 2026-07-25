import assert from "node:assert/strict";
import test from "node:test";
import { getDclawRequestMessageMaxChars, invokeDclawAgentWithRetry } from "../src/dclaw.js";

const binding = {
  agentApiUrl: "https://dclaw.example.test/api/open/v1/targets/demo/messages",
  agentApiKey: "test-key"
};

test("sanitizes lone Unicode surrogates before sending DClaw requests", async () => {
  const originalFetch = globalThis.fetch;
  let sentPayload;
  globalThis.fetch = async (_url, options) => {
    sentPayload = JSON.parse(options.body);
    return new Response(JSON.stringify({ reply: "ok" }), {
      headers: { "content-type": "application/json" }
    });
  };

  try {
    await invokeDclawAgentWithRetry({
      binding,
      request: {
        message: `正常 Emoji 😀，孤立高代理：\uD83D`,
        metadata: { nested: ["正常", "\uDC00"] }
      },
      maxAttempts: 1,
      timeoutMs: 25
    });

    assert.equal(sentPayload.message, "正常 Emoji 😀，孤立高代理：�");
    assert.deepEqual(sentPayload.metadata.nested, ["正常", "�"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

test("retries DClaw gateway failures", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response("Bad Gateway", { status: 502 });
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

test("does not retry non-retryable DClaw failures", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return new Response("Internal Server Error", { status: 500 });
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

test("rejects an oversized request before calling DClaw", async () => {
  const previousLimit = process.env.DCLAW_REQUEST_MESSAGE_MAX_CHARS;
  process.env.DCLAW_REQUEST_MESSAGE_MAX_CHARS = "1000";
  try {
    assert.equal(getDclawRequestMessageMaxChars(), 1000);
    await assert.rejects(
      invokeDclawAgentWithRetry({
        binding,
        request: { message: "x".repeat(1001) },
        maxAttempts: 2,
        timeoutMs: 25
      }),
      (error) => error?.errorType === "agent_request_too_long"
    );
  } finally {
    if (previousLimit === undefined) delete process.env.DCLAW_REQUEST_MESSAGE_MAX_CHARS;
    else process.env.DCLAW_REQUEST_MESSAGE_MAX_CHARS = previousLimit;
  }
});

test("does not wrap malformed JSON responses as valid reply objects", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"reply":"少了结尾"', {
    headers: { "content-type": "application/json" }
  });

  try {
    const result = await invokeDclawAgentWithRetry({
      binding,
      request: { message: "hello" },
      maxAttempts: 1,
      timeoutMs: 25
    });

    assert.equal(result.reply, '{"reply":"少了结尾"');
    assert.equal(result.response, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not wrap malformed streaming text as a valid reply object", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    [
      'data: {"object":"content","type":"text","delta":true,"text":"{\\"reply\\":\\"少了结尾\\""}',
      "",
      "data: [DONE]",
      ""
    ].join("\n"),
    { headers: { "content-type": "text/event-stream" } }
  );

  try {
    const result = await invokeDclawAgentWithRetry({
      binding,
      request: { message: "hello" },
      maxAttempts: 1,
      timeoutMs: 25
    });

    assert.equal(result.reply, '{"reply":"少了结尾"');
    assert.equal(result.response, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
