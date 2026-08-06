import type {ExpressionType} from '../expression/workflow-expression.js';

const decimalIntegerPattern = /^-?(?:0|[1-9]\d*)$/;

export function rehydrateJsonExpressionRecord(
  values: Readonly<Record<string, unknown>> | null | undefined,
  types: Readonly<Record<string, ExpressionType>> | undefined,
): Record<string, unknown> {
  if (values === null || values === undefined) return {};
  if (types === undefined) return {...values};

  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      rehydrateJsonExpressionValue(value, types[key]),
    ]),
  );
}

// JSON persistence stores CEL ints and timestamps as numbers/strings, but CEL evaluates them as BigInt/Date.
export function rehydrateJsonExpressionValue(
  value: unknown,
  type: ExpressionType | undefined,
): unknown {
  if (value === null || type === undefined) return value;

  if (type === 'int') return rehydrateInteger(value);
  if (type === 'timestamp') return rehydrateTimestamp(value);
  if (typeof type !== 'object') return value;

  if (type.kind === 'list') {
    return Array.isArray(value)
      ? value.map((item) => rehydrateJsonExpressionValue(item, type.element))
      : value;
  }

  if (type.kind === 'object' && isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        rehydrateJsonExpressionValue(item, type.fields[key]),
      ]),
    );
  }

  return value;
}

function rehydrateInteger(value: unknown): unknown {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return Number.isSafeInteger(value) ? BigInt(value) : value;
  if (typeof value !== 'string' || !decimalIntegerPattern.test(value)) return value;
  return BigInt(value);
}

function rehydrateTimestamp(value: unknown): unknown {
  if (value instanceof Date || typeof value !== 'string' || !value.endsWith('Z')) return value;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
