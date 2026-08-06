import {z} from 'zod';

export const ANNOTATION_STYLES = ['default', 'info', 'success', 'warning', 'error'] as const;
export const ANNOTATION_CONTEXT_MAX_LENGTH = 255;
export const READ_ANNOTATIONS_MAX_LIMIT = 500;
export const WORKFLOW_RUN_ATTEMPT_MAX = 2_147_483_647;
export const ANNOTATION_CONTEXT_TRIM_CODE_POINTS = [
  9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201,
  8202, 8232, 8233, 8239, 8287, 12288, 65279,
] as const;

function hasMaxCodePoints(value: string, maxCodePoints: number): boolean {
  let count = 0;
  for (const _codePoint of value) {
    count += 1;
    if (count > maxCodePoints) return false;
  }

  return true;
}

const annotationContextSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => hasMaxCodePoints(value, ANNOTATION_CONTEXT_MAX_LENGTH), {
    message: `String must contain at most ${ANNOTATION_CONTEXT_MAX_LENGTH} character(s)`,
  })
  .describe('Caller-chosen annotation key. Trimmed and unique within a job execution.');

export const annotationStyleSchema = z.enum(ANNOTATION_STYLES);

export type AnnotationStyleDto = z.infer<typeof annotationStyleSchema>;

export const annotationDtoSchema = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  job_execution_id: z.string().uuid(),
  origin_step_id: z.string().uuid(),
  origin_step_attempt: z.number().int().min(1),
  context: annotationContextSchema,
  style: annotationStyleSchema,
  sequence: z.number().int().min(1),
  body: z.string(),
});

export type AnnotationDto = z.infer<typeof annotationDtoSchema>;

const leasedWriteAnnotationOperationBaseSchema = z.object({
  context: annotationContextSchema,
  style: annotationStyleSchema.default('default'),
});

export const leasedWriteAnnotationOperationSchema = z.union([
  leasedWriteAnnotationOperationBaseSchema.extend({
    op: z.literal('replace').default('replace'),
    body: z.string(),
  }),
  leasedWriteAnnotationOperationBaseSchema.extend({
    op: z.literal('append'),
    body: z.string(),
  }),
  leasedWriteAnnotationOperationBaseSchema.extend({
    op: z.literal('remove'),
    body: z.never().optional(),
  }),
]);

export type LeasedWriteAnnotationOperationDto = z.infer<
  typeof leasedWriteAnnotationOperationSchema
>;

export const leasedWriteAnnotationsBodySchema = z.object({
  step_id: z.string().uuid(),
  attempt: z.number().int().min(1),
  annotations: z.array(leasedWriteAnnotationOperationSchema),
});

export type LeasedWriteAnnotationsBodyDto = z.infer<typeof leasedWriteAnnotationsBodySchema>;

export const leasedWriteAnnotationsResponseSchema = z.object({
  annotations: z.array(
    z.object({
      context: annotationContextSchema,
      id: z.string().uuid().nullable(),
    }),
  ),
  accounting: z.object({
    annotation_count: z.number().int().min(0),
    total_body_bytes: z.number().int().min(0),
  }),
});

export type LeasedWriteAnnotationsResponseDto = z.infer<
  typeof leasedWriteAnnotationsResponseSchema
>;

export const readAnnotationsQuerySchema = z.object({
  workflow_run_id: z.string().uuid(),
  attempt: z.coerce.number().int().min(1).max(WORKFLOW_RUN_ATTEMPT_MAX),
  job_execution_id: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(READ_ANNOTATIONS_MAX_LIMIT)
    .default(READ_ANNOTATIONS_MAX_LIMIT),
});

export type ReadAnnotationsQueryDto = z.infer<typeof readAnnotationsQuerySchema>;

export const readAnnotationsResponseSchema = z.object({
  annotations: z.array(annotationDtoSchema),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
});

export type ReadAnnotationsResponseDto = z.infer<typeof readAnnotationsResponseSchema>;

export const annotationSummaryResponseSchema = z.object({
  total: z.number().int().min(0),
  error: z.number().int().min(0),
  warning: z.number().int().min(0),
  info: z.number().int().min(0),
  success: z.number().int().min(0),
  step_counts: z.array(
    z.object({
      origin_step_id: z.string().uuid(),
      origin_step_attempt: z.number().int().min(1),
      total: z.number().int().min(0),
    }),
  ),
});

export type AnnotationSummaryResponseDto = z.infer<typeof annotationSummaryResponseSchema>;
