import {z} from 'zod';

export const jobDtoSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  dependencies: z.array(z.string()),
  position: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type JobDto = z.infer<typeof jobDtoSchema>;
