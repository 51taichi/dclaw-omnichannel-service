(function exposeProactiveTargetSelection(globalObject) {
  function intersectTargetMaps(targetMaps = []) {
    const maps = (Array.isArray(targetMaps) ? targetMaps : [])
      .filter((targetMap) => targetMap instanceof Map);
    if (!maps.length) return new Map();

    const [smallestMap] = [...maps].sort((left, right) => left.size - right.size);
    const intersection = new Map();
    for (const [key, target] of smallestMap.entries()) {
      if (maps.every((targetMap) => targetMap.has(key))) {
        intersection.set(key, target);
      }
    }
    return intersection;
  }

  globalObject.ProactiveTargetSelection = { intersectTargetMaps };
})(globalThis);
