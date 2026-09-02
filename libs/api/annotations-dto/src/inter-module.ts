import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {
  annotationDtoSchema,
  annotationStyleSchema,
  READ_ANNOTATIONS_MAX_LIMIT,
  WORKFLOW_RUN_ATTEMPT_MAX,
} from './schemas/annotation.js';

const idSchema = z.string().uuid();

const annotationTargetSchema = z.object({
  workspaceId: idSchema,
  projectId: idSchema,
  workflowRunId: idSchema,
  workflowRunAttempt: z.number().int().min(1),
  workflowRunAttemptId: idSchema,
  jobId: idSchema,
  jobExecutionId: idSchema,
  originStepId: idSchema,
  originStepAttempt: z.number().int().min(1),
});
export const annotationCursorSchema = z.object({
  value: z.number().int().min(1),
  id: idSchema,
});

export const annotationsInterModuleContract = defineInterModuleContract({
  module: 'annotations',
  methods: {
    replaceOrRemoveAnnotation: {
      input: z.object({
        ...annotationTargetSchema.shape,
        context: z.string().trim().min(1).max(255),
        annotation: z.union([
          z.object({op: z.literal('replace'), style: annotationStyleSchema, body: z.string()}),
          z.object({op: z.literal('remove')}),
        ]),
      }),
      output: z.object({}),
      errors: {
        'annotation-body-too-large': z.object({maxBytes: z.number().int().positive()}),
        'annotation-count-limit-exceeded': z.object({maxAnnotations: z.number().int().positive()}),
        'annotation-total-bytes-limit-exceeded': z.object({maxBytes: z.number().int().positive()}),
      },
    },
    listAnnotationsForRunAttempt: {
      input: z.object({
        workspaceId: idSchema,
        workflowRunId: idSchema,
        workflowRunAttempt: z.number().int().min(1).max(WORKFLOW_RUN_ATTEMPT_MAX),
        jobExecutionId: idSchema.optional(),
        cursor: annotationCursorSchema.optional(),
        limit: z.number().int().min(1).max(READ_ANNOTATIONS_MAX_LIMIT).optional(),
      }),
      output: z.object({
        annotations: z.array(annotationDtoSchema),
        hasMore: z.boolean(),
        nextCursor: annotationCursorSchema.nullable(),
      }),
    },
  },
});

export type AnnotationsInterModuleClient = InterModuleClient<typeof annotationsInterModuleContract>;
