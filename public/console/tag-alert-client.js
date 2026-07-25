(function attachTagAlertClient(global) {
  const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 10000];

  function createTagAlertClient({
    fetchImpl = global.fetch.bind(global),
    onChange,
    playSound,
    unlockSound,
    onError
  } = {}) {
    const alerts = new Map();
    let botId = "";
    let authHeaders = {};
    let controller = null;
    let reconnectTimer = null;
    let reconnectAttempt = 0;
    let generation = 0;

    function values() {
      return [...alerts.values()].sort((left, right) => Number(right.id) - Number(left.id));
    }

    function emitChange(reason) {
      onChange?.(values(), { reason });
    }

    function replaceSnapshot(nextAlerts) {
      alerts.clear();
      for (const alert of Array.isArray(nextAlerts) ? nextAlerts : []) {
        if (alert?.id !== undefined && alert?.id !== null) {
          alerts.set(String(alert.id), alert);
        }
      }
      emitChange("snapshot");
    }

    function appendCreated(payload) {
      const added = [];
      for (const alert of Array.isArray(payload?.alerts) ? payload.alerts : []) {
        const key = String(alert?.id ?? "");
        if (!key || alerts.has(key)) continue;
        alerts.set(key, alert);
        added.push(alert);
      }
      if (!added.length) return;
      emitChange("created");
      if (added.length) playSound?.(added);
    }

    function removeRead(payload) {
      const removed = alerts.delete(String(payload?.alertId ?? ""));
      if (removed) emitChange("read");
    }

    function handleEvent(eventName, payload) {
      if (eventName === "alerts.snapshot") {
        replaceSnapshot(payload?.alerts);
      } else if (eventName === "alerts.created") {
        appendCreated(payload);
      } else if (eventName === "alerts.read") {
        removeRead(payload);
      }
    }

    function parseEventFrame(frame) {
      let eventName = "message";
      const dataLines = [];
      for (const line of frame.split(/\r?\n/)) {
        if (!line || line.startsWith(":")) continue;
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
      if (!dataLines.length) return;
      try {
        handleEvent(eventName, JSON.parse(dataLines.join("\n")));
      } catch (error) {
        onError?.(error);
      }
    }

    function clearReconnectTimer() {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function scheduleReconnect(expectedGeneration) {
      if (!botId || expectedGeneration !== generation) return;
      const delay = RECONNECT_DELAYS_MS[
        Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
      ];
      reconnectAttempt += 1;
      clearReconnectTimer();
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        openStream(expectedGeneration);
      }, delay);
    }

    async function openStream(expectedGeneration) {
      if (!botId || expectedGeneration !== generation) return;
      controller = new AbortController();
      const streamUrl = `/api/tag-alerts/stream?botId=${encodeURIComponent(botId)}`;
      try {
        const response = await fetchImpl(streamUrl, {
          method: "GET",
          headers: authHeaders,
          signal: controller.signal,
          cache: "no-store"
        });
        if (!response.ok || !response.body) {
          throw new Error(`Tag alert stream failed: HTTP ${response.status}`);
        }
        reconnectAttempt = 0;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (expectedGeneration === generation) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            parseEventFrame(frame);
            boundary = buffer.indexOf("\n\n");
          }
        }
        if (expectedGeneration === generation && !controller.signal.aborted) {
          scheduleReconnect(expectedGeneration);
        }
      } catch (error) {
        if (expectedGeneration !== generation || controller?.signal.aborted) return;
        onError?.(error);
        scheduleReconnect(expectedGeneration);
      }
    }

    function disconnect() {
      generation += 1;
      clearReconnectTimer();
      controller?.abort();
      controller = null;
      botId = "";
      authHeaders = {};
      reconnectAttempt = 0;
      replaceSnapshot([]);
    }

    function connect(options = {}) {
      disconnect();
      botId = String(options.botId || "").trim();
      authHeaders = { ...(options.headers || {}) };
      if (!botId) return;
      generation += 1;
      openStream(generation);
    }

    async function markRead(alertId) {
      if (!botId || !alertId) return null;
      const response = await fetchImpl(
        `/api/tag-alerts/${encodeURIComponent(alertId)}/read`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ botId })
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(data.message || `Tag alert read failed: HTTP ${response.status}`);
      }
      removeRead({ alertId });
      return data.alert || null;
    }

    async function unlockAudio() {
      return unlockSound?.();
    }

    return {
      connect,
      disconnect,
      replaceSnapshot,
      markRead,
      unlockAudio
    };
  }

  global.createTagAlertClient = createTagAlertClient;
})(window);
