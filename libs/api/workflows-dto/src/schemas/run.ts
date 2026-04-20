import {z} from 'zod';

export const createRunBodySchema = z.object({
  project_id: z.string().uuid(),
  definition_id: z.string().uuid(),
  inputs: z.record(z.unknown()).optional(),
});

export type CreateRunBodyDto = z.infer<typeof createRunBodySchema>;

export const runDtoSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  definition_id: z.string().uuid(),
  status: z.string(),
  trigger_context: z.record(z.unknown()),
  inputs: z.record(z.unknown()).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type RunDto = z.infer<typeof runDtoSchema>;

export const runResponseSchema = runDtoSchema;

export type RunResponseDto = z.infer<typeof runResponseSchema>;

export const runListResponseSchema = z.object({
  runs: z.array(runResponseSchema),
});

export type RunListResponseDto = z.infer<typeof runListResponseSchema>;
