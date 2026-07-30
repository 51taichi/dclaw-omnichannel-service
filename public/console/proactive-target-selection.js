(function exposeProactiveTargetSelection(globalObject) {
  function createInteractionLock(onChange = () => {}) {
    let locked = false;
    let generation = 0;

    return {
      isLocked() {
        return locked;
      },
      reset() {
        generation += 1;
        locked = false;
        onChange(false);
      },
      async run(task) {
        if (locked) return { accepted: false };
        const runGeneration = generation;
        locked = true;
        onChange(true);
        try {
          return { accepted: true, value: await task() };
        } finally {
          if (runGeneration === generation) {
            locked = false;
            onChange(false);
          }
        }
      }
    };
  }

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

  globalObject.ProactiveTargetSelection = {
    createInteractionLock,
    intersectTargetMaps
  };
})(globalThis);
