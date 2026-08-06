import {logger} from '@shipfox/node-opentelemetry';
import {canonicalizeLabels} from '@shipfox/runner-labels';
import {runnerReservedLabels} from '#config.js';
import {RunnerLabelsReservedError} from './errors.js';

export type RunnerLabelScope = 'installation' | 'workspace' | 'manual';

type SanitizeRunnerLabelsParams = {
  scope: RunnerLabelScope;
  source: string;
  logLevel?: 'debug' | 'warn';
  reservedLabels?: readonly string[];
};

function sanitizeCanonicalRunnerLabels(
  canonicalLabels: readonly string[],
  params: SanitizeRunnerLabelsParams,
): string[] {
  if (params.scope === 'installation') return [...canonicalLabels];

  const reservedLabels = new Set(canonicalizeLabels(params.reservedLabels ?? runnerReservedLabels));
  if (reservedLabels.size === 0) return [...canonicalLabels];

  const removedLabels = canonicalLabels.filter((label) => reservedLabels.has(label));
  if (removedLabels.length === 0) return [...canonicalLabels];

  const details = {source: params.source, removedLabels};
  if (params.logLevel === 'debug')
    logger().debug(details, 'Removed reserved runner labels from a non-installation source');
  else logger().warn(details, 'Removed reserved runner labels from a non-installation source');
  return canonicalLabels.filter((label) => !reservedLabels.has(label));
}

export function sanitizeRunnerLabels(
  labels: readonly string[],
  params: SanitizeRunnerLabelsParams,
): string[] {
  return sanitizeCanonicalRunnerLabels([...canonicalizeLabels(labels)], params);
}

export function sanitizeRunnerLabelsOrThrow(
  labels: readonly string[],
  params: SanitizeRunnerLabelsParams,
): string[] {
  const canonicalLabels = [...canonicalizeLabels(labels)];
  const sanitizedLabels = sanitizeCanonicalRunnerLabels(canonicalLabels, params);
  if (sanitizedLabels.length === 0 && canonicalLabels.length > 0) {
    throw new RunnerLabelsReservedError(canonicalLabels);
  }
  return sanitizedLabels;
}
