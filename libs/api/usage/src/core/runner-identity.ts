import {canonicalizeLabels} from '@shipfox/runner-labels';

export interface ParsedRunnerIdentity {
  runnerLabels: string[] | null;
  runnerClass: string | null;
  runnerArch: string | null;
  runnerCpu: string | null;
  managed: boolean | null;
}

/** Parses the bounded grouping labels without changing the producer's raw label list. */
export function parseRunnerIdentity(
  runnerLabels: readonly string[] | null,
  provisionerScope: string | null,
): ParsedRunnerIdentity {
  if (runnerLabels === null) {
    return {
      runnerLabels: null,
      runnerClass: null,
      runnerArch: null,
      runnerCpu: null,
      managed: null,
    };
  }

  const labels = [...canonicalizeLabels(runnerLabels)];
  return {
    runnerLabels: labels,
    runnerClass: labelValue(labels, 'class'),
    runnerArch: labelValue(labels, 'arch'),
    runnerCpu: labelValue(labels, 'cpu'),
    managed:
      provisionerScope === null
        ? false
        : provisionerScope === 'installation' && labels.includes('shipfox-managed'),
  };
}

function labelValue(labels: readonly string[], prefix: string): string | null {
  const label = labels.find((value) => value.startsWith(`${prefix}.`));
  return label ? label.slice(prefix.length + 1) || null : null;
}
