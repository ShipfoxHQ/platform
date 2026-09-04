import type {UsageTokenTotals} from '#core/usage.js';

const numberFormatter = new Intl.NumberFormat('en-US');

export function formatUsageNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatUsageDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
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
