function writeEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function scopeKey(botId, groupId) {
  return `${String(botId || "").trim()}\u0000${String(groupId || "").trim()}`;
}

export function createGroupAutomationStreamHub({ heartbeatMs = 25_000 } = {}) {
  const subscribers = new Map();
  const intervalMs = Math.max(1, Number(heartbeatMs) || 25_000);

  function remove(connection) {
    const connections = subscribers.get(connection.key);
    if (!connections) return;
    connections.delete(connection);
    if (!connections.size) subscribers.delete(connection.key);
  }

  const heartbeat = setInterval(() => {
    for (const connections of subscribers.values()) {
      for (const connection of connections) {
        try {
          connection.res.write(`: heartbeat ${Date.now()}\n\n`);
        } catch {
          remove(connection);
        }
      }
    }
  }, intervalMs);
  heartbeat.unref?.();

  return {
    subscribe({ botId, groupId, req, res, snapshot = [] }) {
      const key = scopeKey(botId, groupId);
      const connection = { key, req, res };
      if (!subscribers.has(key)) subscribers.set(key, new Set());
      subscribers.get(key).add(connection);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
      writeEvent(res, "snapshot", {
        tasks: Array.isArray(snapshot) ? snapshot : []
      });
      req.on("close", () => remove(connection));
      return () => remove(connection);
    },

    publish({ botId, groupId, task = null, occurrence = null }) {
      for (const connection of subscribers.get(scopeKey(botId, groupId)) || []) {
        try {
          writeEvent(connection.res, "task_updated", { task, occurrence });
        } catch {
          remove(connection);
        }
      }
    },

    connectionCount() {
      let count = 0;
      for (const connections of subscribers.values()) count += connections.size;
      return count;
    },

    close() {
      clearInterval(heartbeat);
      for (const connections of subscribers.values()) {
        for (const connection of connections) connection.res.end?.();
      }
      subscribers.clear();
    }
  };
}
