export function shouldRunFirstContactHistorySync({
  hadConversation,
  syncRecord,
  nowIso = new Date().toISOString()
}) {
  if (!hadConversation) return true;
  if (syncRecord?.status !== "processing") return false;
  const expiresAt = Date.parse(syncRecord.leaseExpiresAt || "");
  const currentAt = Date.parse(nowIso);
  return Number.isFinite(expiresAt)
    && Number.isFinite(currentAt)
    && expiresAt <= currentAt;
}
