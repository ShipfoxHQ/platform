import {MAX_RUNNER_LABELS} from '@shipfox/runner-labels';
import {z} from 'zod';
import {terminationReasonSchema} from './reconcile-runner-instances.js';
import {runnerLabelSchema} from './register.js';

export const pollDemandTemplateSchema = z.object({
  template_key: z.string().min(1),
  labels: z.array(runnerLabelSchema).min(1).max(MAX_RUNNER_LABELS),
  available_slots: z.number().int().min(0).max(100_000),
  starting: z.number().int().min(0).max(100_000),
  running: z.number().int().min(0).max(100_000),
});

export const pollDemandBodySchema = z.object({
  wait_seconds: z.number().int().min(0).optional(),
  reservation_ttl_seconds: z.number().int().min(1).optional(),
  max_reservations: z.number().int().min(0).max(1000),
  templates: z.array(pollDemandTemplateSchema).max(1000),
});

export const demandStatSchema = z.object({
  workspace_id: z.string().uuid().optional(),
  labels: z.array(z.string()),
  queued: z.number().int().min(0),
  reserved: z
    .number()
    .int()
    .min(0)
    .describe(
      'Queued jobs for this label set covered by unclaimed reserved runners or reservations created in this poll; advisory scheduling estimate.',
    ),
  oldest_queued_at: z.string().datetime(),
});

export const reservationGrantSchema = z.object({
  reservation_id: z.string().uuid(),
  workspace_id: z.string().uuid().optional(),
  labels: z.array(z.string()),
  count: z.number().int().positive(),
  expires_at: z.string().datetime(),
});

export const terminationAuthorizationSchema = z.object({
  provider_runner_id: z.string(),
  reason: terminationReasonSchema,
});
export type TerminationAuthorizationDto = z.infer<typeof terminationAuthorizationSchema>;

export const pollDemandResponseSchema = z.object({
  stats: z.array(demandStatSchema),
  reservations: z.array(reservationGrantSchema),
  newly_reserved_count: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'Reservation units created by this poll, including units satisfied by adopted runners.',
    ),
  terminate_provider_runner_ids: z.array(z.string()),
  // Additive delivery of the same durable decision for provisioners that need
  // the reason; legacy provisioners continue using the ID list above.
  termination_authorizations: z.array(terminationAuthorizationSchema).optional(),
});

export type PollDemandTemplateDto = z.infer<typeof pollDemandTemplateSchema>;
export type PollDemandBodyDto = z.infer<typeof pollDemandBodySchema>;
export type DemandStatDto = z.infer<typeof demandStatSchema>;
export type ReservationGrantDto = z.infer<typeof reservationGrantSchema>;
export type PollDemandResponseDto = z.infer<typeof pollDemandResponseSchema>;
