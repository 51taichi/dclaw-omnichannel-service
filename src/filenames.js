export function normalizeUploadedFilename(value) {
  const filename = String(value || "").trim();
  if (!filename) return "";

  const restored = restoreUtf8FromLatin1(filename);
  if (restored && scoreFilename(restored) > scoreFilename(filename)) {
    return restored;
  }
  return filename;
}

function restoreUtf8FromLatin1(value) {
  try {
    return Buffer.from(value, "latin1").toString("utf8");
  } catch {
    return "";
  }
}

function scoreFilename(value) {
  const text = String(value || "");
  let score = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    if (/[\u4e00-\u9fff]/u.test(char)) score += 3;
    if (/[\w.\-()（）\s]/u.test(char)) score += 1;
    if (code >= 0xfffd || /[ÃÂÇÈÉåæçäö¼½¾«»¢£¤¥¦§¨©ª¬®¯°±²³µ¶·¸¹º¿]/u.test(char)) {
      score -= 2;
    }
  }
  return score;
}
