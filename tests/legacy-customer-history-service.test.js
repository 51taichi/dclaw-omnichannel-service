import assert from "node:assert/strict";
import test from "node:test";
import { createLegacyCustomerHistoryService } from "../src/legacy-customer-history.js";

function createHarness(overrides = {}) {
  const state = {
    sessions: [],
    syncUpdates: [],
    imported: [],
    customerHistoryCalls: 0
  };
  const importedMessages = [];
  const service = createLegacyCustomerHistoryService({
    listCustomerHistory: async () => {
      state.customerHistoryCalls += 1;
      return {
        messages: [{
          sourceKey: "customer-1",
          title: "魔兮-18570860666",
          direction: "inbound",
          content: "之前已经付款",
          createdAt: "2026-07-20T01:00:00.000Z",
          rawPayload: { titleList: "魔兮-18570860666" }
        }],
        titles: ["魔兮-18570860666"],
        rawCount: 1
      };
    },
    createLegacyFlowSession: (input) => {
      state.sessions.push(input);
      return { customerOrigin: "legacy", historySyncStatus: "loading" };
    },
    updateLegacyHistorySync: (input) => {
      state.syncUpdates.push(input);
      return input;
    },
    insertImportedConversationMessages: ({ source, messages }) => {
      state.imported.push({ source, messages });
      importedMessages.push(...messages.map((message) => ({ ...message, source })));
      return messages.length;
    },
    listImportedConversationMessages: () => importedMessages,
    listConversationMessages: () => [{
      source: "local",
      direction: "inbound",
      senderName: "魔兮",
      content: "当前消息",
      createdAt: "2026-07-25T01:00:00.000Z"
    }],
    listCachedApiMessages: ({ targetNames }) => targetNames.includes("魔兮-18570860666")
      ? [{
          messageId: "api-1",
          commandIndex: 0,
          targetName: "魔兮-18570860666",
          direction: "outbound",
          content: "此前系统回复",
          createdAt: "2026-07-20T01:01:00.000Z",
          rawPayload: {}
        }]
      : [],
    listLegacyFlowSessionTargets: () => [],
    ...overrides
  });
  return { service, state, importedMessages };
}

test("prepares one legacy customer sync for concurrent first messages", async () => {
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const harness = createHarness({
    listCustomerHistory: async () => {
      harness.state.customerHistoryCalls += 1;
      await waiting;
      return { messages: [], titles: [], rawCount: 0 };
    }
  });
  const input = {
    botId: "bot_a",
    conversationKey: "bot_a:private:魔兮",
    title: "魔兮",
    machine: { config: { nodes: [{ id: "first" }, { id: "final" }] } }
  };

  const first = harness.service.prepareLegacyCustomer(input);
  const second = harness.service.prepareLegacyCustomer(input);
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(harness.state.customerHistoryCalls, 1);
  assert.equal(harness.state.sessions.length, 1);
  assert.equal(firstResult.status, "empty");
  assert.deepEqual(secondResult, firstResult);
});

test("imports customer history and cached API replies through all aliases", async () => {
  const { service, state } = createHarness();
  const result = await service.prepareLegacyCustomer({
    botId: "bot_a",
    conversationKey: "bot_a:private:魔兮",
    title: "魔兮",
    machine: { config: { nodes: [{ id: "final" }] } }
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.aliases, ["魔兮", "魔兮-18570860666"]);
  assert.deepEqual(state.imported.map((entry) => entry.source), [
    "worktool_customer_history",
    "worktool_api_history"
  ]);
  assert.equal(state.imported[0].messages[0].senderName, "魔兮-18570860666");
  assert.equal(state.imported[1].messages[0].sourceKey, "api-1:0:魔兮-18570860666");
  assert.equal(state.syncUpdates.at(-1).importedCount, 1);
});

test("builds bounded context from stored imported and local messages", async () => {
  const { service } = createHarness();
  await service.prepareLegacyCustomer({
    botId: "bot_a",
    conversationKey: "bot_a:private:魔兮",
    title: "魔兮",
    machine: { config: { nodes: [{ id: "final" }] } }
  });

  const context = service.buildStoredLegacyContext({
    botId: "bot_a",
    conversationKey: "bot_a:private:魔兮"
  });

  assert.equal(context.importedCustomerCount, 1);
  assert.deepEqual(context.messages.map((message) => message.content), [
    "之前已经付款",
    "此前系统回复",
    "当前消息"
  ]);
});

test("history failures mark the session failed and do not reject", async () => {
  const { service, state } = createHarness({
    listCustomerHistory: async () => {
      throw new Error("request timed out");
    }
  });

  const result = await service.prepareLegacyCustomer({
    botId: "bot_a",
    conversationKey: "bot_a:private:魔兮",
    title: "魔兮",
    machine: { config: { nodes: [{ id: "final" }] } }
  });

  assert.equal(result.status, "failed");
  assert.match(state.syncUpdates.at(-1).errorMessage, /timed out/);
});

test("backfills cached API replies for legacy aliases after a bot refresh", async () => {
  const { service, state, importedMessages } = createHarness({
    listLegacyFlowSessionTargets: () => [{
      conversationKey: "bot_a:private:魔兮",
      receivedName: "魔兮"
    }],
    listImportedConversationMessages: () => [{
      source: "worktool_customer_history",
      rawPayload: { titleList: "魔兮-18570860666" }
    }, ...importedMessages]
  });

  const result = await service.backfillCachedHistoryForBot({ botId: "bot_a" });

  assert.equal(result.conversationCount, 1);
  assert.equal(result.importedCount, 1);
  assert.equal(state.imported.at(-1).source, "worktool_api_history");
});

test("large cache backfills yield between bounded conversation batches", async () => {
  let yieldCount = 0;
  const targets = Array.from({ length: 51 }, (_, index) => ({
    conversationKey: `bot_a:private:客户${index}`,
    receivedName: `客户${index}`
  }));
  const { service } = createHarness({
    listLegacyFlowSessionTargets: () => targets,
    listImportedConversationMessages: () => [],
    listCachedApiMessages: () => [],
    yieldToEventLoop: async () => {
      yieldCount += 1;
    }
  });

  const result = await service.backfillCachedHistoryForBot({ botId: "bot_a" });

  assert.equal(result.conversationCount, 51);
  assert.equal(yieldCount, 2);
});
