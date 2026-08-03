(function attachGroupAutomationClient(global) {
  const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 10000];

  function createGroupAutomationClient({
    fetchImpl = global.fetch.bind(global),
    onSnapshot,
    onUpdate,
    onError,
    onAuthExpired
  } = {}) {
    let botId = "";
    let groupId = "";
    let authHeaders = {};
    let controller = null;
    let reconnectTimer = null;
    let reconnectAttempt = 0;
    let generation = 0;

    function parseEventFrame(frame) {
      let eventName = "message";
      const dataLines = [];
      for (const line of frame.split(/\r?\n/)) {
        if (!line || line.startsWith(":")) continue;
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (!dataLines.length) return;
      try {
        const payload = JSON.parse(dataLines.join("\n"));
        if (eventName === "snapshot") onSnapshot?.(payload.tasks || []);
        else onUpdate?.(payload, { eventName });
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
      if (!botId || !groupId || expectedGeneration !== generation) return;
      const delay = RECONNECT_DELAYS_MS[
        Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
      ];
      reconnectAttempt += 1;
      clearReconnectTimer();
      reconnectTimer = setTimeout(() => openStream(expectedGeneration), delay);
    }

    async function openStream(expectedGeneration) {
      if (!botId || !groupId || expectedGeneration !== generation) return;
      controller = new AbortController();
      const streamUrl = `/api/groups/${encodeURIComponent(groupId)}/automations/events?botId=${encodeURIComponent(botId)}`;
      try {
        const response = await fetchImpl(streamUrl, {
          headers: authHeaders,
          signal: controller.signal,
          cache: "no-store"
        });
        if (!response.ok || !response.body) {
          const error = new Error(`Group automation stream failed: HTTP ${response.status}`);
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
            parseEventFrame(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");
          }
        }
        if (expectedGeneration === generation && !controller.signal.aborted) {
          scheduleReconnect(expectedGeneration);
        }
      } catch (error) {
        if (expectedGeneration !== generation || controller?.signal.aborted) return;
        if (error?.status === 401) {
          disconnect();
          onAuthExpired?.(error);
          return;
        }
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
      groupId = "";
      authHeaders = {};
      reconnectAttempt = 0;
    }

    function connect(options = {}) {
      disconnect();
      botId = String(options.botId || "").trim();
      groupId = String(options.groupId || "").trim();
      authHeaders = { ...(options.headers || {}) };
      if (!botId || !groupId) return;
      generation += 1;
      openStream(generation);
    }

    return { connect, disconnect };
  }

  global.createGroupAutomationClient = createGroupAutomationClient;
})(window);
