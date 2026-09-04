import {readFile} from 'node:fs/promises';
import {fetchStepLogs} from '@shipfox/e2e-observe-logs';
import type {WorkflowRunObservation} from '@shipfox/e2e-observe-workflows';

const LOG_ATTACHMENT_NAME_PART_RE = /[^a-zA-Z0-9._-]+/g;
const MAX_DIAGNOSTIC_VALUE_BYTES = 16 * 1024;
const MAX_TEXT_ATTACHMENT_BYTES = 64 * 1024;
const LARGE_DIAGNOSTIC_KEYS = new Set([
  'authored_config',
  'config',
  'data',
  'payload',
  'source_snapshot',
  'trigger_payload',
]);

export interface Attachment {
  name: string;
  contentType: string;
  body: string;
}

export type AttachFn = (attachment: Attachment) => Promise<void>;

export interface StepLogAttachmentRequest {
  path: string;
  stepId: string;
  attempt: number;
}

export function logAttachmentName(path: string): string {
  return path.replaceAll(LOG_ATTACHMENT_NAME_PART_RE, '_').replace(/^_+|_+$/g, '');
}

/** Keeps failure artifacts useful while omitting production-sized JSON values. */
export function boundedDiagnosticValue(value: unknown): unknown {
  return boundDiagnosticValue(value, undefined, new WeakSet<object>());
}

function boundDiagnosticValue(
  value: unknown,
  key: string | undefined,
  ancestors: WeakSet<object>,
): unknown {
  if (value !== null && typeof value === 'object' && ancestors.has(value)) {
    return {__e2e_value_omitted__: true, reason: 'circular'};
  }

  const omitted = omittedLargeDiagnosticValue(value, key);
  if (omitted !== undefined) return omitted;

  if (typeof value === 'string') {
    const serializedBytes = Buffer.byteLength(value, 'utf8');
    return serializedBytes > MAX_DIAGNOSTIC_VALUE_BYTES
      ? {__e2e_value_omitted__: true, serialized_utf8_bytes: serializedBytes}
      : value;
  }
  if (value === null || typeof value !== 'object') return value;
  return boundDiagnosticObject(value, ancestors);
}

function omittedLargeDiagnosticValue(value: unknown, key: string | undefined): unknown | undefined {
  if (key === undefined || !LARGE_DIAGNOSTIC_KEYS.has(key)) return undefined;
  const serializedBytes = serializedJsonBytes(value);
  return serializedBytes > MAX_DIAGNOSTIC_VALUE_BYTES
    ? {__e2e_value_omitted__: true, serialized_utf8_bytes: serializedBytes}
    : undefined;
}

function boundDiagnosticObject(value: object, ancestors: WeakSet<object>): unknown {
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => boundDiagnosticValue(entry, undefined, ancestors));
    }

    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        boundDiagnosticValue(entryValue, entryKey, ancestors),
      ]),
    );
  } finally {
    ancestors.delete(value);
  }
}

function serializedJsonBytes(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? 0 : Buffer.byteLength(serialized, 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function boundedText(value: string, maxBytes: number): string {
  const measuredBytes = Buffer.byteLength(value, 'utf8');
  if (measuredBytes <= maxBytes) return value;

  const head = utf8Prefix(value, Math.ceil(maxBytes / 2));
  const tail = utf8Suffix(value.slice(head.length), Math.floor(maxBytes / 2));
  return `${head}\n[e2e diagnostic text omitted after ${maxBytes} UTF-8 bytes; measured=${measuredBytes}]\n${tail}`;
}

function utf8Prefix(value: string, maxBytes: number): string {
  let low = 0;
  let high = value.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, midpoint), 'utf8') <= maxBytes) {
      low = midpoint;
    } else {
      high = midpoint - 1;
    }
  }
  const endsWithHighSurrogate =
    low > 0 && value.charCodeAt(low - 1) >= 0xd800 && value.charCodeAt(low - 1) <= 0xdbff;
  const end = endsWithHighSurrogate ? low - 1 : low;
  return value.slice(0, end);
}

function utf8Suffix(value: string, maxBytes: number): string {
  let start = value.length;
  let measuredBytes = 0;
  while (start > 0) {
    const codeUnit = value.charCodeAt(start - 1);
    const width =
      codeUnit >= 0xdc00 &&
      codeUnit <= 0xdfff &&
      start > 1 &&
      value.charCodeAt(start - 2) >= 0xd800 &&
      value.charCodeAt(start - 2) <= 0xdbff
        ? 2
        : 1;
    const characterBytes = Buffer.byteLength(value.slice(start - width, start), 'utf8');
    if (measuredBytes + characterBytes > maxBytes) break;
    measuredBytes += characterBytes;
    start -= width;
  }
  return value.slice(start);
}

export function collectStepLogAttachmentRequests(
  observation: WorkflowRunObservation,
): StepLogAttachmentRequest[] {
  const requests: StepLogAttachmentRequest[] = [];
  for (const job of observation.jobs) {
    for (const execution of job.executions) {
      for (const step of execution.steps) {
        requests.push({
          path: `jobs.${job.key}.executions.${execution.sequence}.steps.${
            step.key ?? logAttachmentName(step.name)
          }`,
          stepId: step.id,
          attempt: step.current_attempt,
        });
      }
    }
  }
  return requests;
}

export async function fetchLogAttachment(
  request: StepLogAttachmentRequest,
  token: string,
  options: {maxBytes?: number | undefined} = {},
): Promise<Attachment> {
  try {
    const logs = await fetchStepLogs({
      stepId: request.stepId,
      attempt: request.attempt,
      token,
    });
    return {
      name: `logs-${logAttachmentName(request.path)}.ndjson`,
      contentType: 'application/x-ndjson',
      body: boundedText(logs.ndjson, options.maxBytes ?? MAX_TEXT_ATTACHMENT_BYTES),
    };
  } catch (error) {
    return {
      name: `logs-${logAttachmentName(request.path)}.error.txt`,
      contentType: 'text/plain',
      body: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function attachLocalRunnerLog(
  attach: AttachFn,
  runnerLogFile: string,
  options: {maxBytes?: number | undefined} = {},
): Promise<void> {
  try {
    await attach({
      name: `runner-${logAttachmentName(runnerLogFile)}.log`,
      contentType: 'text/plain',
      body: boundedText(
        await readFile(runnerLogFile, 'utf8'),
        options.maxBytes ?? MAX_TEXT_ATTACHMENT_BYTES,
      ),
    });
  } catch (error) {
    await attach({
      name: `runner-${logAttachmentName(runnerLogFile)}.error.txt`,
      contentType: 'text/plain',
      body: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
  }
}
