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
const diagnosticVersionSchema = z.literal(1);
const diagnosticByteCountSchema = z.number().int().nonnegative();
const diagnosticFieldSchema = z.string().min(1).max(200);
const diagnosticIndexSchema = z.number().int().min(-999_999_999).max(999_999_999);

export const triggerDecisionDiagnosticSchema = z.discriminatedUnion('code', [
  z.strictObject({
    version: diagnosticVersionSchema,
    code: z.literal('expression-missing-path'),
    path: z.string().min(1).max(200),
  }),
  z.strictObject({
    version: diagnosticVersionSchema,
    code: z.literal('expression-index-out-of-bounds'),
    index: diagnosticIndexSchema,
    size: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    version: diagnosticVersionSchema,
    code: z.literal('expression-syntax-invalid'),
    summary: z.string().min(1).max(200),
    offset: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    version: diagnosticVersionSchema,
    code: z.literal('expression-evaluation-failed'),
    classification: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/)
      .optional(),
  }),
  z.strictObject({
    version: diagnosticVersionSchema,
    code: z.literal('expression-result-not-boolean'),
    actualType: z.enum(['string', 'int', 'double', 'null', 'list', 'map', 'unknown']),
  }),
  ...[
    'filter-config-invalid',
    'listener-snapshot-invalid',
    'listener-output-types-invalid',
    'admission-denied',
    'workspace-not-found',
    'workspace-suspended',
    'workspace-deleted',
    'definition-not-found',
    'project-mismatch',
    'agent-config-unresolvable',
    'agent-integration-materialization-failed',
    'unexpected-workflow-start-failure',
    'unexpected-listener-delivery-failure',
  ].map((code) => z.strictObject({version: diagnosticVersionSchema, code: z.literal(code)})),
  z.strictObject({
    version: diagnosticVersionSchema,
    code: z.literal('interpolation-unresolvable'),
    field: diagnosticFieldSchema,
    envKey: diagnosticFieldSchema.optional(),
  }),
  z.strictObject({
    version: diagnosticVersionSchema,
    code: z.literal('invalid-job-runner-labels'),
    labels: z.array(z.string().min(1).max(64)).max(10),
  }),
  z.strictObject({
    version: diagnosticVersionSchema,
    code: z.literal('source-snapshot-too-large'),
    limitBytes: diagnosticByteCountSchema,
    measuredBytes: diagnosticByteCountSchema,
  }),
  z.strictObject({
    version: diagnosticVersionSchema,
    code: z.literal('diagnostic-too-large'),
    field: diagnosticFieldSchema.optional(),
    limitBytes: diagnosticByteCountSchema,
    measuredBytes: diagnosticByteCountSchema,
  }),
  z.strictObject({
    version: diagnosticVersionSchema,
    code: z.literal('workflow-execution-payload-too-large'),
    field: diagnosticFieldSchema,
    limitBytes: diagnosticByteCountSchema,
    measuredBytes: diagnosticByteCountSchema,
    overshootBytes: diagnosticByteCountSchema,
  }),
  z.strictObject({
    version: diagnosticVersionSchema,
    code: z.literal('listener-event-payload-too-large'),
    limitBytes: diagnosticByteCountSchema,
    measuredBytes: diagnosticByteCountSchema,
    overshootBytes: diagnosticByteCountSchema,
  }),
]);

export const triggerEventProcessingDiagnosticSchema = z.strictObject({
  version: diagnosticVersionSchema,
  code: z.enum([
    'subscription-load-failed',
    'trigger-reference-resolution-failed',
    'listener-routing-failed',
    'event-processing-failed',
  ]),
});

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
  processingDiagnostic: triggerEventProcessingDiagnosticSchema.nullable().optional(),
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
    diagnostic: triggerDecisionDiagnosticSchema.nullable().optional(),
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
  decisionsTotalCount: z.number().int().nonnegative().optional(),
  replaysTotalCount: z.number().int().nonnegative().optional(),
});

export const triggerEventDiagnosticReadLimitsSchema = z
  .object({
    decisions: z.number().int().min(1).max(50),
    replays: z.number().int().min(1).max(20),
  })
  .strict();

export type TriggerEventDiagnosticReadLimits = z.infer<
  typeof triggerEventDiagnosticReadLimitsSchema
>;

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
      input: z.object({
        workspaceId: idSchema,
        eventId: idSchema,
        diagnostic: triggerEventDiagnosticReadLimitsSchema.optional(),
      }),
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
