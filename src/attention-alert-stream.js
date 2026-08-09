function writeEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function createAttentionAlertStreamHub({ heartbeatMs = 25_000 } = {}) {
  const subscribers = new Map();
  const interval = Math.max(1, Number(heartbeatMs) || 25_000);

  function remove(connection) {
    const connections = subscribers.get(connection.botId);
    connections?.delete(connection);
    if (connections && !connections.size) subscribers.delete(connection.botId);
  }

  function broadcast(botId, event, data) {
    for (const connection of subscribers.get(String(botId || "")) || []) {
      try { writeEvent(connection.res, event, data); } catch { remove(connection); }
    }
  }

  const heartbeat = setInterval(() => {
    for (const connections of subscribers.values()) {
      for (const connection of connections) {
        try { connection.res.write(`: heartbeat ${Date.now()}\n\n`); } catch { remove(connection); }
      }
    }
  }, interval);
  heartbeat.unref?.();

  return {
    async subscribe({ botId, req, res, loadSnapshot = () => [] }) {
      const normalizedBotId = String(botId || "").trim();
      const connection = { botId: normalizedBotId, req, res };
      if (!subscribers.has(normalizedBotId)) subscribers.set(normalizedBotId, new Set());
      subscribers.get(normalizedBotId).add(connection);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
      req.on("close", () => remove(connection));
      const alerts = await loadSnapshot();
      writeEvent(res, "attention.snapshot", { alerts: Array.isArray(alerts) ? alerts : [] });
      return () => remove(connection);
    },
    publishCreated({ botId, alert }) { if (alert) broadcast(botId, "attention.created", { alert }); },
    publishUpdated({ botId, alert }) { if (alert) broadcast(botId, "attention.updated", { alert }); },
    publishRead({ botId, alert }) { if (alert) broadcast(botId, "attention.read", { alert }); },
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
