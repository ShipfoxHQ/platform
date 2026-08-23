import {z} from 'zod';

export const triggerEventOriginSchema = z.enum(['integration', 'manual', 'cron', 'dev']);
export type TriggerEventOriginDto = z.infer<typeof triggerEventOriginSchema>;

export const triggerEventOutcomeSchema = z.enum([
  'received',
  'routed',
  'discarded',
  'failed',
  'errored',
]);
export type TriggerEventOutcomeDto = z.infer<typeof triggerEventOutcomeSchema>;

export const triggerDecisionOutcomeSchema = z.enum(['triggered', 'filter-error', 'dispatch-error']);
export type TriggerDecisionOutcomeDto = z.infer<typeof triggerDecisionOutcomeSchema>;

export const triggerDecisionSubscriptionKindSchema = z.enum(['trigger', 'listener', 'dev']);
export type TriggerDecisionSubscriptionKindDto = z.infer<
  typeof triggerDecisionSubscriptionKindSchema
>;

export const listenerMatcherKindSchema = z.enum(['on', 'until']);
export type ListenerMatcherKindDto = z.infer<typeof listenerMatcherKindSchema>;

/**
 * List rows omit payload because webhook bodies can be large/untrusted.
 * The full payload lives only on the detail response.
 */
export const triggerEventListItemDtoSchema = z.object({
  id: z.string().uuid(),
  event_ref: z.string(),
  origin: triggerEventOriginSchema,
  workspace_id: z.string().uuid(),
  provider: z.string().nullable(),
  source: z.string(),
  event: z.string(),
  // Source event this entry replays (dev runs only).
  replay_of_event_id: z.string().uuid().nullable(),
  delivery_id: z.string().nullable(),
  connection_id: z.string().uuid().nullable(),
  outcome: triggerEventOutcomeSchema,
  matched_count: z.number().int().nonnegative(),
  received_at: z.string(),
  processed_at: z.string().nullable(),
  created_at: z.string(),
});
export type TriggerEventListItemDto = z.infer<typeof triggerEventListItemDtoSchema>;

export const triggerEventDtoSchema = triggerEventListItemDtoSchema.extend({
  connection_name: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()).nullable(),
});
export type TriggerEventDto = z.infer<typeof triggerEventDtoSchema>;

/**
 * A dev journal entry that replayed this event. `run_id` is null when the
 * replay has no recorded workflow run, including refusals and incomplete or
 * failed dev decision writes.
 */
export const triggerEventReplayDtoSchema = z.object({
  id: z.string().uuid(),
  received_at: z.string(),
  outcome: triggerEventOutcomeSchema,
  run_id: z.string().uuid().nullable(),
});
export type TriggerEventReplayDto = z.infer<typeof triggerEventReplayDtoSchema>;

const triggerDecisionDtoBaseSchema = z.object({
  id: z.string().uuid(),
  received_event_id: z.string().uuid(),
  subscription_kind: triggerDecisionSubscriptionKindSchema,
  // Null for `dev` decisions: a dev journal entry has no subscription row.
  subscription_id: z.string().uuid().nullable(),
  subscription_name: z.string(),
  workflow_definition_id: z.string().uuid().nullable(),
  project_id: z.string().uuid().nullable(),
  workflow_run_id: z.string().uuid().nullable(),
  job_id: z.string().uuid().nullable(),
  matcher_kind: listenerMatcherKindSchema.nullable(),
  matcher_ordinal: z.number().int().nonnegative().nullable(),
  decision: triggerDecisionOutcomeSchema,
  run_id: z.string().uuid().nullable(),
  run_name: z.string().nullable(),
  reason: z.string().nullable(),
  created_at: z.string(),
});

export const triggerDecisionDtoSchema = triggerDecisionDtoBaseSchema.superRefine((value, ctx) => {
  const isDevDecision = value.subscription_kind === 'dev';
  const hasNullSubscriptionId = value.subscription_id === null;
  if (isDevDecision !== hasNullSubscriptionId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: isDevDecision
        ? 'dev decisions must have a null subscription_id'
        : 'trigger and listener decisions must have a subscription_id',
      path: ['subscription_id'],
    });
  }
});
export type TriggerDecisionDto = z.infer<typeof triggerDecisionDtoSchema>;

const isoDateTimeSchema = z.string().datetime();

function normalizeListFilter(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const entries = (Array.isArray(value) ? value : [value])
    .flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : []))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries.length > 0 ? entries : undefined;
}

const stringListFilterSchema = z.preprocess(normalizeListFilter, z.array(z.string()).optional());
const outcomeFilterSchema = z.preprocess(
  normalizeListFilter,
  z.array(triggerEventOutcomeSchema).optional(),
);
const originFilterSchema = z.preprocess(
  normalizeListFilter,
  z.array(triggerEventOriginSchema).optional(),
);

const triggerEventListQueryBaseSchema = z.object({
  workspace_id: z.string().uuid(),
  source: stringListFilterSchema,
  event: stringListFilterSchema,
  origin: originFilterSchema,
  outcome: outcomeFilterSchema,
  // Convenience filter: only events that can be replayed through a dev run
  // (integration origin with a stored payload). `replayable=false` is not a
  // supported query; the picker only ever asks for the true side.
  replayable: z
    .literal('true')
    .transform(() => true)
    .optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

function validateDateWindow(
  value: {from?: string | undefined; to?: string | undefined},
  ctx: z.RefinementCtx,
) {
  if (!value.from || !value.to) return;
  if (new Date(value.from) > new Date(value.to)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'from must be before or equal to to',
      path: ['from'],
    });
  }
}

export const triggerEventListQuerySchema =
  triggerEventListQueryBaseSchema.superRefine(validateDateWindow);
export type TriggerEventListQueryDto = z.infer<typeof triggerEventListQuerySchema>;

export const triggerEventListResponseSchema = z.object({
  trigger_events: z.array(triggerEventListItemDtoSchema),
  next_cursor: z.string().nullable(),
});
export type TriggerEventListResponseDto = z.infer<typeof triggerEventListResponseSchema>;

export const triggerEventDetailResponseSchema = triggerEventDtoSchema.extend({
  decisions: z.array(triggerDecisionDtoSchema),
  replays: z.array(triggerEventReplayDtoSchema),
});
export type TriggerEventDetailResponseDto = z.infer<typeof triggerEventDetailResponseSchema>;

export const triggerEventFacetsQuerySchema = z.object({
  workspace_id: z.string().uuid(),
});
export type TriggerEventFacetsQueryDto = z.infer<typeof triggerEventFacetsQuerySchema>;

export const triggerEventFacetItemSchema = z.object({
  value: z.string(),
  count: z.number().int().nonnegative(),
});
export type TriggerEventFacetItemDto = z.infer<typeof triggerEventFacetItemSchema>;

export const triggerEventFacetsResponseSchema = z.object({
  sources: z.array(triggerEventFacetItemSchema),
  events: z.array(triggerEventFacetItemSchema),
  origins: z.array(triggerEventFacetItemSchema),
});
export type TriggerEventFacetsResponseDto = z.infer<typeof triggerEventFacetsResponseSchema>;
