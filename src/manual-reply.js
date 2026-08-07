const MAX_MANUAL_REPLY_ATTACHMENTS = 5;
const ALLOWED_MANUAL_REPLY_FILE_TYPES = new Set(["image", "video", "audio", "file"]);

const fileTypeLabel = (fileType) => ({
  image: "图片",
  video: "视频",
  audio: "音频",
  file: "文件"
}[fileType] || "附件");

export function normalizeManualReply({ content, attachments } = {}) {
  const normalizedContent = String(content || "").trim();
  const source = Array.isArray(attachments) ? attachments : [];
  if (source.length > MAX_MANUAL_REPLY_ATTACHMENTS) {
    throw new Error(`attachments supports up to ${MAX_MANUAL_REPLY_ATTACHMENTS} files`);
  }
  const normalizedAttachments = source.map((attachment) => {
    const fileUrl = String(attachment?.fileUrl || attachment?.url || "").trim();
    const objectName = String(attachment?.objectName || attachment?.name || "").trim();
    const fileType = String(attachment?.fileType || attachment?.type || "").trim();
    if (!fileUrl) throw new Error("attachment fileUrl is required");
    if (!ALLOWED_MANUAL_REPLY_FILE_TYPES.has(fileType)) {
      throw new Error("fileType must be image, video, audio, or file");
    }
    return { fileUrl, objectName, fileType };
  });
  if (!normalizedContent && !normalizedAttachments.length) {
    throw new Error("content or attachments is required");
  }
  return {
    content: normalizedContent,
    attachments: normalizedAttachments,
    conversationContent: normalizedContent || normalizedAttachments
      .map((attachment) => `[${fileTypeLabel(attachment.fileType)}] ${attachment.objectName || attachment.fileUrl}`)
      .join("\n")
  };
}
