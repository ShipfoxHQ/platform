export const RUNNER_LABEL_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
export const MAX_RUNNER_LABEL_LENGTH = 128;
export const MAX_RUNNER_LABELS = 20;

export type RunnerCatalog = Readonly<Record<string, readonly string[]>>;

export function canonicalizeLabels(
  value: string | readonly string[] | undefined,
): readonly string[] {
  const labels = value === undefined ? [] : typeof value === 'string' ? [value] : value;
  const normalized = labels.map((label) => label.trim().toLowerCase()).filter(Boolean);

  return [...new Set(normalized)].sort();
}

export function parseLabelList(value: string): readonly string[] {
  return canonicalizeLabels(value.split(','));
}

export function findInvalidLabels(labels: readonly string[]): readonly string[] {
  return labels.filter(
    (label) => label.length > MAX_RUNNER_LABEL_LENGTH || !RUNNER_LABEL_PATTERN.test(label),
  );
}

export function parseRunnerCatalog(raw: unknown): RunnerCatalog {
  if (!isRecord(raw)) {
    throw new Error('Runner catalog must be an object mapping names to label lists.');
  }

  const catalog = Object.create(null) as Record<string, readonly string[]>;

  for (const [rawName, rawLabels] of Object.entries(raw)) {
    const name = canonicalizeLabels(rawName)[0];
    if (name === undefined) {
      throw new Error('Runner catalog entry names must not be empty.');
    }

    const invalidName = findInvalidLabels([name]);
    if (invalidName.length > 0) {
      throw new Error(`Runner catalog entry "${rawName}" has an invalid name: ${name}.`);
    }

    if (!isStringArray(rawLabels)) {
      throw new Error(`Runner catalog entry "${rawName}" must contain a list of labels.`);
    }

    const labels = canonicalizeLabels(rawLabels);
    if (labels.length === 0) {
      throw new Error(`Runner catalog entry "${rawName}" must contain at least one label.`);
    }

    const invalidLabels = findInvalidLabels(labels);
    if (invalidLabels.length > 0) {
      throw new Error(
        `Runner catalog entry "${rawName}" has invalid label(s): ${invalidLabels.join(', ')}.`,
      );
    }

    if (Object.hasOwn(catalog, name)) {
      throw new Error(`Runner catalog contains duplicate name "${name}".`);
    }

    catalog[name] = labels;
  }

  return catalog;
}

export function resolveRunnerLabels(
  requested: readonly string[],
  catalog: RunnerCatalog,
): readonly string[] {
  const values = canonicalizeLabels(requested);
  return canonicalizeLabels(
    values.flatMap((value) => {
      const entry = Object.hasOwn(catalog, value) ? catalog[value] : undefined;
      return entry ?? [value];
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && Array.from(value).every((item) => typeof item === 'string');
}
