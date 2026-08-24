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
  /**
   * How the row's value round-trips on submit. Rows prefilled from string
   * `with` values are marked `string` so they stay text even when the text is
   * a valid JSON literal; rows prefilled from any other JSON value are marked
   * `json` and parse back. User-added rows carry no kind and keep the
   * parse-if-valid-JSON behavior.
   */
  valueKind?: 'string' | 'json' | undefined;
}

/**
 * Prefill the inputs form from a trigger's `with` block. String values stay
 * editable text and are marked `string` so they round-trip as strings; every
 * other JSON value is stringified for editing and marked `json` so it parses
 * back through `runFromBranchInputValue`.
 */
export function runFromBranchInputsFromWith(
  withBlock: Record<string, unknown> | undefined,
): RunFromBranchInputRow[] {
  if (!withBlock) return [];
  return Object.entries(withBlock).map(([key, value]) => {
    if (typeof value === 'string') {
      return {key, value, valueKind: 'string'};
    }
    return {key, value: value === undefined ? '' : JSON.stringify(value), valueKind: 'json'};
  });
}

/**
 * Parse one edited value back into the request shape: `string`-kind values
 * stay text, `json`-kind and user-added values parse valid JSON and fall back
 * to the raw text. An empty value stays an empty string.
 */
export function runFromBranchInputValue(
  value: string,
  valueKind: RunFromBranchInputRow['valueKind'] = undefined,
): unknown {
  if (value === '') return '';
  if (valueKind === 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/**
 * Build the request `inputs` object from the form rows. Rows with a blank key
 * are dropped; the remaining values are parsed with `runFromBranchInputValue`
 * using each row's kind. The object has a null prototype so keys like
 * `__proto__` and `constructor` are stored as data, not prototype properties.
 */
export function runFromBranchInputsToObject(
  rows: readonly RunFromBranchInputRow[],
): Record<string, unknown> {
  const inputs: Record<string, unknown> = Object.create(null);
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    inputs[key] = runFromBranchInputValue(row.value, row.valueKind);
  }
  return inputs;
}
