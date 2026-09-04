/** A JSON text preview that never breaks JSON syntax at the byte boundary. */
export interface JsonPreview {
  value: string;
  truncated: boolean;
  totalBytes: number;
}

const encoder = new TextEncoder();

export function serializeJsonWithinLimit(value: unknown, maxBytes: number): JsonPreview {
  try {
    const totalBytes = jsonValueByteLength(value, new Set<object>());
    const serialized =
      totalBytes <= maxBytes
        ? serializeJsonFully(value, new Set<object>())
        : serializeJsonBounded(value, maxBytes, new Set<object>()).value;
    return {value: serialized, truncated: totalBytes > maxBytes, totalBytes};
  } catch (error) {
    if (error instanceof CyclicJsonError) {
      return {value: 'null', truncated: false, totalBytes: 4};
    }
    throw error;
  }
}

class CyclicJsonError extends Error {
  constructor() {
    super('Cannot serialize cyclic JSON');
    this.name = 'CyclicJsonError';
  }
}

interface BoundedJsonResult {
  value: string;
  bytes: number;
}

function serializeJsonBounded(
  value: unknown,
  maxBytes: number,
  stack: Set<object>,
): BoundedJsonResult {
  if (maxBytes < 2) return {value: 'null', bytes: 4};
  if (value === null) return {value: 'null', bytes: 4};
  if (typeof value === 'boolean') {
    const serialized = value ? 'true' : 'false';
    return {value: serialized, bytes: serialized.length};
  }
  if (typeof value === 'number') {
    const serialized = numberJson(value);
    return {value: serialized, bytes: serialized.length};
  }
  if (typeof value === 'string') {
    const serialized = boundedJsonString(value, maxBytes);
    return {value: serialized, bytes: encoder.encode(serialized).byteLength};
  }
  if (typeof value !== 'object') return {value: 'null', bytes: 4};
  if (stack.has(value)) throw new CyclicJsonError();

  stack.add(value);
  try {
    return Array.isArray(value)
      ? serializeJsonArrayBounded(value, maxBytes, stack)
      : serializeJsonObjectBounded(value as Record<string, unknown>, maxBytes, stack);
  } finally {
    stack.delete(value);
  }
}

function serializeJsonArrayBounded(
  value: readonly unknown[],
  maxBytes: number,
  stack: Set<object>,
): BoundedJsonResult {
  let result = '[';
  let resultBytes = 1;
  for (const item of value) {
    const separator = result === '[' ? '' : ',';
    const separatorBytes = separator.length;
    const available = maxBytes - resultBytes - separatorBytes - 1;
    if (available < 2) break;
    const child = serializeJsonBounded(item, available, stack);
    if (resultBytes + separatorBytes + child.bytes + 1 > maxBytes) break;
    result += separator + child.value;
    resultBytes += separatorBytes + child.bytes;
  }
  return {value: `${result}]`, bytes: resultBytes + 1};
}

function serializeJsonObjectBounded(
  value: Record<string, unknown>,
  maxBytes: number,
  stack: Set<object>,
): BoundedJsonResult {
  let result = '{';
  let resultBytes = 1;
  for (const [key, item] of Object.entries(value)) {
    if (!isSerializableObjectProperty(item)) continue;
    const separator = result === '{' ? '' : ',';
    const keyJson = encodeJsonString(key);
    const separatorBytes = separator.length;
    const keyBytes = encoder.encode(keyJson).byteLength;
    const available = maxBytes - resultBytes - separatorBytes - keyBytes - 2;
    if (available < 2) break;
    const child = serializeJsonBounded(item, available, stack);
    if (resultBytes + separatorBytes + keyBytes + 1 + child.bytes + 1 > maxBytes) break;
    result += `${separator + keyJson}:${child.value}`;
    resultBytes += separatorBytes + keyBytes + 1 + child.bytes;
  }
  return {value: `${result}}`, bytes: resultBytes + 1};
}

function boundedJsonString(value: string, maxBytes: number): string {
  if (jsonStringByteLength(value) <= maxBytes) return encodeJsonString(value);
  let result = '"';
  let resultBytes = 1;
  for (const codePoint of value) {
    const encoded = encodeJsonString(codePoint).slice(1, -1);
    const encodedBytes = encoder.encode(encoded).byteLength;
    if (resultBytes + encodedBytes + 1 > maxBytes) break;
    result += encoded;
    resultBytes += encodedBytes;
  }
  return `${result}"`;
}

function serializeJsonFully(value: unknown, stack: Set<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return encodeJsonString(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return numberJson(value);
  if (typeof value !== 'object') return 'null';
  if (stack.has(value)) throw new CyclicJsonError();

  stack.add(value);
  try {
    if (Array.isArray(value))
      return `[${value.map((item) => serializeJsonFully(item, stack)).join(',')}]`;
    return `{${Object.entries(value)
      .filter(([, item]) => isSerializableObjectProperty(item))
      .map(([key, item]) => `${encodeJsonString(key)}:${serializeJsonFully(item, stack)}`)
      .join(',')}}`;
  } finally {
    stack.delete(value);
  }
}

function jsonValueByteLength(value: unknown, stack: Set<object>): number {
  if (value === null) return 4;
  if (typeof value === 'string') return jsonStringByteLength(value);
  if (typeof value === 'boolean') return value ? 4 : 5;
  if (typeof value === 'number') return encoder.encode(numberJson(value)).byteLength;
  if (typeof value !== 'object') return 4;
  if (stack.has(value)) throw new CyclicJsonError();

  stack.add(value);
  try {
    if (Array.isArray(value)) {
      return (
        2 +
        value.reduce(
          (total, item, index) => total + (index ? 1 : 0) + jsonValueByteLength(item, stack),
          0,
        )
      );
    }
    return (
      2 +
      Object.entries(value)
        .filter(([, item]) => isSerializableObjectProperty(item))
        .reduce(
          (total, [key, item], index) =>
            total +
            (index ? 1 : 0) +
            jsonStringByteLength(key) +
            1 +
            jsonValueByteLength(item, stack),
          0,
        )
    );
  } finally {
    stack.delete(value);
  }
}

function jsonStringByteLength(value: string): number {
  return encoder.encode(encodeJsonString(value)).byteLength;
}

function encodeJsonString(value: string): string {
  let result = '"';
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) continue;
    const character = String.fromCodePoint(codePoint);
    index += character.length - 1;
    switch (codePoint) {
      case 0x08:
        result += '\\b';
        break;
      case 0x09:
        result += '\\t';
        break;
      case 0x0a:
        result += '\\n';
        break;
      case 0x0c:
        result += '\\f';
        break;
      case 0x0d:
        result += '\\r';
        break;
      case 0x22:
        result += '\\"';
        break;
      case 0x5c:
        result += '\\\\';
        break;
      default:
        if (codePoint <= 0x1f || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
          result += `\\u${codePoint.toString(16).padStart(4, '0')}`;
        } else {
          result += character;
        }
    }
  }
  return `${result}"`;
}

function numberJson(value: number): string {
  if (!Number.isFinite(value)) return 'null';
  return Object.is(value, -0) ? '0' : String(value);
}

function isSerializableObjectProperty(value: unknown): boolean {
  return typeof value !== 'undefined' && typeof value !== 'function' && typeof value !== 'symbol';
}
