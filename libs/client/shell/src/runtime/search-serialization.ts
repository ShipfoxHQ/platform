import {defaultParseSearch} from '@tanstack/react-router';

/**
 * Parses a query string into route search values.
 *
 * TanStack's parser folds a repeated key into an array but then decodes only scalars, because
 * its own encoder never writes a repeated key. `stringifyAppSearch` does, and it quotes a
 * JSON-parseable string so the value survives the round trip, so the same decoding has to
 * reach inside an array. Without this a branch named `2024` comes back as `"2024"`, quotes
 * included, and silently matches nothing.
 */
export function parseAppSearch(searchStr: string): Record<string, unknown> {
  const search: Record<string, unknown> = defaultParseSearch(searchStr);
  for (const [key, value] of Object.entries(search)) {
    if (Array.isArray(value)) search[key] = value.map(decodeSearchValue);
  }
  return search;
}

// Mirrors what the default parser already does to a scalar: JSON when it parses, the raw
// string when it does not. Values the query-string decoder already turned into numbers or
// booleans are left alone.
function decodeSearchValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Serializes route search values, expanding an array into one entry per element.
 *
 * TanStack's default encoder writes at most one entry per key and JSON-encodes anything that
 * is not a primitive, so a multi-select filter would reach the URL as
 * `?status=%5B%22failed%22%2C%22running%22%5D`. Repeating the key instead is what
 * `URLSearchParams` does natively, keeps the URL readable, and is the only encoding that
 * survives a value which legitimately contains a comma, such as a branch name.
 *
 * The round trip is lossy in exactly one direction: a single-element array comes back as a
 * scalar, because `?status=failed` cannot say whether it meant one value or a list of one.
 * A route that accepts repeated keys therefore normalizes a scalar into an array when it
 * validates, rather than trusting the shape the parser handed it.
 */
export function stringifyAppSearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry !== undefined) params.append(key, serializeSearchValue(entry));
      }
      continue;
    }
    params.set(key, serializeSearchValue(value));
  }

  const searchStr = params.toString();
  return searchStr ? `?${searchStr}` : '';
}

// Mirrors the default encoder's value handling so non-array params are untouched by this
// override: objects are JSON, and a string that happens to parse as JSON is re-quoted so it
// survives the parser's JSON.parse rather than coming back as a number or a boolean.
function serializeSearchValue(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return JSON.stringify(value);
    } catch {
      return value;
    }
  }

  return String(value);
}
