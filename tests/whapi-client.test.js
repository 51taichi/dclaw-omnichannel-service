import assert from "node:assert/strict";
import test from "node:test";

import { ChannelError } from "../src/channels/errors.js";
import { createWhapiClient } from "../src/channels/whapi/client.js";
import { mapWhapiHealth } from "../src/channels/whapi/health.js";

function response(status, body, contentType = "application/json") {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": contentType }
  });
}

test("Whapi client sends authenticated JSON requests to exact endpoints", async () => {
  const calls = [];
  const client = createWhapiClient({
    token: "secret-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, url.includes("/messages/")
        ? { sent: true, message: { id: "message-1", status: "pending" } }
        : { chats: [] });
    }
  });

  await client.sendText({ to: "123@s.whatsapp.net", body: "hello", mentions: ["456@s.whatsapp.net"] });
  await client.sendMedia("image", { to: "123@s.whatsapp.net", media: "https://cdn.example/a.jpg" });
  await client.listChats({ count: 20, offset: 40 });
  await client.getGroup("group/id@g.us");

  assert.equal(calls[0].url, "https://gate.whapi.cloud/messages/text");
  assert.equal(calls[0].options.headers.authorization, "Bearer secret-token");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    to: "123@s.whatsapp.net",
    body: "hello",
    mentions: ["456@s.whatsapp.net"]
  });
  assert.equal(calls[1].url, "https://gate.whapi.cloud/messages/image");
  assert.equal(calls[2].url, "https://gate.whapi.cloud/chats?count=20&offset=40");
  assert.equal(calls[3].url, "https://gate.whapi.cloud/groups/group%2Fid%40g.us");
  assert.equal(calls.every(({ options }) => options.signal instanceof AbortSignal), true);
});

test("Whapi client classifies failures without exposing provider bodies or token", async () => {
  const cases = [
    [401, "authentication_required", false],
    [403, "permanent_provider_rejection", false],
    [429, "rate_limited", true],
    [503, "temporary_provider_failure", true]
  ];
  for (const [status, code, retryable] of cases) {
    const client = createWhapiClient({
      token: "secret-token",
      fetchImpl: async () => response(status, { error: "provider-secret-body" })
    });
    await assert.rejects(() => client.getHealth(), (error) => {
      assert.equal(error instanceof ChannelError, true);
      assert.equal(error.code, code);
      assert.equal(error.retryable, retryable);
      assert.equal(JSON.stringify(error).includes("secret"), false);
      return true;
    });
  }
});

test("Whapi client rejects malformed success data and sanitizes network errors", async () => {
  const malformed = createWhapiClient({ token: "token", fetchImpl: async () => response(200, "not-json", "text/plain") });
  await assert.rejects(() => malformed.getHealth(), { code: "invalid_provider_response" });

  const failed = createWhapiClient({ token: "secret-token", fetchImpl: async () => { throw new Error("secret-token leaked"); } });
  await assert.rejects(() => failed.getHealth(), (error) => {
    assert.equal(error.code, "temporary_provider_failure");
    assert.equal(JSON.stringify(error).includes("secret-token"), false);
    return true;
  });
});

test("Whapi health maps connected, authorization, transition, and stopped states", () => {
  assert.deepEqual(mapWhapiHealth({ status: { text: "AUTH" } }), { status: "connected", providerStatus: "AUTH" });
  assert.deepEqual(mapWhapiHealth({ status: { text: "QR" } }), { status: "auth-required", providerStatus: "QR" });
  assert.equal(mapWhapiHealth({ status: { text: "INIT" } }, { transitionAgeMs: 20_000 }).status, "degraded");
  assert.equal(mapWhapiHealth({ status: { text: "LAUNCH" } }, { transitionAgeMs: 60_000 }).status, "disconnected");
  assert.equal(mapWhapiHealth({ status: { text: "STOP" } }).status, "disconnected");
  assert.equal(mapWhapiHealth({ status: { text: "SYNC_ERROR" } }).status, "degraded");
  assert.throws(() => mapWhapiHealth({ status: {} }), { code: "invalid_provider_response" });
});
