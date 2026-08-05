import assert from "node:assert/strict";
import test from "node:test";
import { inspect } from "node:util";

import {
  CHANNEL_ERROR_CODES,
  ChannelError,
  toChannelError
} from "../src/channels/errors.js";

test("ChannelError accepts every documented channel error code", () => {
  const publicMessages = {
    invalid_contract: "Channel contract is invalid",
    unknown_provider: "Channel provider is unknown",
    unsupported_capability: "Channel capability is unsupported",
    authentication_required: "Channel authentication is required",
    rate_limited: "Channel rate limit exceeded",
    temporary_provider_failure: "Channel operation failed",
    permanent_provider_rejection: "Channel operation was rejected",
    invalid_provider_response: "Channel provider response is invalid"
  };
  const codes = Object.keys(publicMessages);

  assert.deepEqual(Object.values(CHANNEL_ERROR_CODES), codes);
  assert.equal(Object.isFrozen(CHANNEL_ERROR_CODES), true);

  for (const code of codes) {
    const error = new ChannelError(code, "caller-controlled message");
    assert.equal(error.code, code);
    assert.equal(error.message, publicMessages[code]);
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
  const secret = "secret-token-value";
  const cause = new Error(`provider diagnostic ${secret}`);
  const error = new ChannelError("rate_limited", `Please retry later ${secret}`, {
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
  assert.notEqual(error.cause, cause);
  assert.equal(Object.prototype.propertyIsEnumerable.call(error, "cause"), false);
  assert.equal(error.message.includes(secret), false);
  assert.equal(error.stack.includes(secret), false);
  assert.equal(inspect(error).includes(secret), false);
  assert.equal(JSON.stringify(error).includes(secret), false);
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

test("toChannelError rebuilds a secret-bearing ChannelError with safe code and context", () => {
  const secret = "typed-secret-token";
  const source = new ChannelError("authentication_required", "Authentication required", {
    provider: "whapi",
    retryable: false
  });
  source.message = `Authorization Bearer ${secret} rejected`;
  source.stack = `ChannelError: Authorization Bearer ${secret} rejected\n at provider`;

  const error = toChannelError(source, {
    channelAccountId: "account-42",
    operation: "sendMessage",
    token: secret
  });

  assert.notEqual(error, source);
  assert.equal(error.code, "authentication_required");
  assert.equal(error.message, "Channel authentication is required");
  assert.equal(error.provider, "whapi");
  assert.equal(error.channelAccountId, "account-42");
  assert.equal(error.operation, "sendMessage");
  assert.equal(error.retryable, false);
  assert.equal(Object.prototype.propertyIsEnumerable.call(error, "cause"), false);
  assert.equal(error.message.includes(secret), false);
  assert.equal(error.stack.includes(secret), false);
  assert.equal(inspect(error).includes(secret), false);
  assert.equal(JSON.stringify(error).includes(secret), false);
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
  assert.notEqual(error.cause, cause);
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
  assert.equal(error.stack.includes("secret-token"), false);
  assert.equal(inspect(error).includes("secret-token"), false);
  assert.equal(Object.prototype.propertyIsEnumerable.call(error, "cause"), false);
});
