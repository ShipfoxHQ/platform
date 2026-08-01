export interface AllowedBudgetParams {
  baseBytes: number;
  ratePerMinuteBytes: number;
  /** Time since the budget clock origin (first append) in milliseconds. */
  elapsedMs: number;
}

/**
 * Accrual budget in stored bytes: `base + rate * elapsedMinutes`, floored to an
 * integer. No hard ceiling: job duration limits bound total volume.
 */
export function allowedBudget({
  baseBytes,
  ratePerMinuteBytes,
  elapsedMs,
}: AllowedBudgetParams): number {
  const elapsed = Math.max(0, elapsedMs);
  return baseBytes + Math.floor((ratePerMinuteBytes * elapsed) / 60_000);
}
