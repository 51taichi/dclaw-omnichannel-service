import assert from "node:assert/strict";
import test from "node:test";
import { createWorktoolHistoryCache } from "../src/worktool-history-cache.js";

test("refreshes newest pages and stops at a known message", async () => {
  const pages = [];
  const stored = [];
  const cache = createWorktoolHistoryCache({
    pageSize: 2,
    listPage: async ({ page }) => {
      pages.push(page);
      if (page === 1) {
        return {
          items: [
            { messageId: "new-2", targetName: "阿三" },
            { messageId: "new-1", targetName: "阿三" }
          ],
          pagination: { pageNum: 1, totalPage: 2 }
        };
      }
      return {
        items: [{ messageId: "known", targetName: "阿三" }],
        pagination: { pageNum: 2, totalPage: 2 }
      };
    },
    hasMessageId: ({ messageId }) => messageId === "known",
    upsertItems: ({ items }) => {
      stored.push(...items);
      return items.length;
    }
  });

  const result = await cache.refreshBot({ robotId: "bot_a" });
  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(stored.map((item) => item.messageId), ["new-2", "new-1"]);
  assert.equal(result.stoppedAtKnown, true);
  assert.equal(result.inserted, 2);
});

test("shares one refresh per bot and releases the lock after failure", async () => {
  let calls = 0;
  let rejectFirst;
  const firstFailure = new Promise((_resolve, reject) => {
    rejectFirst = reject;
  });
  const cache = createWorktoolHistoryCache({
    listPage: async () => {
      calls += 1;
      if (calls === 1) return firstFailure;
      return { items: [], pagination: { pageNum: 1, totalPage: 1 } };
    },
    hasMessageId: () => false,
    upsertItems: () => 0
  });

  const first = cache.refreshBot({ robotId: "bot_a" });
  const shared = cache.refreshBot({ robotId: "bot_a" });
  rejectFirst(new Error("temporary failure"));
  await assert.rejects(first, /temporary failure/);
  await assert.rejects(shared, /temporary failure/);
  assert.equal(calls, 1);
  await cache.refreshBot({ robotId: "bot_a" });
  assert.equal(calls, 2);
});

test("reconciles legacy sessions after committing cache pages", async () => {
  const events = [];
  const cache = createWorktoolHistoryCache({
    listPage: async () => ({
      items: [{ messageId: "m1", targetName: "阿三" }],
      pagination: { pageNum: 1, totalPage: 1 }
    }),
    hasMessageId: () => false,
    upsertItems: ({ items }) => {
      events.push(`stored:${items.length}`);
      return items.length;
    },
    onRefreshed: async ({ robotId }) => {
      events.push(`reconciled:${robotId}`);
    }
  });

  await cache.refreshBot({ robotId: "bot_a" });
  assert.deepEqual(events, ["stored:1", "reconciled:bot_a"]);
});
