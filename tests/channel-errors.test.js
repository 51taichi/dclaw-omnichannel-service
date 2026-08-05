import assert from "node:assert/strict";
import test from "node:test";

import {
  CHANNEL_ERROR_CODES,
  ChannelError,
  toChannelError
} from "../src/channels/errors.js";

test("ChannelError accepts every documented channel error code", () => {
  const codes = [
    "invalid_contract",
    "unknown_provider",
    "unsupported_capability",
    "authentication_required",
    "rate_limited",
    "temporary_provider_failure",
    "permanent_provider_rejection",
    "invalid_provider_response"
  ];

  assert.deepEqual(Object.values(CHANNEL_ERROR_CODES), codes);
  assert.equal(Object.isFrozen(CHANNEL_ERROR_CODES), true);

  for (const code of codes) {
    const error = new ChannelError(code, "Public channel error");
    assert.equal(error.code, code);
    assert.equal(error.message, "Public channel error");
  }
});

test("ChannelError rejects an unknown error code", () => {
  assert.throws(
    () => new ChannelError("provider_database_dump", "Public channel error"),
    TypeError
  );
});

test("ChannelError code validation does not rely on mutable Set state", () => {
  const originalHas = Set.prototype.has;
  Set.prototype.has = () => true;
  try {
    assert.throws(
      () => new ChannelError("provider_database_dump", "Public channel error"),
      TypeError
    );
  } finally {
    Set.prototype.has = originalHas;
  }
});

test("ChannelError exposes only safe supplied metadata", () => {
  const cause = new Error("provider diagnostic");
  const error = new ChannelError("rate_limited", "Please retry later", {
    provider: "whapi",
    channelAccountId: "account-42",
    operation: "sendMessage",
    retryable: true,
    token: "secret-token",
    authorization: "Bearer secret-token",
    headers: { authorization: "Bearer secret-token" },
    providerResponse: { body: "raw provider body" },
    rawBody: "raw body",
    arbitrary: { nested: "value" },
    cause
  });

  assert.deepEqual(Object.keys(error), [
    "name",
    "code",
    "provider",
    "channelAccountId",
    "operation",
    "retryable"
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(error)), {
    name: "ChannelError",
    code: "rate_limited",
    provider: "whapi",
    channelAccountId: "account-42",
    operation: "sendMessage",
    retryable: true
  });
  assert.equal(error.cause, cause);
  assert.equal(Object.prototype.propertyIsEnumerable.call(error, "cause"), false);
  assert.equal(JSON.stringify(error).includes("secret-token"), false);
  assert.equal(JSON.stringify(error).includes("raw provider body"), false);
  assert.equal(JSON.stringify(error).includes("raw body"), false);
});

test("ChannelError omits safe metadata that was not supplied", () => {
  const error = new ChannelError("unknown_provider", "Unknown provider");

  assert.deepEqual(Object.keys(error), ["name", "code"]);
});

test("ChannelError ignores inherited context metadata", () => {
  const context = Object.create({
    provider: "whapi",
    channelAccountId: "account-42",
    operation: "sendMessage",
    retryable: true
  });
  const error = new ChannelError("unknown_provider", "Unknown provider", context);

  assert.deepEqual(Object.keys(error), ["name", "code"]);
});

test("toChannelError passes a ChannelError through unchanged", () => {
  const expected = new ChannelError("authentication_required", "Authentication required", {
    provider: "whapi"
  });

  assert.equal(toChannelError(expected, { token: "must-not-matter" }), expected);
});

test("toChannelError turns unexpected values into a safe retryable temporary failure", () => {
  const cause = new Error("Authorization Bearer secret-token rejected raw body");
  const error = toChannelError(cause, {
    provider: "whapi",
    channelAccountId: "account-42",
    operation: "sendMessage",
    token: "secret-token",
    authorization: "Bearer secret-token",
    headers: { authorization: "Bearer secret-token" },
    providerResponse: { body: "raw provider body" },
    rawBody: "raw body",
    arbitrary: { nested: "value" }
  });

  assert.equal(error instanceof ChannelError, true);
  assert.equal(error.code, "temporary_provider_failure");
  assert.equal(error.message, "Channel operation failed");
  assert.equal(error.retryable, true);
  assert.equal(error.cause, cause);
  assert.deepEqual(JSON.parse(JSON.stringify(error)), {
    name: "ChannelError",
    code: "temporary_provider_failure",
    provider: "whapi",
    channelAccountId: "account-42",
    operation: "sendMessage",
    retryable: true
  });
  assert.equal(JSON.stringify(error).includes("secret-token"), false);
  assert.equal(JSON.stringify(error).includes("raw provider body"), false);
  assert.equal(JSON.stringify(error).includes("raw body"), false);
  assert.equal(Object.prototype.propertyIsEnumerable.call(error, "cause"), false);
});
