const SOURCE = "worktool_callback";

const typeByTextType = {
  2: "image",
  3: "audio",
  4: "video",
  5: "file",
  6: "file"
};

const typeLabels = {
  image: "图片",
  file: "文件",
  video: "视频",
  audio: "音频",
  unknown: "附件"
};

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeTextType(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isPublicUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function detectType(message = {}) {
  const explicitType = cleanText(message.fileType || message.type || message.messageType).toLowerCase();
  if (["image", "file", "video", "audio"].includes(explicitType)) return explicitType;
  return typeByTextType[Number(message.textType)] || "unknown";
}

function attachmentUrl(message = {}) {
  const candidates = [
    message.fileUrl,
    message.url,
    message.href,
    message.filePath
  ].map(cleanText).filter(Boolean);
  return candidates.find(isPublicUrl) || "";
}

function attachmentName(message = {}) {
  return cleanText(
    message.fileName ||
    message.filename ||
    message.objectName ||
    message.name
  );
}

export function extractInboundAttachments(message = {}) {
  const name = attachmentName(message);
  const url = attachmentUrl(message);
  const hasRawAttachment = Boolean(
    name ||
    url ||
    cleanText(message.fileUrl) ||
    cleanText(message.filePath)
  );
  if (!hasRawAttachment) return [];

  return [
    {
      type: detectType(message),
      url,
      name,
      textType: normalizeTextType(message.textType),
      source: SOURCE,
      available: Boolean(url)
    }
  ];
}

export function hasAvailableInboundAttachment(message = {}) {
  return extractInboundAttachments(message).some((attachment) => attachment.available);
}

export function inboundAttachmentPlaceholder(message = {}) {
  const attachment = extractInboundAttachments(message)[0];
  if (!attachment) return "";
  const label = typeLabels[attachment.type] || typeLabels.unknown;
  return attachment.name ? `[${label}] ${attachment.name}` : `[${label}]`;
}
