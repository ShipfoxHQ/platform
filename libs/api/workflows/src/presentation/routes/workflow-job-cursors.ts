import {
  WORKFLOW_JOB_EXECUTION_SEQUENCE_MAX,
  WORKFLOW_RUN_ATTEMPT_MAX,
  WORKFLOW_RUN_JOB_POSITION_MAX,
} from '@shipfox/api-workflows-dto';
import {
  decodeNumberIdCursor,
  decodeStringIdCursor,
  type NumberIdCursor,
  type StringIdCursor,
} from '@shipfox/node-drizzle';
import {ClientError} from '@shipfox/node-fastify';
import {z} from 'zod';

const uuidSchema = z.string().uuid();
const decimalCursorValue = /^\d+$/;

type PositionIdCursor = {position: number; id: string};

// Cursor tokens are opaque endpoint values. Execution and step-attempt cursors intentionally use
// the same number-and-ID encoding, while each endpoint applies its own bounded key validation.

export function decodeExecutionCursor(cursor: string | undefined): NumberIdCursor | undefined {
  return decodeBoundedNumberCursor(cursor, WORKFLOW_JOB_EXECUTION_SEQUENCE_MAX);
}

export function decodeStepCursor(cursor: string | undefined): StringIdCursor | undefined {
  const decoded = decodeBoundedStringCursor(cursor, WORKFLOW_RUN_JOB_POSITION_MAX);
  if (!decoded) return undefined;
  return {value: String(Number(decoded.value)), id: decoded.id};
}

export function decodeJobCursor(cursor: string | undefined): PositionIdCursor | undefined {
  const decoded = decodeBoundedStringCursor(cursor, WORKFLOW_RUN_JOB_POSITION_MAX);
  if (!decoded) return undefined;
  const position = Number(decoded.value);
  if (position < 0) return undefined;
  return {position, id: decoded.id};
}

export function decodeAttemptCursor(cursor: string | undefined): NumberIdCursor | undefined {
  return decodeBoundedNumberCursor(cursor, WORKFLOW_RUN_ATTEMPT_MAX);
}

export function assertValidCursor(
  cursor: string | undefined,
  decoded: NumberIdCursor | StringIdCursor | PositionIdCursor | undefined,
): void {
  if (cursor !== undefined && decoded === undefined) {
    throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
  }
}

function isUuid(value: string): boolean {
  return uuidSchema.safeParse(value).success;
}

function decodeBoundedNumberCursor(
  cursor: string | undefined,
  maximum: number,
): NumberIdCursor | undefined {
  const decoded = decodeNumberIdCursor(cursor);
  if (!decoded || decoded.value > maximum || !isUuid(decoded.id)) return undefined;
  return decoded;
}

function decodeBoundedStringCursor(
  cursor: string | undefined,
  maximum: number,
): StringIdCursor | undefined {
  const decoded = decodeStringIdCursor(cursor);
  if (!decoded || !decimalCursorValue.test(decoded.value) || !isUuid(decoded.id)) return undefined;
  const value = Number(decoded.value);
  if (!Number.isSafeInteger(value) || value > maximum) return undefined;
  return decoded;
}
