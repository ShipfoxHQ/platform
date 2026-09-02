import {WORKFLOW_RUN_JOB_POSITION_MAX} from '@shipfox/api-workflows-dto';
import {decodeStringIdCursor} from '@shipfox/node-drizzle';
import {ClientError} from '@shipfox/node-fastify';
import {z} from 'zod';
import type {WorkflowRunJobCursor} from '#db/index.js';

const decimalCursorValue = /^\d+$/;
const uuidSchema = z.string().uuid();

export function decodeRunJobCursor(cursor: string | undefined): WorkflowRunJobCursor | undefined {
  const decoded = decodeStringIdCursor(cursor);
  if (!decoded) return undefined;
  if (decoded.value.length === 0 || !decimalCursorValue.test(decoded.value)) return undefined;
  if (!uuidSchema.safeParse(decoded.id).success) return undefined;
  const position = Number(decoded.value);
  if (!Number.isInteger(position) || position < 0 || position > WORKFLOW_RUN_JOB_POSITION_MAX) {
    return undefined;
  }
  return {position, id: decoded.id};
}

export function assertValidRunJobCursor(
  cursor: string | undefined,
  decodedCursor: WorkflowRunJobCursor | undefined,
): void {
  if (cursor !== undefined && decodedCursor === undefined) {
    throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
  }
}
