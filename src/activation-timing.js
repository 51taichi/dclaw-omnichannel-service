export const ZERO_MINUTE_ACTIVATION_DELAY_MS = 5_000;

export function activationDelayMs(intervalMinutes, attemptNumber = 1) {
  const interval = Math.max(0, Number(intervalMinutes) || 0);
  if (interval === 0) return ZERO_MINUTE_ACTIVATION_DELAY_MS;
  const multiplier = 2 ** Math.max(0, Number(attemptNumber || 1) - 1);
  return interval * 60_000 * multiplier;
}
