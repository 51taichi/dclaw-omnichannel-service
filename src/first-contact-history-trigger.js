export function shouldRunFirstContactHistorySync({
  hadConversation,
  syncRecord,
  nowIso = new Date().toISOString()
}) {
  if (["success", "failed", "unavailable"].includes(syncRecord?.status)) return false;
  if (!hadConversation) return true;
  if (syncRecord?.status !== "processing") return false;
  const expiresAt = Date.parse(syncRecord.leaseExpiresAt || "");
  const currentAt = Date.parse(nowIso);
  return Number.isFinite(expiresAt)
    && Number.isFinite(currentAt)
    && expiresAt <= currentAt;
}

export async function waitForActiveFirstContactHistorySync({
  syncRecord,
  readSync,
  now = () => Date.now(),
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  pollIntervalMs = 100
}) {
  let record = syncRecord;
  while (record?.status === "processing") {
    const expiresAt = Date.parse(record.leaseExpiresAt || "");
    const remainingMs = expiresAt - now();
    if (!Number.isFinite(expiresAt) || remainingMs <= 0) break;
    await sleep(Math.min(Math.max(1, pollIntervalMs), remainingMs));
    record = readSync();
  }
  return record;
}
