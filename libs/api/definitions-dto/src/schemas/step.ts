import {z} from 'zod';

export const runStepSchema = z.object({
  run: z.string(),
  name: z.string().optional(),
});

export type RunStepDto = z.infer<typeof runStepSchema>;
