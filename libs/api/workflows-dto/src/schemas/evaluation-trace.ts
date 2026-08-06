import {z} from 'zod';

const evaluationTraceValueSchema = z.object({
  expression: z.string(),
  roots: z.array(z.string()),
  fill_target: z.string(),
  evaluated_at: z.string(),
  field: z.string(),
  value: z.string().optional(),
  truncated: z.boolean().optional(),
  expr_truncated: z.boolean().optional(),
  reference: z.boolean().optional(),
  degraded: z.boolean().optional(),
  env_key: z.string().optional(),
});

const evaluationTraceLimitSchema = z.object({
  truncated: z.literal(true),
  dropped: z.number().int().nonnegative(),
});

export const evaluationTraceEntrySchema = z.union([
  evaluationTraceValueSchema,
  evaluationTraceLimitSchema,
]);

export const evaluationTraceSchema = z.array(evaluationTraceEntrySchema);

export type EvaluationTraceEntryDto = z.infer<typeof evaluationTraceEntrySchema>;
export type EvaluationTraceDto = z.infer<typeof evaluationTraceSchema>;
