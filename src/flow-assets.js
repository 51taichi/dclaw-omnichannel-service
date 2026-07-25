function flowNodes(flow) {
  const machine = flow?.machine;
  if (!machine || typeof machine !== "object" || Array.isArray(machine)) return [];
  if (Array.isArray(machine.nodes)) return machine.nodes;
  return Array.isArray(machine.config?.nodes) ? machine.config.nodes : [];
}

function hasAssetValue(value) {
  if (typeof value === "string") return Boolean(value.trim());
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "boolean";
}

export function listConfiguredFlowCollectFields(flow) {
  const fields = [];
  const seen = new Set();
  for (const node of flowNodes(flow)) {
    for (const rawField of Array.isArray(node?.collectFields) ? node.collectFields : []) {
      const field = String(rawField || "").trim();
      if (!field || seen.has(field)) continue;
      seen.add(field);
      fields.push(field);
    }
  }
  return fields;
}

export function filterConfiguredCollectedDataPatch({
  flow,
  patch,
  fillOnlyMissing = false
}) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return {};
  const configuredFields = new Set(listConfiguredFlowCollectFields(flow));
  const collectedData = flow?.session?.collectedData || {};
  const filtered = {};
  for (const [rawField, value] of Object.entries(patch)) {
    const field = String(rawField || "").trim();
    if (
      !configuredFields.has(field)
      || !hasAssetValue(value)
      || (fillOnlyMissing && hasAssetValue(collectedData[field]))
    ) {
      continue;
    }
    filtered[field] = typeof value === "string" ? value.trim() : value;
  }
  return filtered;
}
