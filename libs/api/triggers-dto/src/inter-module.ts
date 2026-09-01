import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {
  listenerMatcherKindSchema,
  triggerDecisionOutcomeSchema,
  triggerDecisionSubscriptionKindSchema,
  triggerEventOriginSchema,
  triggerEventOutcomeSchema,
} from './schemas/trigger-events.js';

const idSchema = z.string().uuid();
const isoDateTimeSchema = z.string().datetime();

const triggerEventCursorSchema = z.object({
  receivedAt: isoDateTimeSchema,
  id: idSchema,
});

const triggerEventListFiltersSchema = z
  .object({
    source: z.array(z.string()).optional(),
    event: z.array(z.string()).optional(),
    origin: z.array(triggerEventOriginSchema).optional(),
    outcome: z.array(triggerEventOutcomeSchema).optional(),
    replayable: z.literal(true).optional(),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && new Date(value.from) > new Date(value.to)) {
      ctx.addIssue({
        code: 'custom',
        message: 'from must be before or equal to to',
        path: ['from'],
      });
    }
  });

const triggerEventListItemSchema = z.object({
  id: idSchema,
  eventRef: z.string(),
  origin: triggerEventOriginSchema,
  workspaceId: idSchema,
  provider: z.string().nullable(),
  source: z.string(),
  event: z.string(),
  replayOfEventId: idSchema.nullable(),
  deliveryId: z.string().nullable(),
  connectionId: idSchema.nullable(),
  connectionName: z.string().nullable(),
  outcome: triggerEventOutcomeSchema,
  matchedCount: z.number().int().nonnegative(),
  receivedAt: isoDateTimeSchema,
  processedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});

const triggerEventSchema = triggerEventListItemSchema.extend({
  payload: z.record(z.string(), z.unknown()).nullable(),
});

const triggerEventReplaySchema = z.object({
  id: idSchema,
  receivedAt: isoDateTimeSchema,
  outcome: triggerEventOutcomeSchema,
  runId: idSchema.nullable(),
});

const triggerDecisionSchema = z
  .object({
    id: idSchema,
    receivedEventId: idSchema,
    subscriptionKind: triggerDecisionSubscriptionKindSchema,
    subscriptionId: idSchema.nullable(),
    subscriptionName: z.string(),
    workflowDefinitionId: idSchema.nullable(),
    projectId: idSchema.nullable(),
    workflowRunId: idSchema.nullable(),
    jobId: idSchema.nullable(),
    matcherKind: listenerMatcherKindSchema.nullable(),
    matcherOrdinal: z.number().int().nonnegative().nullable(),
    decision: triggerDecisionOutcomeSchema,
    runId: idSchema.nullable(),
    runName: z.string().nullable(),
    reason: z.string().nullable(),
    createdAt: isoDateTimeSchema,
  })
  .superRefine((value, ctx) => {
    const isDevDecision = value.subscriptionKind === 'dev';
    const hasNullSubscriptionId = value.subscriptionId === null;
    if (isDevDecision !== hasNullSubscriptionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: isDevDecision
          ? 'dev decisions must have a null subscriptionId'
          : 'trigger and listener decisions must have a subscriptionId',
        path: ['subscriptionId'],
      });
    }
  });

const triggerEventFacetSchema = z.object({
  value: z.string(),
  count: z.number().int().nonnegative(),
});

const triggerEventDetailSchema = triggerEventSchema.extend({
  decisions: z.array(triggerDecisionSchema),
  replays: z.array(triggerEventReplaySchema),
});

export const triggersInterModuleContract = defineInterModuleContract({
  module: 'triggers',
  methods: {
    listTriggerEvents: {
      input: z.object({
        workspaceId: idSchema,
        limit: z.number().int().min(1).max(100),
        cursor: triggerEventCursorSchema.optional(),
        filters: triggerEventListFiltersSchema.optional(),
      }),
      output: z.object({
        events: z.array(triggerEventListItemSchema),
        nextCursor: triggerEventCursorSchema.nullable(),
      }),
    },
    getTriggerEvent: {
      input: z.object({workspaceId: idSchema, eventId: idSchema}),
      output: triggerEventDetailSchema,
      errors: {
        'trigger-event-not-found': z.object({eventId: idSchema}),
      },
    },
    getTriggerEventFacets: {
      input: z.object({workspaceId: idSchema}),
      output: z.object({
        sources: z.array(triggerEventFacetSchema),
        events: z.array(triggerEventFacetSchema),
        origins: z.array(triggerEventFacetSchema),
      }),
    },
  },
});

export type TriggersInterModuleClient = InterModuleClient<typeof triggersInterModuleContract>;
export type TriggerEventListItem = z.infer<typeof triggerEventListItemSchema>;
export type TriggerEventDetail = z.infer<typeof triggerEventDetailSchema>;
export type TriggerDecision = z.infer<typeof triggerDecisionSchema>;
export type TriggerEventReplay = z.infer<typeof triggerEventReplaySchema>;
