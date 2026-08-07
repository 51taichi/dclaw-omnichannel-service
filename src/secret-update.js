export function normalizeSecretUpdate(value) {
  const candidate = String(value ?? "").trim();
  if (!candidate || /^\*+$/.test(candidate)) return undefined;
  return candidate;
}
