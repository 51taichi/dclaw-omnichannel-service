(function attachAttentionAlertClient(global) {
  const reconnectDelays = [1000, 2000, 4000, 10000];

  function createAttentionAlertClient({ fetchImpl = global.fetch.bind(global), onChange, playSound, unlockSound, onError, onAuthExpired } = {}) {
    const alerts = new Map();
    let botId = "";
    let authHeaders = {};
    let controller = null;
    let reconnectTimer = null;
    let reconnectAttempt = 0;
    let generation = 0;

    const snapshot = () => [...alerts.values()].sort((a, b) =>
      String(b.lastTriggeredAt || "").localeCompare(String(a.lastTriggeredAt || "")) || Number(b.id) - Number(a.id)
    );
    const emit = (reason) => onChange?.(snapshot(), { reason });

    function mergeSnapshot(items) {
      for (const alert of Array.isArray(items) ? items : []) {
        if (alert?.id !== undefined && alert?.id !== null) alerts.set(String(alert.id), alert);
      }
      emit("snapshot");
    }
    function applyCreated(payload) {
      const alert = payload?.alert;
      const key = String(alert?.id ?? "");
      if (!key || alerts.has(key)) return;
      alerts.set(key, alert);
      emit("created");
      playSound?.(alert);
    }
    function applyUpdated(payload) {
      const alert = payload?.alert;
      const key = String(alert?.id ?? "");
      if (!key) return;
      alerts.set(key, alert);
      emit("updated");
    }
    function applyRead(payload) {
      const key = String(payload?.alert?.id ?? payload?.alertId ?? "");
      if (alerts.delete(key)) emit("read");
    }
    function handleEvent(name, payload) {
      if (name === "attention.snapshot") mergeSnapshot(payload?.alerts);
      else if (name === "attention.created") applyCreated(payload);
      else if (name === "attention.updated") applyUpdated(payload);
      else if (name === "attention.read") applyRead(payload);
    }
    function parseFrame(frame) {
      let name = "message";
      const data = [];
      for (const line of frame.split(/\r?\n/)) {
        if (!line || line.startsWith(":")) continue;
        if (line.startsWith("event:")) name = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (!data.length) return;
      try { handleEvent(name, JSON.parse(data.join("\n"))); } catch (error) { onError?.(error); }
    }
    function clearReconnect() {
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    function scheduleReconnect(expectedGeneration) {
      if (!botId || expectedGeneration !== generation) return;
      const delay = reconnectDelays[Math.min(reconnectAttempt, reconnectDelays.length - 1)];
      reconnectAttempt += 1;
      clearReconnect();
      reconnectTimer = setTimeout(() => openStream(expectedGeneration), delay);
    }
    async function openStream(expectedGeneration) {
      if (!botId || expectedGeneration !== generation) return;
      controller = new AbortController();
      try {
        const response = await fetchImpl(`/api/attention-alerts/stream?botId=${encodeURIComponent(botId)}`, {
          method: "GET", headers: authHeaders, signal: controller.signal, cache: "no-store"
        });
        if (!response.ok || !response.body) {
          const error = new Error(`Attention alert stream failed: HTTP ${response.status}`);
          error.status = response.status;
          throw error;
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
            parseFrame(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");
          }
        }
        if (expectedGeneration === generation && !controller.signal.aborted) scheduleReconnect(expectedGeneration);
      } catch (error) {
        if (expectedGeneration !== generation || controller?.signal.aborted) return;
        if (error?.status === 401) {
          generation += 1;
          clearReconnect();
          controller?.abort();
          controller = null;
          onAuthExpired?.(error);
          return;
        }
        onError?.(error);
        scheduleReconnect(expectedGeneration);
      }
    }
    function disconnect() {
      generation += 1;
      clearReconnect();
      controller?.abort();
      controller = null;
      botId = "";
      authHeaders = {};
      reconnectAttempt = 0;
      alerts.clear();
      emit("disconnect");
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
      const response = await fetchImpl(`/api/attention-alerts/${encodeURIComponent(alertId)}/read`, {
        method: "POST", headers: authHeaders, body: JSON.stringify({ botId })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.message || `Attention alert read failed: HTTP ${response.status}`);
      applyRead({ alert: data.alert || { id: alertId } });
      return data.alert || null;
    }
    return {
      connect, disconnect, snapshot, mergeSnapshot, applyCreated, applyUpdated, applyRead,
      markRead, unlockAudio: () => unlockSound?.()
    };
  }

  global.createAttentionAlertClient = createAttentionAlertClient;
})(window);
