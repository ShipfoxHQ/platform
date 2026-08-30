const ARRAY_INDEX_PATTERN = /^(0|[1-9]\d*)$/;

/**
 * Structural JSON-safety check used on both sides of the dispatch boundary: on
 * the caller's raw input before parsing, and on parsed/transformed input and
 * output before they cross to a handler or back to a caller.
 *
 * Cycle detection tracks only the active recursion path (the current DFS
 * stack), not every object visited. A value reachable twice through two
 * different branches is not a cycle and is allowed: it becomes two
 * independent copies once `JSON.stringify`/`JSON.parse` runs. Only a value
 * that reappears among its own ancestors is rejected.
 */
export function isJsonSafeValue(value: unknown): boolean {
  try {
    return checkJsonSafe(value, new Set());
  } catch {
    // A hostile Proxy trap (getPrototypeOf/ownKeys/getOwnPropertyDescriptor/get)
    // can throw mid-walk. A value that cannot be safely introspected is not
    // JSON-safe by definition: treat the throw as "unsafe", never let it
    // escape as a raw exception.
    return false;
  }
}

function checkJsonSafe(value: unknown, activePath: Set<unknown>): boolean {
  if (value === null) return true;

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object':
      break;
    default:
      // undefined, bigint, symbol, function
      return false;
  }

  if (activePath.has(value)) return false;

  if (Array.isArray(value)) return checkJsonSafeArray(value, activePath);
  return checkJsonSafeObject(value, activePath);
}

function checkJsonSafeArray(value: unknown[], activePath: Set<unknown>): boolean {
  if (!isPlainDenseArray(value)) return false;
  activePath.add(value);
  try {
    return value.every((item) => checkJsonSafe(item, activePath));
  } finally {
    activePath.delete(value);
  }
}

function checkJsonSafeObject(value: object, activePath: Set<unknown>): boolean {
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;

  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (typeof key === 'symbol') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    // `JSON.stringify` silently drops a non-enumerable own property (unlike an
    // array index, which it always serializes regardless of enumerability).
    // reject rather than let the later JSON copy silently lose the field.
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) return false;
  }

  activePath.add(value);
  try {
    return keys.every((key) =>
      checkJsonSafe((value as Record<string, unknown>)[key as string], activePath),
    );
  } finally {
    activePath.delete(value);
  }
}

function isPlainDenseArray(value: unknown[]): boolean {
  const keys = Reflect.ownKeys(value);
  let indexCount = 0;

  for (const key of keys) {
    if (key === 'length') continue;
    if (typeof key === 'symbol') return false;
    if (!ARRAY_INDEX_PATTERN.test(key)) return false;

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set) return false;
    indexCount++;
  }

  return indexCount === value.length;
}
