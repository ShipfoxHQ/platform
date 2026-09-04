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

interface PagedResponseFitState {
  emptyCandidate: AgentAccessEnvelopeDto;
  emptyResult: Record<string, unknown>;
  candidateBytes: readonly number[];
  itemCursors: readonly string[];
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

  const producerResult = params.envelope.result;
  const fitState = buildPagedResponseFitState(params, producerResult, initialBytes);
  const itemCount = largestFittingItemCount(fitState.candidateBytes, params.items.length, maxBytes);
  if (itemCount !== undefined) {
    const nextCursor = itemCount === 0 ? null : fitState.itemCursors[itemCount - 1];
    if (nextCursor === undefined && itemCount > 0) return agentAccessError('content-too-large');
    return {
      ...fitState.emptyCandidate,
      result: {
        ...fitState.emptyResult,
        [params.itemKey]: params.items.slice(0, itemCount),
        next_cursor: nextCursor ?? null,
      },
    };
  }

  return agentAccessError('content-too-large');
}

function buildPagedResponseFitState(
  params: ReducePagedAgentAccessResponseParams,
  producerResult: Record<string, unknown>,
  initialBytes: number,
): PagedResponseFitState {
  const emptyResult = {...producerResult, [params.itemKey]: [], next_cursor: null};
  const emptyCandidate: AgentAccessEnvelopeDto = {
    ...params.envelope,
    result: emptyResult,
    response_truncated: true,
    response_total_bytes: initialBytes,
  };
  const emptyCandidateBytes = serializedAgentAccessEnvelopeByteLength(emptyCandidate);
  const nullCursorBytes = serializedJsonByteLength(null);
  const candidateBytes: number[] = [emptyCandidateBytes];
  const itemCursors: string[] = [];
  let retainedItemBytes = 0;

  for (const [index, item] of params.items.entries()) {
    retainedItemBytes += serializedJsonByteLength(item) + (index === 0 ? 0 : 1);
    const cursor = params.cursorForItem(item, index);
    itemCursors.push(cursor);
    candidateBytes.push(
      emptyCandidateBytes + retainedItemBytes + serializedJsonByteLength(cursor) - nullCursorBytes,
    );
  }

  return {emptyCandidate, emptyResult, candidateBytes, itemCursors};
}

function largestFittingItemCount(
  candidateBytes: readonly number[],
  itemCount: number,
  maxBytes: number,
): number | undefined {
  const minimumItemCount = itemCount === 0 ? 0 : 1;
  for (let count = itemCount; count >= minimumItemCount; count -= 1) {
    const candidateByteLength = candidateBytes[count];
    if (candidateByteLength !== undefined && candidateByteLength <= maxBytes) return count;
  }
  return undefined;
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

function serializedJsonByteLength(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Agent-access value is not serializable');
  return utf8Encoder.encode(serialized).byteLength;
}
