const disabledAttentionAlert = Object.freeze({
  required: false,
  reason: "",
  evidenceMessageId: "",
  evidenceText: ""
});

export function normalizeAttentionAlert(value) {
  if (!value || value.required !== true) {
    return disabledAttentionAlert;
  }
  return Object.freeze({
    required: true,
    reason: value.reason.trim(),
    evidenceMessageId: value.evidenceMessageId.trim(),
    evidenceText: value.evidenceText.trim()
  });
}
