function writeEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function createTagAlertStreamHub({ heartbeatMs = 25_000 } = {}) {
  const subscribers = new Map();
  const normalizedHeartbeatMs = Math.max(1, Number(heartbeatMs) || 25_000);

  function remove(connection) {
    const connections = subscribers.get(connection.botId);
    if (!connections) return;
    connections.delete(connection);
    if (!connections.size) subscribers.delete(connection.botId);
  }

  function broadcast(botId, event, data) {
    for (const connection of subscribers.get(String(botId || "")) || []) {
      try {
        writeEvent(connection.res, event, data);
      } catch {
        remove(connection);
      }
    }
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
  }, normalizedHeartbeatMs);
  heartbeat.unref?.();

  return {
    subscribe({ botId, req, res, snapshot = [] }) {
      const normalizedBotId = String(botId || "").trim();
      const connection = { botId: normalizedBotId, req, res };
      if (!subscribers.has(normalizedBotId)) {
        subscribers.set(normalizedBotId, new Set());
      }
      subscribers.get(normalizedBotId).add(connection);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
      writeEvent(res, "alerts.snapshot", {
        alerts: Array.isArray(snapshot) ? snapshot : []
      });
      req.on("close", () => remove(connection));
      return () => remove(connection);
    },

    publishCreated({ botId, batchId = "", alerts = [] }) {
      if (!Array.isArray(alerts) || !alerts.length) return;
      broadcast(botId, "alerts.created", { batchId, alerts });
    },

    publishRead({ botId, alertId, readAt }) {
      broadcast(botId, "alerts.read", { alertId, readAt });
    },

    connectionCount() {
      let count = 0;
      for (const connections of subscribers.values()) count += connections.size;
      return count;
    },

    close() {
      clearInterval(heartbeat);
      for (const connections of subscribers.values()) {
        for (const connection of connections) {
          connection.res.end?.();
        }
      }
      subscribers.clear();
    }
  };
}
