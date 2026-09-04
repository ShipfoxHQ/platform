import type {DefinitionSyncSummaryDto} from '@shipfox/api-definitions-dto';
import {z} from 'zod';
import type {Mismatch} from './expect.js';

const rejectionErrorCodeSchema = z.literal('invalid-definition');

export const rejectionSchema = z
  .object({
    error_code: rejectionErrorCodeSchema.default('invalid-definition'),
    message_includes: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type Rejection = z.infer<typeof rejectionSchema>;

export function parseRejection(raw: unknown): Rejection {
  return rejectionSchema.parse(raw);
}

export interface RejectionObservation {
  sync: DefinitionSyncSummaryDto | null;
  runs: readonly {id: string}[];
}

function nullableString(value: string | null | undefined): string {
  return value ?? 'null';
}

export function evaluateRejection(
  observation: RejectionObservation,
  rejection: Rejection,
): Mismatch[] {
  const mismatches: Mismatch[] = [];
  const sync = observation.sync;

  if (sync?.status !== 'failed') {
    mismatches.push({
      path: 'definition.sync.status',
      expected: 'failed',
      actual: sync?.status ?? 'null',
    });
  }

  if (sync?.last_error_code !== rejection.error_code) {
    mismatches.push({
      path: 'definition.sync.last_error_code',
      expected: rejection.error_code,
      actual: nullableString(sync?.last_error_code),
    });
  }

  const message = sync?.last_error_message ?? '';
  for (const substring of rejection.message_includes) {
    if (!message.includes(substring)) {
      mismatches.push({
        path: 'definition.sync.last_error_message',
        expected: `include ${substring}`,
        actual: nullableString(sync?.last_error_message),
      });
    }
  }

  if (observation.runs.length > 0) {
    mismatches.push({
      path: 'runs',
      expected: 'none',
      actual: String(observation.runs.length),
    });
  }

  return mismatches;
}
