import {
  AGENT_ACCESS_TEXT_MAX_BYTES,
  type AgentAccessEnvelopeDto,
} from '@shipfox/api-agent-access-dto';
import {
  decodeNumberIdCursor,
  decodeStringIdCursor,
  decodeTimestampIdCursor,
  encodeTimestampIdCursor,
} from '@shipfox/node-drizzle';
import {agentAccessError} from './envelope.js';
import {reducePagedAgentAccessResponse, truncateAgentAccessUtf8} from './response.js';

export {truncateAgentAccessUtf8};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DECIMAL_RE = /^\d+$/u;

export interface SafeParseSchema<T> {
  safeParse(value: unknown): {success: true; data: T} | {success: false};
}

export function parseInput<T>(schema: SafeParseSchema<T>, value: unknown): T | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Adds an optional property only when its value is defined for the inter-module JSON guard. */
export function optionalField<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({[key]: value} as Record<Key, Value>);
}

export function reducePage(
  envelope: AgentAccessEnvelopeDto,
  itemKey: string,
  items: readonly Record<string, unknown>[],
  cursorForItem: (item: Record<string, unknown>, index: number) => string,
): AgentAccessEnvelopeDto {
  return reducePagedAgentAccessResponse({envelope, itemKey, items, cursorForItem});
}

export function decodeTimestampCursor(
  value: string | undefined,
): {createdAt: string; id: string} | undefined {
  if (value === undefined) return undefined;
  const cursor = decodeTimestampIdCursor(value);
  return cursor ? {createdAt: cursor.createdAt.toISOString(), id: cursor.id} : undefined;
}

export function validateTimestampCursor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const cursor = decodeTimestampCursor(value);
  return cursor !== undefined && UUID_RE.test(cursor.id) ? value : undefined;
}

export function decodeStringCursor(
  value: string | undefined,
): {value: string; id: string} | undefined {
  return value === undefined ? undefined : decodeStringIdCursor(value);
}

export function decodeNumberCursor(
  value: string | undefined,
): {value: number; id: string} | undefined {
  const cursor = value === undefined ? undefined : decodeNumberIdCursor(value);
  return cursor !== undefined && Number.isSafeInteger(cursor.value) ? cursor : undefined;
}

export function validateBoundedNumberCursor(
  value: string | undefined,
  bounds: {minValue: number; maxValue: number},
): string | undefined {
  if (value === undefined) return undefined;
  const cursor = decodeNumberCursor(value);
  return cursor !== undefined &&
    UUID_RE.test(cursor.id) &&
    Number.isSafeInteger(cursor.value) &&
    cursor.value >= bounds.minValue &&
    cursor.value <= bounds.maxValue
    ? value
    : undefined;
}

export function validateBoundedPositionCursor(
  value: string | undefined,
  maxValue: number,
): string | undefined {
  if (value === undefined) return undefined;
  const cursor = decodeStringCursor(value);
  if (cursor === undefined || !UUID_RE.test(cursor.id) || !DECIMAL_RE.test(cursor.value)) {
    return undefined;
  }
  const position = Number(cursor.value);
  return Number.isSafeInteger(position) && position >= 0 && position <= maxValue
    ? value
    : undefined;
}

export function encodeTimestampCursor(createdAt: string, id: string): string {
  return encodeTimestampIdCursor({createdAt: new Date(createdAt), id});
}

export function cap(value: string, maxBytes = AGENT_ACCESS_TEXT_MAX_BYTES): string {
  return truncateAgentAccessUtf8(value, maxBytes).value;
}

export function capNullable(
  value: string | null,
  maxBytes = AGENT_ACCESS_TEXT_MAX_BYTES,
): string | null {
  return value === null ? null : cap(value, maxBytes);
}

export function invalidRequest(): AgentAccessEnvelopeDto {
  return agentAccessError('invalid-request');
}

export function notFound(): AgentAccessEnvelopeDto {
  return agentAccessError('not-found');
}
