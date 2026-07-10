export function shouldProcessInboundForAgent(message) {
  const spoken = String(message?.spoken || "").trim();
  const raw = String(message?.rawSpoken || message?.rawMessage || "").trim();
  const filePath = String(message?.filePath || "").trim();
  const textType = Number(message?.textType);

  if (!spoken && !raw && !filePath) return false;
  if (Number.isFinite(textType) && textType !== 1 && !spoken && !raw) return false;
  return true;
}
