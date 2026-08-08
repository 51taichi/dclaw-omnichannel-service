(function attachNetworkRetry(global) {
  async function run(operation, { retries = 1 } = {}) {
    let remaining = Math.max(0, Number(retries) || 0);
    for (;;) {
      try {
        return await operation();
      } catch (error) {
        if (error?.isNetworkError !== true || remaining <= 0) throw error;
        remaining -= 1;
      }
    }
  }

  global.DClawNetworkRetry = Object.freeze({ run });
})(typeof window !== "undefined" ? window : globalThis);
