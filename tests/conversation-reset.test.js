import assert from "node:assert/strict";
import test from "node:test";
import { runConversationResetRequests } from "../src/conversation-reset.js";

const workspaceRequest = { message: "workspace" };
const memoryClearRequest = { message: "/clear" };

test("conversation reset runs workspace cleanup before memory clear", async () => {
  const calls = [];
  const result = await runConversationResetRequests({
    workspaceRequest,
    memoryClearRequest,
    invoke: async (request) => {
      calls.push(request.message);
      return request === workspaceRequest
        ? { reply: '{"ok":true,"eventType":"conversation_reset"}' }
        : { reply: "**History Cleared!**\n- Memory is now empty" };
    }
  });

  assert.deepEqual(calls, ["workspace", "/clear"]);
  assert.equal(result.ok, true);
});

test("conversation reset still attempts memory clear when workspace cleanup fails", async () => {
  const calls = [];
  const result = await runConversationResetRequests({
    workspaceRequest,
    memoryClearRequest,
    invoke: async (request) => {
      calls.push(request.message);
      if (request === workspaceRequest) throw new Error("workspace failed");
      return { reply: "**History Cleared!**\n- Memory is now empty" };
    }
  });

  assert.deepEqual(calls, ["workspace", "/clear"]);
  assert.equal(result.ok, false);
  assert.equal(result.workspaceError.message, "workspace failed");
  assert.equal(result.memoryError, null);
});

test("group reset completes with workspace cleanup only", async () => {
  const calls = [];
  const result = await runConversationResetRequests({
    workspaceRequest,
    memoryClearRequest: null,
    invoke: async (request) => {
      calls.push(request.message);
      return { reply: '{"ok":true,"eventType":"conversation_reset"}' };
    }
  });

  assert.deepEqual(calls, ["workspace"]);
  assert.equal(result.ok, true);
});
