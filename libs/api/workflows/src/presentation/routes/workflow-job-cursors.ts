import {WORKFLOW_RUN_ATTEMPT_MAX, WORKFLOW_RUN_JOB_POSITION_MAX} from '@shipfox/api-workflows-dto';
import {
  decodeNumberIdCursor,
  decodeStringIdCursor,
  type NumberIdCursor,
  type StringIdCursor,
} from '@shipfox/node-drizzle';
import {ClientError} from '@shipfox/node-fastify';
import {z} from 'zod';

const decimalCursorValue = /^\d+$/;
const uuidSchema = z.string().uuid();

export function decodeExecutionCursor(cursor: string | undefined): NumberIdCursor | undefined {
  const decoded = decodeNumberIdCursor(cursor);
  if (!decoded || decoded.value > WORKFLOW_RUN_ATTEMPT_MAX || !isUuid(decoded.id)) return undefined;
  return decoded;
}

export function decodeStepCursor(cursor: string | undefined): StringIdCursor | undefined {
  const decoded = decodeStringIdCursor(cursor);
  if (!decoded || !decimalCursorValue.test(decoded.value) || !isUuid(decoded.id)) return undefined;
  const position = Number(decoded.value);
  if (!Number.isSafeInteger(position) || position > WORKFLOW_RUN_JOB_POSITION_MAX) return undefined;
  return {value: String(position), id: decoded.id};
}

export function decodeAttemptCursor(cursor: string | undefined): NumberIdCursor | undefined {
  const decoded = decodeNumberIdCursor(cursor);
  if (!decoded || decoded.value > WORKFLOW_RUN_ATTEMPT_MAX || !isUuid(decoded.id)) return undefined;
  return decoded;
}

export function assertValidCursor(
  cursor: string | undefined,
  decoded: NumberIdCursor | StringIdCursor | undefined,
): void {
  if (cursor !== undefined && decoded === undefined) {
    throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
  }
}

function isUuid(value: string): boolean {
  return uuidSchema.safeParse(value).success;
}
