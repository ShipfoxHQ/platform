/**
 * Pure helpers for the Run from branch dialog: trigger-source classification,
 * input prefill normalization, and value round-tripping between the trigger's
 * `with` block (JSON values) and the editable key-value form (string rows).
 */

export type RunFromBranchTriggerKind = 'manual' | 'cron' | 'integration';

/**
 * Classify a trigger source. `manual` and `cron` are the built-in sources; any
 * other source names an integration connection, whose dev runs replay a
 * journaled event (the event picker lands in a later release).
 */
export function runFromBranchTriggerKind(source: string): RunFromBranchTriggerKind {
  if (source === 'manual') return 'manual';
  if (source === 'cron') return 'cron';
  return 'integration';
}

/** Display label for a trigger source: the built-in sources, or the connection slug. */
export function runFromBranchTriggerSourceLabel(source: string): string {
  switch (source) {
    case 'manual':
      return 'Manual';
    case 'cron':
      return 'Cron';
    default:
      return source;
  }
}

/** One editable row of the manual-trigger inputs form. */
export interface RunFromBranchInputRow {
  key: string;
  value: string;
}

/**
 * Prefill the inputs form from a trigger's `with` block. String values stay
 * editable text; every other JSON value is stringified so it round-trips
 * through `runFromBranchInputValue`.
 */
export function runFromBranchInputsFromWith(
  withBlock: Record<string, unknown> | undefined,
): RunFromBranchInputRow[] {
  if (!withBlock) return [];
  return Object.entries(withBlock).map(([key, value]) => ({
    key,
    value: value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value),
  }));
}

/**
 * Parse one edited value back into the request shape: JSON values that were
 * stringified for editing (numbers, booleans, objects, arrays) round-trip,
 * and any other text stays a string. An empty value stays an empty string.
 */
export function runFromBranchInputValue(value: string): unknown {
  if (value === '') return '';
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/**
 * Build the request `inputs` object from the form rows. Rows with a blank key
 * are dropped; the remaining values are parsed with `runFromBranchInputValue`.
 */
export function runFromBranchInputsToObject(
  rows: readonly RunFromBranchInputRow[],
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    inputs[key] = runFromBranchInputValue(row.value);
  }
  return inputs;
}
