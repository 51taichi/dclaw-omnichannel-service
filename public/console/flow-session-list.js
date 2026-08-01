(function attachFlowSessionList(global) {
  function upsertFlowSession(sessions, incomingSession) {
    const current = Array.isArray(sessions) ? sessions : [];
    const conversationKey = String(incomingSession?.conversationKey || "").trim();
    if (!conversationKey) return [...current];

    const index = current.findIndex(
      (session) => session?.conversationKey === conversationKey
    );
    if (index < 0) return [{ ...incomingSession }, ...current];

    return current.map((session, position) =>
      position === index ? { ...session, ...incomingSession } : session
    );
  }

  global.upsertFlowSession = upsertFlowSession;
})(window);
