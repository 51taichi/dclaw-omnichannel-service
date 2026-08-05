import { hasAvailableInboundAttachment } from "./inbound-attachments.js";

export function shouldProcessInboundForAgent(message) {
  const spoken = String(message?.spoken || "").trim();
  const raw = String(message?.rawSpoken || message?.rawMessage || "").trim();
  const filePath = String(message?.filePath || "").trim();
  const textType = Number(message?.textType);

  if (Number(message?.textType) === 22 && Number(message?.type) === 105) return false;
  if (!spoken && !raw && hasAvailableInboundAttachment(message)) return true;
  if (!spoken && !raw && !filePath) return false;
  if (Number.isFinite(textType) && textType !== 1 && !spoken && !raw) return false;
  return true;
}

export function isSystemFriendGreeting(message) {
  const roomType = Number(message?.roomType);
  if (Number(message?.textType) !== 1 || (roomType !== 2 && roomType !== 4)) return false;
  const content = String(message?.spoken || message?.rawSpoken || message?.rawMessage || "")
    .normalize("NFKC")
    .replace(/[\s,，。.!！]/g, "");
  return content === "我已经添加了你现在我们可以开始聊天了";
}
