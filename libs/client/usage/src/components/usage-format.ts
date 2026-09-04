import type {UsageTokenTotals} from '#core/usage.js';

const numberFormatter = new Intl.NumberFormat('en-US');

export function formatUsageNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatUsageDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return '—';
  }
  const totalSeconds = Math.round(seconds);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function usageQuantitiesFromTotals(totals: UsageTokenTotals, computeSeconds = 0) {
  return {
    computeSeconds,
    requestCount: totals.requestCount,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheCreationTokens: totals.cacheCreationTokens,
    cacheReadTokens: totals.cacheReadTokens,
    reasoningTokens: totals.reasoningTokens,
  };
}
