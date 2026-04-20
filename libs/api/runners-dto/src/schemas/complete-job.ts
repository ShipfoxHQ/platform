import {z} from 'zod';

export const completeJobBodySchema = z.object({
  status: z.enum(['succeeded', 'failed']),
  output: z.unknown().optional(),
});

export type CompleteJobBodyDto = z.infer<typeof completeJobBodySchema>;

export const completeJobResponseSchema = z.object({
  ok: z.boolean(),
});

export type CompleteJobResponseDto = z.infer<typeof completeJobResponseSchema>;
