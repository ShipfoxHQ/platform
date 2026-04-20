import {z} from 'zod';

export const stepDtoSchema = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  name: z.string().nullable(),
  status: z.string(),
  type: z.string(),
  config: z.record(z.unknown()),
  position: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type StepDto = z.infer<typeof stepDtoSchema>;
