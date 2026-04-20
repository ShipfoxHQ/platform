import {z} from 'zod';
import {runStepSchema} from './step.js';

export const jobSchema = z.object({
  needs: z.union([z.string(), z.array(z.string())]).optional(),
  runner: z.union([z.string(), z.array(z.string())]).optional(),
  steps: z.array(runStepSchema).min(1),
});

export type JobDto = z.infer<typeof jobSchema>;
