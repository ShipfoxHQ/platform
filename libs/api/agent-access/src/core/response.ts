import {
  AGENT_ACCESS_RESPONSE_MAX_BYTES,
  type AgentAccessEnvelopeDto,
} from '@shipfox/api-agent-access-dto';
import {agentAccessError} from './envelope.js';

const utf8Encoder = new TextEncoder();

export interface AgentAccessUtf8Truncation {
  value: string;
  truncated: boolean;
  totalBytes: number;
}

export function truncateAgentAccessUtf8(
  value: string,
  maxBytes: number,
): AgentAccessUtf8Truncation {
  const totalBytes = utf8Encoder.encode(value).byteLength;
  if (totalBytes <= maxBytes) return {value, truncated: false, totalBytes};
  if (maxBytes <= 0) return {value: '', truncated: true, totalBytes};

  let bytes = 0;
  let result = '';
  for (const codePoint of value) {
    const codePointBytes = utf8Encoder.encode(codePoint).byteLength;
    if (bytes + codePointBytes > maxBytes) break;
    result += codePoint;
    bytes += codePointBytes;
  }

  return {value: result, truncated: true, totalBytes};
}

export function serializedAgentAccessEnvelopeByteLength(envelope: AgentAccessEnvelopeDto): number {
  const serialized = JSON.stringify(envelope);
  if (serialized === undefined) throw new Error('Agent-access envelope is not serializable');
  return utf8Encoder.encode(serialized).byteLength;
}

export interface ReducePagedAgentAccessResponseParams {
  envelope: AgentAccessEnvelopeDto;
  itemKey: string;
  items: readonly Record<string, unknown>[];
  cursorForItem: (item: Record<string, unknown>, index: number) => string;
  maxBytes?: number | undefined;
}

export interface AgentAccessCappedStringRef {
  readonly get: () => string;
  readonly set: (value: string) => void;
  readonly originalValue: string;
  readonly order: number;
  readonly onTruncate?: (() => void) | undefined;
}

export interface ReduceAgentAccessDetailResponseParams {
  envelope: AgentAccessEnvelopeDto;
  strings: readonly AgentAccessCappedStringRef[];
  maxBytes?: number | undefined;
  originalBytes?: number | undefined;
}

/**
 * Fits a paged success response without reusing a producer cursor that points past dropped rows.
 * The cursor is always rebuilt from the final retained item.
 */
export function reducePagedAgentAccessResponse(
  params: ReducePagedAgentAccessResponseParams,
): AgentAccessEnvelopeDto {
  const maxBytes = params.maxBytes ?? AGENT_ACCESS_RESPONSE_MAX_BYTES;
  const initialBytes = serializedAgentAccessEnvelopeByteLength(params.envelope);
  if (initialBytes <= maxBytes) return params.envelope;
  if (!params.envelope.ok || !isRecord(params.envelope.result)) {
    return agentAccessError('content-too-large');
  }

  const itemCounts =
    params.items.length === 0
      ? [0]
      : Array.from(
          {length: Math.max(0, params.items.length - 1)},
          (_, index) => params.items.length - index - 1,
        );
  for (const itemCount of itemCounts) {
    const retained = params.items.slice(0, itemCount);
    const last = retained.at(-1);
    const nextCursor = last === undefined ? null : params.cursorForItem(last, itemCount - 1);
    const candidate: AgentAccessEnvelopeDto = {
      ...params.envelope,
      result: {
        ...params.envelope.result,
        [params.itemKey]: retained,
        next_cursor: nextCursor,
      },
      response_truncated: true,
      response_total_bytes: initialBytes,
    };
    if (serializedAgentAccessEnvelopeByteLength(candidate) <= maxBytes) return candidate;
  }

  return agentAccessError('content-too-large');
}

/**
 * Fits a detail response by shrinking its largest registered strings first.
 * The producer response has already been projected, so this pass only changes
 * values explicitly registered by the projection and never invents a field.
 */
export function reduceAgentAccessDetailResponse(
  params: ReduceAgentAccessDetailResponseParams,
): AgentAccessEnvelopeDto {
  const maxBytes = params.maxBytes ?? AGENT_ACCESS_RESPONSE_MAX_BYTES;
  const originalBytes =
    params.originalBytes ?? serializedAgentAccessEnvelopeByteLength(params.envelope);
  let candidate = params.envelope;
  if (!candidate.ok) return agentAccessError('content-too-large');

  if (serializedAgentAccessEnvelopeByteLength(candidate) > maxBytes) {
    candidate = {
      ...candidate,
      response_truncated: true,
      response_total_bytes: originalBytes,
    };
  }

  while (serializedAgentAccessEnvelopeByteLength(candidate) > maxBytes) {
    const largest = params.strings
      .map((ref) => ({
        ref,
        bytes: utf8Encoder.encode(ref.get()).byteLength,
      }))
      .filter(({bytes}) => bytes > 0)
      .sort((left, right) => right.bytes - left.bytes || left.ref.order - right.ref.order)[0];

    if (largest === undefined) return agentAccessError('content-too-large');

    const nextBytes = Math.floor(largest.bytes / 2);
    const next = truncateAgentAccessUtf8(largest.ref.originalValue, nextBytes);
    if (next.value === largest.ref.get()) {
      largest.ref.set('');
    } else {
      largest.ref.set(next.value);
    }
    largest.ref.onTruncate?.();
  }

  return candidate;
}

export function fitAgentAccessResponseToCeiling(
  envelope: AgentAccessEnvelopeDto,
  maxBytes = AGENT_ACCESS_RESPONSE_MAX_BYTES,
): AgentAccessEnvelopeDto {
  return serializedAgentAccessEnvelopeByteLength(envelope) <= maxBytes
    ? envelope
    : agentAccessError('content-too-large');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
